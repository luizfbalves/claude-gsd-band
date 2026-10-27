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
}

export type Board = {
  /** Workstream do GSD (`.planning/workstreams/<nome>`), null no `.planning/` raiz. */
  workstream: string | null
  version: string
  name: string
  done: number
  total: number
  rows: PhaseRow[]
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
    }
  }
}
