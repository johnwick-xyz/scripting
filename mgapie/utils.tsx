import { Widget } from 'scripting'

export const vmin = (num: number) => {
  const { width, height } = Widget.displaySize
  return (num * Math.min(width, height)) / 100
}

export const rpt = (n: number) => vmin((n * 100) / 155)

// 2026-11-23 -> 11/23
export function fmtDate(d: Date): string {
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}/${day}`
}

// 2026-11-23 09:41 -> 11/23 09:41
export function fmtTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmtDate(d)} ${hh}:${mm}`
}

// 今天 -> HH:MM，否则 M/D HH:MM
export function fmtTimeShort(d: Date): string {
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`
  return `${fmtDate(d)} ${hh}:${mm}`
}

// token 数：1234 -> 1.2k，2500000 -> 2.5M
export function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

// 费用（美元）：0.42 -> $0.42
export function fmtCost(c: number): string {
  return '$' + c.toFixed(2)
}

// 大数字千分位：12345 -> 12,345
export function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
