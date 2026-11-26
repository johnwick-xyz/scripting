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

// token 数：和 Magpie 网页 fmtN 一样——1234 -> 1.2K，405000 -> 405K，
// 2500000 -> 2.5M，25600000 -> 26M（大写 K/M，十万以上不带小数）
export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e7) return Math.round(n / 1e6) + 'M'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e5) return Math.round(n / 1e3) + 'K'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// 费用（美元）：0.42 -> $0.42
export function fmtCost(c: number): string {
  return '$' + c.toFixed(2)
}

// 费用（美元，网页口径）：≥$1 两位小数，<$1 三位小数，
// 小于 $0.001 的按前两位有效数字——只用在模型明细行，
// 和网页 Usage 页的 $1.64 / $0.023 一样；
// 顶部和紧凑视图仍用 fmtCost（$0.86 的样子已经确认过）。
export function fmtCostWeb(c: number): string {
  if (!c) return '$0.00'
  const d = c >= 1 ? 2 : c < 1e-3 ? 1 - Math.floor(Math.log10(c)) : 3
  return '$' + c.toFixed(d)
}

// 大数字千分位：12345 -> 12,345
export function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// 百分比：整数不带小数（100% 而不是 100.0%，
// 不然小图那格“成功率 100.0%”太宽会折成两行），
// 其余保留一位小数：93.6%
export function fmtPct(v: number): string {
  const r = Math.round(v * 10) / 10
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%'
}

// 额度卡接口回的是 {"object": "list", "data": [...]}，不是裸数组
// （writeCards，internal/gateway/quotas_scope.go）。
// 不拆 data 这一层，Array.isArray 就过不了，卡永远是空的；
// 而且回来的对象是 truthy，连“额度卡没拉到”都不显示，
// 大图就静悄悄一张卡都没有（2026-11-26 大图截图就是这样）。
// 用量和 /v1 接口回的是裸对象，不用拆，只有额度卡要拆。
export function unwrapCards(raw: any): any[] {
  if (Array.isArray(raw)) return raw
  if (raw && Array.isArray(raw.data)) return raw.data
  return []
}
