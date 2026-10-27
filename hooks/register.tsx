import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Activity, Board, Mark } from '../types'
import { actionLabel, buildBoard, describeActivity, dirNumber, field, frontmatter, nextAction, parseGsd, pendencies, pickBoard, progress, readMilestone, readPhases, touchedWorkstream } from './board'
import type { PhaseFiles } from './board'
import { buildGrid, pulseCells } from './raster'
import { SERVER } from './web'

const board = atom({ plugin: 'gsd-band', key: 'board' } as const, null, { shape: 'board-4' })
const isHidden = atom({ plugin: 'gsd-band', key: 'isHidden' } as const, false)
const choices = atom({ plugin: 'gsd-band', key: 'choices' } as const, [])
const selected = atom({ plugin: 'gsd-band', key: 'selected' } as const, null)
const hint = atom({ plugin: 'gsd-band', key: 'hint' } as const, null)
const activity = atom({ plugin: 'gsd-band', key: 'activity' } as const, null, { shape: 'activity-2' })

const GLYPH: Record<Mark, string> = { done: '✓', partial: '◆', ready: '○', blocked: '·' }
const BAR = 20
const TICK = 100
const PORT = 4317

// Onde o indicador está montado agora; o render atualiza, o timer só repinta.
let pulse: { requestId: string; isWorking: boolean } | null = null
let frame = 0

// A página local: o servidor rodando, os milestones da última leitura e quando cada subagente apareceu.
let web: { url: string; token: string; stream: AsyncGenerator<unknown, unknown> } | null = null
let lastBoards: Board[] = []
const seen = new Map<string, number>()

const readFiles = async ($: EngineInterface, root: string): Promise<Map<number, PhaseFiles>> => {
  const files = new Map<number, PhaseFiles>()
  const dirs = await $.fs.list(`${root}/phases`).catch(() => [])
  for (const dir of dirs) {
    const number = dirNumber(dir.name)
    if (dir.kind !== 'dir' || number === undefined) continue
    const path = `${root}/phases/${dir.name}`
    const names = (await $.fs.list(path).catch(() => [])).map(f => f.name)
    const ids = (suffix: string) => names.filter(n => n.endsWith(suffix)).map(n => n.slice(0, -suffix.length)).sort()
    const read = async (suffix: string) => {
      const name = names.find(n => n.endsWith(suffix))
      return name ? await $.fs.read(`${path}/${name}`).catch(() => '') : ''
    }
    const verification = field(frontmatter(await read('-VERIFICATION.md')), 'status')
    const uatMd = await read('-UAT.md')
    const planIds = ids('-PLAN.md')
    const summaryIds = ids('-SUMMARY.md')
    files.set(number, {
      hasContext: names.some(n => n.endsWith('-CONTEXT.md')),
      plans: planIds.length,
      summaries: summaryIds.length,
      planIds,
      summaryIds,
      verification,
      uat: uatMd
        ? { status: field(frontmatter(uatMd), 'status') ?? '', pending: Number(uatMd.match(/^pending:\s*(\d+)/m)?.[1] ?? 0) }
        : undefined,
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

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Junta o comando GSD em andamento com os subagentes gsd-* rodando agora. */
const refreshActivity = async ($: EngineInterface, command?: Pick<Activity, 'command' | 'phase'> | null): Promise<void> => {
  const agents = (await $.agent.list().catch(() => []))
    .filter(a => a.type.startsWith('gsd-') && (a.status === 'running' || a.status === 'pending'))
  for (const id of seen.keys()) if (!agents.some(a => a.id === id)) seen.delete(id)
  for (const a of agents) if (!seen.has(a.id)) seen.set(a.id, Date.now())
  const running = agents.map(a => ({ type: a.type, description: a.description, since: seen.get(a.id) ?? Date.now() }))
  const before = await read($, activity)
  const base = command === undefined ? { command: before?.command ?? null, phase: before?.phase ?? null } : command ?? { command: null, phase: null }
  const next: Activity | null = base.command || running.length > 0 ? { ...base, agents: running } : null
  if (!same(before, next)) await update($, activity, () => next)
  await publishWeb($)
}

/** Manda o estado para a página local, se ela estiver ligada. */
const publishWeb = async ($: EngineInterface): Promise<void> => {
  if (!web) return
  const body = JSON.stringify({
    project: await $.session.cwd(),
    session: await $.session.id(),
    selected: (await read($, board))?.workstream ?? '',
    activity: await read($, activity),
    boards: lastBoards.map(b => ({ ...b, id: b.workstream ?? '', percent: progress(b), pendencies: pendencies(b) })),
  })
  await $.http
    .fetch(`${web.url}/state`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gsd-band-token': web.token }, body })
    .catch(() => undefined)
}

/** Sobe o servidor com um runtime e resolve com a URL quando ele avisa a porta. */
const spawnServer = ($: EngineInterface, runtime: string, token: string) =>
  new Promise<NonNullable<typeof web>>((resolve, reject) => {
    const stream = $.process.spawn({ argv: [runtime, '-e', SERVER], env: { GSD_BAND_TOKEN: token, GSD_BAND_PORT: String(PORT) } })
    void (async () => {
      let isUp = false
      try {
        for await (const { text } of stream) {
          const port = isUp ? undefined : text.match(/PORT (\d+)/)?.[1]
          if (port) {
            isUp = true
            resolve({ url: `http://127.0.0.1:${port}`, token, stream })
          }
        }
      } catch (err) {
        if (!isUp) reject(err)
      }
      if (!isUp) reject(new Error(`${runtime} encerrou antes de abrir a porta`))
      else if (web?.stream === stream) web = null
    })()
  })

const startWeb = async ($: EngineInterface): Promise<string> => {
  const token = crypto.randomUUID()
  const errors: string[] = []
  for (const runtime of ['node', 'bun']) {
    try {
      web = await spawnServer($, runtime, token)
      await publishWeb($)
      return web.url
    } catch (err) {
      errors.push(`${runtime}: ${err instanceof Error ? err.message : err}`)
    }
  }
  throw new Error(errors.join('; '))
}

/** Registra um comando ou skill GSD: o que está rodando e em qual workstream. */
const noteGsd = async ($: EngineInterface, command: string, args?: string): Promise<void> => {
  const gsd = parseGsd(command, args)
  if (!gsd) return
  if (gsd.workstream) await update($, hint, () => gsd.workstream)
  await refreshActivity($, { command: gsd.command, phase: gsd.phase })
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const planning = `${(await $.session.cwd()).replace(/\/$/, '')}/.planning`
  const boards = await loadBoards($, planning)
  lastBoards = boards
  const active = await readActive($, planning)
  const next = pickBoard(boards, await read($, selected), await read($, hint), active)
  const ids = boards.map(b => b.workstream ?? '')
  if (!same(await read($, choices), ids)) await update($, choices, () => ids)
  if (!same(await read($, board), next)) await update($, board, () => next)
  await refreshActivity($)
}

/** Liga a página, se preciso, e abre no navegador padrão (macOS, Linux ou WSL). */
const openWeb = async ($: EngineInterface): Promise<void> => {
  if (!web) await refresh($)
  const url = web?.url ?? (await startWeb($).catch((err: Error) => {
    void $.ui.toast(`Página do painel não subiu: ${err.message}`)
    return null
  }))
  if (!url) return
  for (const opener of ['open', 'xdg-open', 'wslview']) {
    const { exitCode } = await $.process.run([opener, url]).catch(() => ({ exitCode: 1 }))
    if (exitCode === 0) return
  }
  await $.ui.toast(`Abra ${url} no navegador`)
}

const label = (id: string): string => id || 'raiz'

const markColor = (mark: Mark): string | undefined =>
  mark === 'done' ? 'green' : mark === 'partial' ? 'yellow' : mark === 'ready' ? 'cyan' : undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gsd-band',
      description: 'Mostra ou esconde o painel GSD; com um nome, escolhe a workstream; web liga a página local',
      argumentHint: '[workstream | web]',
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
    // O comando GSD termina com o turno principal; subagentes seguem pela lista de agentes.
    if (e.agentId === undefined) await refreshActivity($, null)
    await refresh($)

    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (e.command !== 'gsd-band') await noteGsd($, e.command, e.args)

    return next(e)
  })

  // Atualiza na hora quando uma ferramenta mexe nos arquivos do GSD, sem esperar o timer.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Skill' && 'skill' in e && typeof e.skill === 'string') {
      await noteGsd($, e.skill, 'args' in e && typeof e.args === 'string' ? e.args : '')
    }
    const result = await next(e)
    const text = JSON.stringify(e)
    const ws = touchedWorkstream(text)
    if (ws) await update($, hint, () => ws)
    if (text.includes('.planning') || e.tool === 'Agent') void refresh($)

    return result
  })

  on('command.run', { command: 'gsd-band' }, async ($, e) => {
    const name = e.args.trim()
    if (name === 'web') {
      if (web) {
        await web.stream.return(undefined)
        web = null
        return { text: 'Página do painel desligada.' }
      }
      await refresh($)
      const url = await startWeb($).catch((err: Error) => {
        void $.ui.toast(`Página do painel não subiu: ${err.message}`)
        return null
      })
      return { text: url ? `Página do painel em ${url} (só leitura). /gsd-band web desliga.` : 'Página do painel não subiu: precisa de node ou bun no PATH.' }
    }
    if (name) {
      await refresh($)
      const ids = await read($, choices)
      const id = name === 'raiz' ? '' : name
      if (!ids.includes(id)) return { text: `Sem milestone em progresso em "${name}". Opções: ${ids.map(label).join(', ') || 'nenhuma'}.` }
      await update($, selected, () => id)
      await update($, hint, () => null)
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
    const doing = describeActivity(await read($, activity))
    const isCompact = e.props.maxRows < data.rows.length + (doing ? 6 : 5)
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
            GSD ► MANAGER · {data.workstream ? `${data.workstream} · ` : ''}{data.version} {data.name}{'  '}
          </Text>
          {action && (
            <Button
              key="next"
              variant="primary"
              label={`▶ ${actionLabel(action)}`}
              onPress={() =>
                $.command.run(action).catch(err => $.ui.toast(`/${action.command} falhou: ${err}`))
              }
            />
          )}
          {action && <Text>  </Text>}
          {ids.length > 1 && (
            <Button
              key="switch"
              dimColor
              label={`⇄ ${label(following)}`}
              onPress={async () => {
                await update($, selected, () => following)
                await refresh($)
              }}
            />
          )}
          {ids.length > 1 && <Text> </Text>}
          <Button key="web" dimColor label="↗ web" onPress={() => openWeb($)} />
          <Text> </Text>
          <Button
            key="clear"
            dimColor
            label="/clear"
            onPress={() => $.command.run({ command: 'clear' }).catch(err => $.ui.toast(`/clear falhou: ${err}`))}
          />
        </Box>
        {doing && (
          <Text color="yellow" wrap="truncate-end">
            ◆ {doing}
          </Text>
        )}
      </Box>
    )

    if (Raster) {
      const grid = buildGrid(data, e.props.bodyColumns, e.props.maxRows < data.rows.length + (doing ? 7 : 6))

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
