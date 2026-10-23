import { expect, test } from 'claude-code/testing'

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

const seed = (on: Parameters<Parameters<typeof test>[1]>[1], state = STATE) => {
  on('command.register', () => ({ value: { command: 'gsd-band' } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/' }))
  on('fs.read', (_, e) => ({ value: e.path.endsWith('STATE.md') ? state : ROADMAP }))
  on('fs.list', (_, e) => ({ value: LISTS[e.path ?? ''] ?? [] }))
}

test('mostra fases do milestone em progresso', async ($, on) => {
  seed(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /fases concluídas/ }))?.text).toContain('25% · 1 de 4')
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
