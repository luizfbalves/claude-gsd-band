import type { Board, PhaseRow } from '../types'

export type PhaseFiles = { hasContext: boolean; plans: number; summaries: number }

type Milestone = { workstream: string | null; version: string; name: string }

const CLOSED = /complete|archived|shipped|closed/i

const field = (text: string, key: string): string | undefined =>
  text.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'))?.[1]?.trim()

/** Milestone em progresso pelo frontmatter do STATE.md, ou null. */
export const readMilestone = (stateMd: string, workstream: string | null = null): Milestone | null => {
  const front = stateMd.match(/^---\n([\s\S]*?)\n---/)?.[1]
  if (!front) return null
  const version = field(front, 'milestone')
  const status = field(front, 'status') ?? ''
  if (!version || CLOSED.test(status)) return null

  return { workstream, version, name: field(front, 'milestone_name') ?? '' }
}

/** Fases do milestone atual: a lista da seção "## Phases" (ou "## Fases") fora de <details>. */
export const readPhases = (roadmap: string): { number: string; name: string; isChecked: boolean }[] => {
  const start = roadmap.search(/\n## (Phases|Fases)\b/)
  if (start < 0) return []
  const rest = roadmap.slice(start + 1)
  const end = rest.indexOf('\n## ', 3)
  const section = (end < 0 ? rest : rest.slice(0, end)).replace(/<details>[\s\S]*?<\/details>/g, '')

  return [...section.matchAll(/^- \[( |x)\] \*\*Phase (\d+(?:\.\d+)?): ([^*]+)\*\*/gm)].map(m => ({
    number: m[2] ?? '',
    name: (m[3] ?? '').trim(),
    isChecked: m[1] === 'x',
  }))
}

/** Número da fase pelo prefixo da pasta ("09-nome" → 9). */
export const dirNumber = (dir: string): number | undefined => {
  const prefix = dir.match(/^(\d+(?:\.\d+)?)-/)?.[1]

  return prefix === undefined ? undefined : Number(prefix)
}

export const buildBoard = (
  milestone: Milestone,
  phases: ReturnType<typeof readPhases>,
  files: Map<number, PhaseFiles>,
): Board => {
  let isReadyTaken = false
  const rows: PhaseRow[] = phases.map((phase, i) => {
    const f = files.get(Number(phase.number)) ?? { hasContext: false, plans: 0, summaries: 0 }
    const base = { number: phase.number, name: phase.name, plans: f.plans, summaries: f.summaries }
    if (phase.isChecked || (f.plans > 0 && f.summaries >= f.plans)) {
      return { ...base, d: 'done', p: 'done', e: 'done', status: 'Concluída' }
    }
    if (f.plans > 0) {
      return f.summaries > 0
        ? { ...base, d: 'done', p: 'done', e: 'partial', status: `Execução parcial (${f.summaries}/${f.plans})` }
        : { ...base, d: 'done', p: 'done', e: 'ready', status: 'Pronta para execução' }
    }
    if (f.hasContext) {
      return { ...base, d: 'done', p: 'ready', e: 'blocked', status: 'Pronta para planejamento' }
    }
    if (!isReadyTaken) {
      isReadyTaken = true
      return { ...base, d: 'ready', p: 'blocked', e: 'blocked', status: 'Pronta para discussão' }
    }
    const previous = phases[i - 1]?.number ?? ''

    return { ...base, d: 'blocked', p: 'blocked', e: 'blocked', status: `Aguarda fase ${previous}` }
  })

  return {
    ...milestone,
    done: rows.filter(r => r.status === 'Concluída').length,
    total: rows.length,
    rows,
  }
}

/** Progresso do milestone: cada fase vale 1, a fase em execução conta a fração de planos com SUMMARY. */
export const progress = (board: Board): number => {
  const sum = board.rows.reduce((s, r) => {
    if (r.status === 'Concluída') return s + 1
    return r.plans > 0 ? s + Math.min(r.summaries, r.plans) / r.plans : s
  }, 0)

  return Math.round((sum / board.total) * 100)
}

/** O comando GSD que avança a primeira fase não concluída, ou null. */
export const nextAction = (board: Board): { command: string; args: string } | null => {
  const row = board.rows.find(r => r.status !== 'Concluída')
  if (!row) return null
  const args = board.workstream ? `${row.number} --ws ${board.workstream}` : row.number
  if (row.d === 'ready') return { command: 'gsd-discuss-phase', args }
  if (row.p === 'ready') return { command: 'gsd-plan-phase', args }
  if (row.e === 'ready' || row.e === 'partial') return { command: 'gsd-execute-phase', args }

  return null
}

/** Qual board mostrar: a escolha da pessoa, senão a workstream ativa do GSD, senão a primeira. */
export const pickBoard = (boards: Board[], selected: string | null, active: string): Board | null => {
  const by = (id: string) => boards.find(b => (b.workstream ?? '') === id)

  return (selected !== null ? by(selected) : undefined) ?? by(active) ?? boards[0] ?? null
}
