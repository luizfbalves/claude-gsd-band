export type Mark = 'done' | 'partial' | 'ready' | 'blocked'

export type PhaseRow = {
  number: string
  name: string
  d: Mark
  p: Mark
  e: Mark
  status: string
  plans: number
  summaries: number
  /** Verificação: VERIFICATION.md aprovado, com pendência, a fazer ou ainda não. */
  v: Mark
  /** Itens de UAT ainda pendentes na fase. */
  uatPending: number
  /** Planos da fase pelo prefixo ("24-01") e se já têm SUMMARY. */
  planList: { id: string; isDone: boolean }[]
}

export type Board = {
  /** Workstream do GSD (`.planning/workstreams/<nome>`), null no `.planning/` raiz. */
  workstream: string | null
  version: string
  name: string
  /** `stopped_at` e `last_updated` do STATE.md. */
  stoppedAt: string
  lastUpdated: string
  done: number
  total: number
  rows: PhaseRow[]
}

/** O comando GSD em andamento e os subagentes gsd-* rodando. */
export type Activity = {
  command: string | null
  phase: string | null
  agents: { type: string; description: string; since: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'gsd-band': {
      board: Shaped<Board | null>
      isHidden: boolean
      /** Workstreams com milestone em progresso ('' é o `.planning/` raiz). */
      choices: string[]
      /** Escolha da pessoa; null segue a workstream ativa do GSD. */
      selected: string | null
      /** Workstream do último comando GSD ou arquivo tocado nesta sessão. */
      hint: string | null
      activity: Shaped<Activity | null>
    }
  }
}
