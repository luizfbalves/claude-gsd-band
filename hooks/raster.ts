import type { Board, Mark, PhaseRow } from '../types'
import { progress } from './board'

export type Cell = { ch: string; fg: number; bg: number }
export type Grid = { columns: number; rows: number; cells: string }

const DEFAULT = 0x01000000
const GREEN = 0x3fb950
const YELLOW = 0xd29922
const CYAN = 0x39c5cf
const DIM = 0x6e7681
const TRACK = 0x30363d

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const BAR = 48
const MAX_PLANS = 20
const MIN_NAME = 16

const MARK_BG: Record<Mark, number> = { done: GREEN, partial: YELLOW, ready: CYAN, blocked: TRACK }

/** Raster só aceita caracteres BMP de largura 1; o resto vira "?". */
const isNarrow = (code: number): boolean =>
  (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code < 0x300) || (code >= 0x370 && code < 0x1100) || (code >= 0x2000 && code < 0x2e00)

const text = (s: string, fg = DEFAULT, bg = DEFAULT): Cell[] =>
  [...s.normalize('NFC')].map(ch => ({ ch: isNarrow(ch.codePointAt(0) ?? 0) ? ch : '?', fg, bg }))

const width = (s: string): number => [...s.normalize('NFC')].length

const fit = (s: string, n: number): string =>
  width(s) > n ? [...s.normalize('NFC')].slice(0, n - 1).join('') + '…' : s + ' '.repeat(n - width(s))

const statusColor = (row: PhaseRow): number =>
  row.e === 'done' ? GREEN : row.e === 'partial' ? YELLOW : row.d === 'blocked' ? DIM : CYAN

const isDone = (row: PhaseRow): boolean => row.status === 'Concluída'

/** O que a coluna de planos mostra: quadrados só na fase ativa, "n/n" nas concluídas. */
const planCells = (row: PhaseRow, isActive: boolean): Cell[] => {
  if (isDone(row)) return row.plans > 0 ? text(`${row.plans}/${row.plans}`, DIM) : []
  if (!isActive || row.plans === 0) return []
  const shown = Math.min(row.plans, MAX_PLANS)

  return Array.from({ length: shown }, (_, i): Cell =>
    i < row.summaries ? { ch: '■', fg: GREEN, bg: DEFAULT } : { ch: '□', fg: YELLOW, bg: DEFAULT },
  )
}

/** Uma barra segmentada por fase com precisão de 1/8 de célula; fase sem plano pesa a média das outras. */
const progressBar = (board: Board): Cell[] => {
  const planned = board.rows.filter(r => r.plans > 0)
  const average = planned.length ? planned.reduce((s, r) => s + r.plans, 0) / planned.length : 1
  const weights = board.rows.map(r => (r.plans > 0 ? r.plans : average))
  const sum = weights.reduce((a, b) => a + b, 0)
  const cells: Cell[] = []
  let used = 0
  board.rows.forEach((row, i) => {
    const w = i === board.rows.length - 1 ? BAR - used : Math.max(2, Math.round(((weights[i] ?? 1) / sum) * BAR))
    used += w
    const inner = w - 1
    const color = statusColor(row)
    const ratio = isDone(row) ? 1 : row.plans > 0 ? row.summaries / row.plans : 0
    const eighths = Math.round(ratio * inner * 8)
    for (let c = 0; c < inner; c++) {
      const filled = Math.min(8, Math.max(0, eighths - c * 8))
      cells.push({ ch: filled === 8 ? '█' : EIGHTHS[filled] || ' ', fg: color, bg: TRACK })
    }
    cells.push({ ch: ' ', fg: DEFAULT, bg: DEFAULT })
  })

  return cells
}

type Layout = { name: number; plans: number }

const chips = (row: PhaseRow): Cell[] =>
  (['d', 'p', 'e'] as const).flatMap((k, i) => [...(i ? text(' ') : []), ...text('  ', DEFAULT, MARK_BG[row[k]])])

const phaseLine = (row: PhaseRow, isActive: boolean, layout: Layout): Cell[] => {
  const nameColor = row.d === 'blocked' ? DIM : DEFAULT
  const plans = planCells(row, isActive)

  return [
    ...text(isActive ? '▶ ' : '  ', YELLOW),
    ...text(fit(row.number, 4), nameColor),
    ...text(fit(row.name, layout.name), nameColor),
    ...text(' '),
    ...chips(row),
    ...text('  '),
    ...plans,
    ...text(' '.repeat(layout.plans - plans.length + 1)),
    ...text(row.status, statusColor(row)),
  ]
}

const labelLine = (layout: Layout): Cell[] => text(`${' '.repeat(6 + layout.name + 1)}D  P  E`, DIM)

const encode = (lines: Cell[][], columns: number): string => {
  const words = new Uint32Array(columns * lines.length * 3)
  lines.forEach((line, y) => {
    for (let x = 0; x < columns; x++) {
      const cell = line[x] ?? { ch: ' ', fg: DEFAULT, bg: DEFAULT }
      const at = (y * columns + x) * 3
      words[at] = cell.ch.codePointAt(0) ?? 0x20
      words[at + 1] = cell.fg
      words[at + 2] = cell.bg
    }
  })
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))

  return btoa(binary)
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// Os 6 pontos acesos com uma falha girando no sentido horário: 1 → 4 → 5 → 6 → 3 → 2.
const ORBIT = ['⠾', '⠷', '⠯', '⠟', '⠻', '⠽']

/** Indicador de vida, 2 colunas: gira rápido durante o turno, devagar parado. */
export const pulseCells = (frame: number, isWorking: boolean): string => {
  const cell: Cell = isWorking
    ? { ch: SPIN[frame % SPIN.length] ?? '⠋', fg: YELLOW, bg: DEFAULT }
    : { ch: ORBIT[Math.floor(frame / 3) % ORBIT.length] ?? '⠾', fg: GREEN, bg: DEFAULT }

  return encode([[cell, ...text(' ')]], 2)
}

/** As linhas do painel em células: barra, rótulos e uma linha por fase (só a ativa quando compacto). */
export const buildGrid = (board: Board, maxColumns: number, isCompact: boolean): Grid => {
  const active = board.rows.find(r => !isDone(r))
  const rows = isCompact ? (active ? [active] : []) : board.rows
  const plans = Math.max(0, ...rows.map(r => planCells(r, r === active).length))
  const status = Math.max(0, ...rows.map(r => width(r.status)))
  const longest = Math.max(0, ...rows.map(r => width(r.name)))
  // marcador + número + espaço + chips + espaços + planos + espaço + status
  const fixed = 2 + 4 + 1 + 8 + 2 + plans + 1 + status
  const layout: Layout = { name: Math.max(MIN_NAME, Math.min(longest, maxColumns - fixed)), plans }

  const head = [
    ...progressBar(board),
    ...text(` ${progress(board)}%`),
    ...text(` · ${board.done} de ${board.total} fases`, DIM),
  ]
  const lines = [head, [], labelLine(layout), ...rows.map(r => phaseLine(r, r === active, layout))]
  const columns = Math.max(1, Math.min(maxColumns, 512, Math.max(...lines.map(l => l.length))))

  return { columns, rows: lines.length, cells: encode(lines, columns) }
}
