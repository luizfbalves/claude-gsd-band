import type { Board, Mark, PhaseRow } from '../types'

export type Cell = { ch: string; fg: number; bg: number }
export type Grid = { columns: number; rows: number; cells: string }

const DEFAULT = 0x01000000
const GREEN = 0x3fb950
const YELLOW = 0xd29922
const CYAN = 0x39c5cf
const DIM = 0x6e7681
const TRACK = 0x30363d
const INK = 0x0d1117

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const BAR = 48
const NAME = 30
const MAX_PLANS = 20

const MARK_BG: Record<Mark, number> = { done: GREEN, partial: YELLOW, ready: CYAN, blocked: TRACK }

/** Raster só aceita caracteres BMP de largura 1; o resto vira "?". */
const isNarrow = (code: number): boolean =>
  (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code < 0x300) || (code >= 0x370 && code < 0x1100) || (code >= 0x2000 && code < 0x2e00)

const text = (s: string, fg = DEFAULT, bg = DEFAULT): Cell[] =>
  [...s.normalize('NFC')].map(ch => ({ ch: isNarrow(ch.codePointAt(0) ?? 0) ? ch : '?', fg, bg }))

const fit = (s: string, width: number): string =>
  [...s].length > width ? [...s].slice(0, width - 1).join('') + '…' : s + ' '.repeat(width - [...s].length)

const statusColor = (row: PhaseRow): number =>
  row.e === 'done' ? GREEN : row.e === 'partial' ? YELLOW : row.d === 'blocked' ? DIM : CYAN

/** Uma barra segmentada por fase, largura proporcional aos planos, com precisão de 1/8 de célula. */
const progressBar = (board: Board): Cell[] => {
  const weights = board.rows.map(r => Math.max(r.plans, 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  const cells: Cell[] = []
  let used = 0
  board.rows.forEach((row, i) => {
    const width = i === board.rows.length - 1 ? BAR - used : Math.max(2, Math.round(((weights[i] ?? 1) / sum) * BAR))
    used += width
    const inner = width - 1
    const color = statusColor(row)
    const ratio = row.status === 'Concluída' ? 1 : row.plans > 0 ? row.summaries / row.plans : 0
    const eighths = Math.round(ratio * inner * 8)
    for (let c = 0; c < inner; c++) {
      const filled = Math.min(8, Math.max(0, eighths - c * 8))
      cells.push(filled === 8 ? { ch: '█', fg: color, bg: TRACK } : { ch: EIGHTHS[filled] || ' ', fg: color, bg: TRACK })
    }
    cells.push({ ch: ' ', fg: DEFAULT, bg: DEFAULT })
  })

  return cells
}

const phaseLine = (row: PhaseRow, isActive: boolean): Cell[] => {
  const nameColor = row.d === 'blocked' ? DIM : DEFAULT
  const chips = (['d', 'p', 'e'] as const).flatMap((k, i) => [
    ...(i ? text(' ') : []),
    ...text(` ${k.toUpperCase()} `, row[k] === 'blocked' ? DIM : INK, MARK_BG[row[k]]),
  ])
  const shown = Math.min(row.plans, MAX_PLANS)
  const plans = Array.from({ length: shown }, (_, i): Cell =>
    i < row.summaries ? { ch: '■', fg: GREEN, bg: DEFAULT } : { ch: '□', fg: row.e === 'partial' ? YELLOW : DIM, bg: DEFAULT },
  )

  return [
    ...text(isActive ? '▶ ' : '  ', YELLOW),
    ...text(fit(row.number, 4), nameColor),
    ...text(fit(row.name, NAME), nameColor),
    ...text(' '),
    ...chips,
    ...text('  '),
    ...plans,
    ...text(' '.repeat(MAX_PLANS - shown + 1)),
    ...text(row.status, statusColor(row)),
  ]
}

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

/** As linhas do painel em células: barra, e uma linha por fase (só a ativa quando compacto). */
export const buildGrid = (board: Board, maxColumns: number, isCompact: boolean): Grid => {
  const percent = Math.round((board.done / board.total) * 100)
  const plans = board.rows.reduce((s, r) => s + r.plans, 0)
  const summaries = board.rows.reduce((s, r) => s + Math.min(r.summaries, r.plans), 0)
  const head = [
    ...progressBar(board),
    ...text(` ${percent}%`),
    ...text(` · ${board.done} de ${board.total} fases · ${summaries}/${plans} planos`, DIM),
  ]
  const rows = isCompact ? board.rows.filter(r => r.status !== 'Concluída').slice(0, 1) : board.rows
  const active = board.rows.find(r => r.status !== 'Concluída')
  const lines = [head, ...rows.map(r => phaseLine(r, r === active))]
  const columns = Math.max(1, Math.min(maxColumns, 512, Math.max(...lines.map(l => l.length))))

  return { columns, rows: lines.length, cells: encode(lines, columns) }
}
