import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Mark } from '../types'
import { buildBoard, dirNumber, readMilestone, readPhases } from './board'
import type { PhaseFiles } from './board'

const board = atom({ plugin: 'gsd-band', key: 'board' } as const, null, { shape: 'board-1' })
const isHidden = atom({ plugin: 'gsd-band', key: 'isHidden' } as const, false)

const GLYPH: Record<Mark, string> = { done: '✓', partial: '◆', ready: '○', blocked: '·' }
const BAR = 20

const readFiles = async ($: EngineInterface, root: string): Promise<Map<number, PhaseFiles>> => {
  const files = new Map<number, PhaseFiles>()
  const dirs = await $.fs.list(`${root}/phases`).catch(() => [])
  for (const dir of dirs) {
    const number = dirNumber(dir.name)
    if (dir.kind !== 'dir' || number === undefined) continue
    const names = (await $.fs.list(`${root}/phases/${dir.name}`).catch(() => [])).map(f => f.name)
    files.set(number, {
      hasContext: names.some(n => n.endsWith('-CONTEXT.md')),
      plans: names.filter(n => n.endsWith('-PLAN.md')).length,
      summaries: names.filter(n => n.endsWith('-SUMMARY.md')).length,
    })
  }

  return files
}

const loadBoard = async ($: EngineInterface): Promise<Board | null> => {
  const root = `${(await $.session.cwd()).replace(/\/$/, '')}/.planning`
  const stateMd = await $.fs.read(`${root}/STATE.md`).catch(() => '')
  const milestone = readMilestone(stateMd)
  if (!milestone) return null
  const phases = readPhases(await $.fs.read(`${root}/ROADMAP.md`).catch(() => ''))
  if (phases.length === 0) return null
  const next = buildBoard(milestone, phases, await readFiles($, root))

  return next.done === next.total ? null : next
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const next = await loadBoard($)
  const before = await read($, board)
  if (JSON.stringify(before) !== JSON.stringify(next)) await update($, board, () => next)
}

const markColor = (mark: Mark): string | undefined =>
  mark === 'done' ? 'green' : mark === 'partial' ? 'yellow' : mark === 'ready' ? 'cyan' : undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gsd-band', description: 'Mostra ou esconde o painel GSD acima do prompt' })
    await refresh($)
    $.clock.every(15000, () => refresh($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'gsd-band' }, async $ => {
    const hidden = await update($, isHidden, v => !v)
    await refresh($)

    return { text: hidden ? 'Painel GSD escondido.' : 'Painel GSD visível.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, board)
    if (e.props.hasSurvey || data === null || (await read($, isHidden))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const filled = Math.round((data.done / data.total) * BAR)
    const percent = Math.round((data.done / data.total) * 100)
    const isCompact = e.props.maxRows < data.rows.length + 4
    const rows = isCompact ? data.rows.filter(r => r.status !== 'Concluída').slice(0, 1) : data.rows

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>
            GSD ► MANAGER · {data.version} {data.name}{' '}
          </Text>
          <Button
            key="clear"
            label="/clear"
            onPress={() => $.command.run({ command: 'clear' }).catch(err => $.ui.toast(`/clear falhou: ${err}`))}
          />
        </Box>
        <Box>
          <Text color="green">{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR - filled)}</Text>
          <Text bold>
            {' '}
            {percent}% · {data.done} de {data.total} fases concluídas
          </Text>
        </Box>
        {!isCompact && (
          <Box>
            <Box width={6}><Text bold color="yellow">Fase</Text></Box>
            <Box width={30}><Text bold color="yellow">Descrição</Text></Box>
            <Box width={3}><Text bold color="yellow">D</Text></Box>
            <Box width={3}><Text bold color="yellow">P</Text></Box>
            <Box width={3}><Text bold color="yellow">E</Text></Box>
            <Text bold color="yellow">Status</Text>
          </Box>
        )}
        {rows.map(row => (
          <Box key={row.number}>
            <Box width={6}><Text>{row.number}</Text></Box>
            <Box width={30}><Text wrap="truncate-end">{row.name}</Text></Box>
            {[row.d, row.p, row.e].map((mark, i) => (
              <Box key={`m${i}`} width={3}><Text color={markColor(mark)} dimColor={mark === 'blocked'}>{GLYPH[mark]}</Text></Box>
            ))}
            <Text dimColor={row.d === 'blocked'} wrap="truncate-end">{row.status}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
