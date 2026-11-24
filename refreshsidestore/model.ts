export const DAY_MS = 86400000

export type AppRecord = {
  name: string
  bundleIdentifier: string
  expiresAt: number
  refreshedAt?: number
}

export type DuoApps = { sideStore?: AppRecord; liveContainer?: AppRecord }

/** 二合一：从已填到期日的应用里找出 SideStore 和 LiveContainer（各一个）。
 * 名字或标识里带 sidestore / livecontainer 就算（不区分大小写）；
 * 没填其中一个时对应项就是 undefined，视图会退回单圈 + 列表。 */
export function findDuo(apps: AppRecord[]): DuoApps {
  const match = (keyword: string) =>
    apps.find(app =>
      app.name.toLowerCase().includes(keyword) ||
      app.bundleIdentifier.toLowerCase().includes(keyword))
  return { sideStore: match("sidestore"), liveContainer: match("livecontainer") }
}

/** 二合一里先到期的那个（小号只放一个圈时用）。 */
export function soonestDuo(apps: AppRecord[]): AppRecord | undefined {
  const { sideStore, liveContainer } = findDuo(apps)
  const duo = [sideStore, liveContainer].filter((app): app is AppRecord => !!app)
  if (!duo.length) return undefined
  return duo.sort((a, b) => a.expiresAt - b.expiresAt)[0]
}

export function countdown(expiresAt: number | undefined, now: number, totalDays: number) {
  if (expiresAt == null || !Number.isFinite(expiresAt)) {
    return { text: "—", unit: "", progress: 0, expired: false }
  }
  const remaining = Math.max(0, expiresAt - now)
  const days = remaining / DAY_MS
  // Round down so a positive countdown never overstates the remaining time.
  return {
    text: days >= 1 ? (Math.floor(days * 10) / 10).toFixed(1) : remaining > 0 ? "<1" : "0",
    unit: "天",
    progress: Math.max(0, Math.min(1, days / Math.max(1, totalDays))),
    expired: expiresAt <= now,
  }
}

export function shortDate(ms?: number): string {
  if (ms == null) return "尚未配置"
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, "0")
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function shortTime(ms?: number): string {
  return ms == null ? "—" : shortDate(ms).slice(6)
}
