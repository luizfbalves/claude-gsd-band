export type Mark = 'done' | 'partial' | 'ready' | 'blocked'

export type PhaseRow = {
  number: string
  name: string
  d: Mark
  p: Mark
  e: Mark
  status: string
}

export type Board = {
  version: string
  name: string
  done: number
  total: number
  rows: PhaseRow[]
}


declare module 'claude-code' {
  interface PluginState {
    'gsd-band': { board: Shaped<Board | null>; isHidden: boolean }
  }
}
