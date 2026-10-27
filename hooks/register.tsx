import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Mark } from '../types'
import { buildBoard, dirNumber, nextAction, pickBoard, progress, readMilestone, readPhases } from './board'
import type { PhaseFiles } from './board'
import { buildGrid, pulseCells } from './raster'

const board = atom({ plugin: 'gsd-band', key: 'board' } as const, null, { shape: 'board-3' })
const isHidden = atom({ plugin: 'gsd-band', key: 'isHidden' } as const, false)
const choices = atom({ plugin: 'gsd-band', key: 'choices' } as const, [])
const selected = atom({ plugin: 'gsd-band', key: 'selected' } as const, null)

const GLYPH: Record<Mark, string> = { done: '✓', partial: '◆', ready: '○', blocked: '·' }
const BAR = 20
const TICK = 100

// Onde o indicador está montado agora; o render atualiza, o timer só repinta.
let pulse: { requestId: string; isWorking: boolean } | null = null
let frame = 0

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

const loadBoard = async ($: EngineInterface, root: string, workstream: string | null): Promise<Board | null> => {
  const stateMd = await $.fs.read(`${root}/STATE.md`).catch(() => '')
  const milestone = readMilestone(stateMd, workstream)
  if (!milestone) return null
  const phases = readPhases(await $.fs.read(`${root}/ROADMAP.md`).catch(() => ''))
  if (phases.length === 0) return null
  const next = buildBoard(milestone, phases, await readFiles($, root))

  return next.done === next.total ? null : next
}

/** Milestones em progresso no `.planning/` raiz e em cada workstream. */
const loadBoards = async ($: EngineInterface, planning: string): Promise<Board[]> => {
  const dirs = await $.fs.list(`${planning}/workstreams`).catch(() => [])
  const names = dirs.filter(d => d.kind === 'dir').map(d => d.name).sort()
  const boards = await Promise.all([
    loadBoard($, planning, null),
    ...names.map(name => loadBoard($, `${planning}/workstreams/${name}`, name)),
  ])

  return boards.filter((b): b is Board => b !== null)
}

const token = (raw: string): string => raw.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160)

/** Workstream ativa como o GSD resolve: o ponteiro desta sessão, senão `.planning/active-workstream`. */
const readActive = async ($: EngineInterface, planning: string): Promise<string> => {
  const own = await readSessionPointer($, planning).catch(() => '')

  return own || (await $.fs.read(`${planning}/active-workstream`).catch(() => '')).trim()
}

/** Ponteiro em `$TMPDIR/gsd-workstream-sessions/<sha1(.planning)[0:16]>/<chave da sessão>`. */
const readSessionPointer = async ($: EngineInterface, planning: string): Promise<string> => {
  const gsdKey = await $.env.get('GSD_SESSION_KEY')
  const claudeKey = await $.env.get('CLAUDE_SESSION_ID')
  const sessionKey = gsdKey
    ? `gsd-session-key-${token(gsdKey)}`
    : claudeKey
      ? `claude-session-id-${token(claudeKey)}`
      : `claude-code-session-id-${token(await $.session.id())}`
  const real = (await $.fs.stat(planning, { resolve: true }).catch(() => undefined))?.realPath ?? planning
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(real))
  const projectId = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')

  return (await $.fs.read(`${tmp}/gsd-workstream-sessions/${projectId}/${sessionKey}`)).trim()
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const planning = `${(await $.session.cwd()).replace(/\/$/, '')}/.planning`
  const boards = await loadBoards($, planning)
  const active = await readActive($, planning)
  const next = pickBoard(boards, await read($, selected), active)
  const ids = boards.map(b => b.workstream ?? '')
  if (JSON.stringify(await read($, choices)) !== JSON.stringify(ids)) await update($, choices, () => ids)
  if (JSON.stringify(await read($, board)) !== JSON.stringify(next)) await update($, board, () => next)
}

const label = (id: string): string => id || 'raiz'

const markColor = (mark: Mark): string | undefined =>
  mark === 'done' ? 'green' : mark === 'partial' ? 'yellow' : mark === 'ready' ? 'cyan' : undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gsd-band',
      description: 'Mostra ou esconde o painel GSD; com um nome, escolhe a workstream monitorada',
      argumentHint: '[workstream]',
    })
    await refresh($)
    $.clock.every(15000, () => refresh($))
    $.clock.every(TICK, () => {
      if (!pulse) return
      frame++
      void $.ui.blit({ requestId: pulse.requestId, key: 'pulse', cells: pulseCells(frame, pulse.isWorking) }).catch(() => undefined)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  // Atualiza na hora quando uma ferramenta mexe nos arquivos do GSD, sem esperar o timer.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (JSON.stringify(e).includes('.planning')) void refresh($)

    return result
  })

  on('command.run', { command: 'gsd-band' }, async ($, e) => {
    const name = e.args.trim()
    if (name) {
      await refresh($)
      const ids = await read($, choices)
      const id = name === 'raiz' ? '' : name
      if (!ids.includes(id)) return { text: `Sem milestone em progresso em "${name}". Opções: ${ids.map(label).join(', ') || 'nenhuma'}.` }
      await update($, selected, () => id)
      await update($, isHidden, () => false)
      await refresh($)

      return { text: `Painel GSD monitorando ${label(id)}.` }
    }
    const hidden = await update($, isHidden, v => !v)
    await refresh($)

    return { text: hidden ? 'Painel GSD escondido.' : 'Painel GSD visível.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, board)
    if (e.props.hasSurvey || data === null || (await read($, isHidden))) {
      pulse = null
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const ids = await read($, choices)
    const current = data.workstream ?? ''
    const following = ids[(ids.indexOf(current) + 1) % ids.length] ?? current
    const percent = progress(data)
    const filled = Math.round((percent / 100) * BAR)
    const action = nextAction(data)
    const isCompact = e.props.maxRows < data.rows.length + 5
    const rows = isCompact ? data.rows.filter(r => r.status !== 'Concluída').slice(0, 1) : data.rows

    const elements = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' && 'Raster' in elements ? elements.Raster : undefined
    const isTerminal = Raster !== undefined
    pulse = isTerminal ? { requestId: e.requestId, isWorking: e.props.isWorking } : null

    const header = (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(Math.max(1, e.props.bodyColumns))}</Text>
        <Box>
          {Raster && <Raster key="pulse" columns={2} rows={1} cells={pulseCells(frame, e.props.isWorking)} />}
          <Text dimColor>
            GSD ► MANAGER · {data.workstream ? `${data.workstream} · ` : ''}{data.version} {data.name}{' '}
          </Text>
          {ids.length > 1 && (
            <Button
              key="switch"
              label={`⇄ ${label(following)}`}
              onPress={async () => {
                await update($, selected, () => following)
                await refresh($)
              }}
            />
          )}
          {ids.length > 1 && <Text> </Text>}
          <Button
            key="clear"
            label="/clear"
            onPress={() => $.command.run({ command: 'clear' }).catch(err => $.ui.toast(`/clear falhou: ${err}`))}
          />
          {action && <Text> </Text>}
          {action && (
            <Button
              key="next"
              label={`▶ /${action.command} ${action.args}`}
              onPress={() =>
                $.command.run(action).catch(err => $.ui.toast(`/${action.command} falhou: ${err}`))
              }
            />
          )}
        </Box>
      </Box>
    )

    if (Raster) {
      const grid = buildGrid(data, e.props.bodyColumns, e.props.maxRows < data.rows.length + 6)

      return (
        <Box flexDirection="column" marginBottom={1}>
          {header}
          <Raster key="board" columns={grid.columns} rows={grid.rows} cells={grid.cells} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" marginBottom={1}>
        {header}
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
            <Box width={30} marginRight={1}><Text bold color="yellow">Descrição</Text></Box>
            <Box width={3}><Text bold color="yellow">D</Text></Box>
            <Box width={3}><Text bold color="yellow">P</Text></Box>
            <Box width={3}><Text bold color="yellow">E</Text></Box>
            <Text bold color="yellow">Status</Text>
          </Box>
        )}
        {rows.map(row => (
          <Box key={row.number}>
            <Box width={6}><Text>{row.number}</Text></Box>
            <Box width={30} marginRight={1}><Text wrap="truncate-end">{row.name}</Text></Box>
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
