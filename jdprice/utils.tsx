import { Widget } from 'scripting'

export const vmin = (num: number) => {
  const { width, height } = Widget.displaySize
  return (num * Math.min(width, height)) / 100
}

export const rpt = (n: number) => vmin((n * 100) / 155)

// 默认更新时间点：9:00、15:00、21:00
export const DEFAULT_SLOTS = [9, 15, 21]

// 解析用户填的更新时间点："9,15,21"、"9:00,15:00"、"9，15，21" 都行，
// 只取整点小时（分钟忽略），0–23，去重排序；填错、填空就回默认。
export function parseSlots(raw: any): number[] {
  let parts: string[] = []
  if (Array.isArray(raw)) parts = raw.map((x) => String(x))
  else if (typeof raw === 'string') parts = raw.split(/[,，、；;\s]+/)
  else if (typeof raw === 'number') parts = [String(raw)]
  const out: number[] = []
  for (const p of parts) {
    const s = p.trim()
    if (!s) continue
    const h = parseInt(s.split(':')[0], 10)
    if (!isNaN(h) && h >= 0 && h <= 23 && out.indexOf(h) === -1) out.push(h)
  }
  out.sort((a, b) => a - b)
  return out.length ? out : DEFAULT_SLOTS.slice()
}

// 显示用："9:00、15:00、21:00"
export function slotsLabel(slots: number[]): string {
  return slots.map((h) => `${h}:00`).join('、')
}
