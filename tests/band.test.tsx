import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const STATE = `---
milestone: v1.23
milestone_name: Milestone de exemplo
status: executing
---
`
const ROADMAP = `# Roadmap
## Phases
<details>
- [x] **Phase 1: Antiga** - fora
</details>
- [x] **Phase 9: Fundação** - a
- [ ] **Phase 12: Consulta de dados** - b
- [ ] **Phase 13: Ações** - c
- [ ] **Phase 14: Rollout** - d
## Phase Details
- [ ] **Phase 99: Nao** - x
`
const entry = (name: string, kind: 'file' | 'dir' = 'file') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })
const LISTS: Record<string, ReturnType<typeof entry>[]> = {
  '/.planning/phases': [entry('09-fundacao', 'dir'), entry('12-consulta', 'dir')],
  '/.planning/phases/09-fundacao': [entry('09-CONTEXT.md'), entry('09-01-PLAN.md'), entry('09-01-SUMMARY.md')],
  '/.planning/phases/12-consulta': [entry('12-CONTEXT.md'), entry('12-01-PLAN.md'), entry('12-02-PLAN.md'), entry('12-01-SUMMARY.md')],
}

const BAND = {
  plugin: 'gsd-band',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 30, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const seed = (on: Parameters<TestBody>[1], state = STATE) => {
  on('command.register', () => ({ value: { command: 'gsd-band' } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/' }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('STATE.md') ? state : e.path.endsWith('active-workstream') ? '' : ROADMAP }))
  on('fs.list', (_, e) => ({ value: LISTS[e.path ?? ''] ?? [] }))
}

const DESKTOP = { ...BAND, surface: 'desktop' } as const

const rasterText = (cells: string, columns: number): string[] => {
  const bin = atob(cells)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const lines: string[] = []
  for (let i = 0; i < words.length; i += columns * 3) {
    let line = ''
    for (let j = i; j < i + columns * 3; j += 3) line += String.fromCodePoint(words[j] ?? 32)
    lines.push(line.trimEnd())
  }
  return lines
}

test('desenha o painel em Raster no terminal', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)
  const raster = await ui.find({ type: 'Raster', key: 'board' })
  const lines = rasterText(String(raster?.props.cells), Number(raster?.props.columns))

  expect(lines.length).toBe(7)
  expect(lines[0]).toContain('38% · 1 de 4 fases')
  expect(lines[1]).toBe('')
  expect(lines[2]).toContain('D  P  E')
  expect(lines[3]).toContain('1/1')
  expect(lines[4]).toContain('▶ 12  Consulta de dados')
  expect(lines[4]).toContain('■□')
  expect(lines[4]).toContain('Execução parcial (1/2)')
  expect(lines[5]).toContain('Pronta para discussão')
  expect(lines[5]).not.toContain('□')
  expect(await ui.find({ type: 'Button', key: 'clear' })).toBeTruthy()
  const pulse = await ui.find({ type: 'Raster', key: 'pulse' })
  expect(rasterText(String(pulse?.props.cells), 2)[0]).toBe('⠾')
  await ui.unmount()
})

test('mostra fases do milestone em progresso', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  expect((await ui.find({ type: 'Text', text: /fases concluídas/ }))?.text).toContain('38% · 1 de 4')
  expect(await ui.find({ type: 'Text', text: /Execução parcial \(1\/2\)/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Pronta para discussão/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Aguarda fase 13/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Antiga|Nao/ })).toBeFalsy()
  await ui.unmount()
})

test('some sem milestone em progresso', async ($, on) => {
  seed(on, STATE.replace('executing', 'milestone_complete'))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('botão /clear roda o comando', async ($, on) => {
  seed(on)
  const runs: string[] = []
  on('command.run', (_, e) => {
    runs.push(e.command)
    return { text: '' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  await ui.press({ key: 'clear' })
  expect(runs).toContain('clear')
  await ui.unmount()
})

test('botão da próxima ação roda o comando GSD da fase ativa', async ($, on) => {
  seed(on)
  const runs: string[] = []
  on('command.run', (_, e) => {
    runs.push(`${e.command} ${e.args}`)
    return { text: '' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Button', key: 'next' }))?.props.label).toBe('▶ /gsd-execute-phase 12')
  await ui.press({ key: 'next' })
  expect(runs).toContain('gsd-execute-phase 12')
  await ui.unmount()
})

const run = ($: Parameters<TestBody>[0], command: string, args: string) =>
  $.command.run({ command, args } as Parameters<typeof $.command.run>[0])

const WS_STATE = (version: string) => STATE.replace('v1.23', version).replace('Milestone de exemplo', `Milestone ${version}`)

const seedWorkstreams = (on: Parameters<TestBody>[1], active = '', session = '') => {
  on('session.id', () => ({ value: 'abc-123' }))
  on('env.get', (_, e) => ({ value: e.name === 'TMPDIR' ? '/tmp/' : undefined }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/.planning' } }))
  on('command.register', () => ({ value: { command: 'gsd-band' } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/' }))
  on('fs.read', (_, e) => {
    if (e.path === '/.planning/active-workstream') return { value: active }
    if (e.path === '/tmp/gsd-workstream-sessions/d4c4d48d0315d66c/claude-code-session-id-abc-123' && session) return { value: `${session}\n` }
    if (e.path === '/.planning/workstreams/alfa/STATE.md') return { value: WS_STATE('v2.0') }
    if (e.path === '/.planning/workstreams/beta/STATE.md') return { value: WS_STATE('v3.0') }
    if (e.path === '/.planning/workstreams/gama/STATE.md') return { value: WS_STATE('v4.0').replace('executing', 'milestone-complete') }
    if (e.path.endsWith('ROADMAP.md') && e.path.includes('workstreams')) return { value: ROADMAP.replace('## Phases', '## Fases') }
    return { deny: 'ENOENT' }
  })
  on('fs.list', (_, e) => ({
    value: e.path === '/.planning/workstreams' ? [entry('alfa', 'dir'), entry('beta', 'dir'), entry('gama', 'dir')] : [],
  }))
}

test('segue a workstream ativa do GSD e passa --ws para a próxima ação', async ($, on) => {
  seedWorkstreams(on, 'beta')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('beta · v3.0')
  expect((await ui.find({ type: 'Button', key: 'next' }))?.props.label).toBe('▶ /gsd-discuss-phase 12 --ws beta')
  expect((await ui.find({ type: 'Button', key: 'switch' }))?.props.label).toBe('⇄ alfa')
  await ui.unmount()
})

test('botão troca o milestone monitorado e ignora workstream encerrada', async ($, on) => {
  seedWorkstreams(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('alfa · v2.0')
  await ui.press({ key: 'switch' })
  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('beta · v3.0')
  await ui.press({ key: 'switch' })
  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('alfa · v2.0')
  await ui.unmount()
})

test('/gsd-band <nome> escolhe a workstream', async ($, on) => {
  seedWorkstreams(on, 'alfa')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  expect((await run($, 'gsd-band', 'gama')).text).toContain('Opções: alfa, beta')
  expect((await run($, 'gsd-band', 'beta')).text).toContain('monitorando beta')
  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('beta · v3.0')
  await ui.unmount()
})

test('o ponteiro da sessão do GSD vence o active-workstream', async ($, on) => {
  seedWorkstreams(on, 'alfa', 'beta')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('beta · v3.0')
  await ui.unmount()
})

test('mostra o comando GSD em andamento e segue a workstream dele', async ($, on) => {
  seedWorkstreams(on, 'alfa')
  on('command.run', () => ({ text: '' }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Running orders specs', type: 'gsd-executor', status: 'running' },
      { id: 'a2', description: 'Outro', type: 'Explore', status: 'running' },
      { id: 'a3', description: 'Antigo', type: 'gsd-planner', status: 'completed' },
    ],
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(DESKTOP)

  await run($, 'gsd-execute-phase', '12 --ws beta')
  expect((await ui.find({ type: 'Text', text: /GSD ► MANAGER/ }))?.text).toContain('beta · v3.0')
  expect((await ui.find({ type: 'Text', text: /◆/ }))?.text).toBe('◆ Executando fase 12 · gsd-executor: Running orders specs')
  await ui.unmount()
})
