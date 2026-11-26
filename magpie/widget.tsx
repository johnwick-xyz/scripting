import {
  Capsule,
  HStack,
  Spacer,
  Text,
  VStack,
  ZStack,
  Widget,
  fetch,
  modifiers,
} from 'scripting'
import { fmtTimeShort, fmtTokens, fmtCost, fmtNum, fmtDate } from './utils'

// Magpie Scripting 小组件（2026-11-26 新版：截图同款设计）
// Magpie 是 yetone 的本地 AI 网关（Docker 跑在 john 的 Debian 服务器上，
// 网关 3425，Web UI 3430），所有 coding agent 的模型都走它。
//
// 大尺寸（systemLarge）按 john 2026-11-25 23:56 截图的样子排：
//   顶栏 Magpie + 版本 · 模型数 + 刷新图标
//   两张额度卡（Codex、CodeArts）：名字 + 计划 pill + 过期 pill，
//     绿色剩余条 + 剩余百分比，明细行
//   30 日统计 → 今日统计：调用 / 成功率 / 费用 / 输出速度
//   首字 · 总 Token（缓存）
//   热门模型（今日）前 4：名次 + 模型名 + Token + 调用
//   页脚：N/N 账号在线 · 7 日 N 次 | 更新于 HH:MM
// 中尺寸：今日统计行 + 明细行 + 热门模型前 3 + 页脚；
// 小尺寸：顶栏（logo + Magpie）+ 2×2 统计（单行：小标签 + 数字）+
//   热门模型前 3（精简行：名字 + Token）+ 更新时间。
// （额度卡只放得下大号；小号和中号按 john 2026-11-26 的要求，
// 显示截图下半截那块：统计 + 热门模型，前三就够。
// 小号 155×155 很紧：顶栏和更新时间是 john 点名要的（2026-11-26），
// 所以统计改成单行小格（标签 10 号、数字 12 号），模型行 12 号，
// 间距 3、上下留白 4，不然四样东西塞不下。）
// 锁屏圆 / 锁屏长条保持老样子（Token / 请求 + 费用）。
//
// 数据来自四个接口（都走同一个只读网关 Key，
// internal/gateway/readonly.go 里都放行了，401 = Key 不对，
// 403 = 没开局域网共享或 Key 没权限）：
//   GET {base}/v1
//     -> {name, version: "v0.1.4801", models: 19, ...}，
//     顶栏的版本和模型数就从这里来，不用再拉 /v1/models。
//   GET {base}/v1/magpie/usage?period=today
//     -> Usage 页的汇总 JSON（internal/usageapi/usageapi.go），
//     今日统计、热门模型、账号用量（今天 0 点起，series 按小时）。
//     Token 口径和网页排行一样：input+output+cache_read+cache_write；
//     “缓存”是 cache_read；
//     输出速度和首字和网页 ledSpeed / ttft 一样：
//     速度是 rates 直方图的中值（bin 400 是 1，每档 1.02 倍；
//     只有一条时按 decode_out/decode_ms 实测算），
//     首字是 ttft_ms/timed 的平均。
//   GET {base}/v1/magpie/usage?period=7d
//     -> 只取顶层 Totals.calls，当页脚的“7 日 N 次”；
//     拉不到就不显示那半句（不写“7日 0 次”误导）。
//     注意周期值是 today/7d/30d/all，不是 today/week/month/all——
//     Week="7d"、Month="30d"，传 period=month 会被当成未知值
//     静默回落到 30d（internal/usageapi/usageapi.go 的 PeriodOf）。
//   GET {base}/v1/magpie/quotas/cards
//     -> []SubscriptionQuota（internal/provider/subscription_usage.go），
//     一张卡一个账号：name、plan、windows[]、balance、balanceParts[]。
//     卡的画法是按网页 Usage 页额度卡（internal/gui/assets/app.js
//     renderQuotas / quotaWindows / quotaText / quotaCount /
//     runsOutText / joinBalanceParts）简化来的：
//     条是“剩余”百分比 = 100 - used*100（CodeArts 那个 98.5% 就是
//     这么来的：286/18,600 用了 1.5%，剩 98.5%）；
//     右上角有 amount/limit 就显示“已用 / 总量”（286 / 18,600，
//     千分位），没有就显示重置日期“12/19 重置 (24d)”；
//     橙色 pill 是 runsOut（“100 · 11/26 过期”：100 个点数 11/26 过期）；
//     明细行优先用 balanceParts（“基础积分包 余 500/500 ·
//     赠送积分包 余 17,814/18,100”，label + text 用 · 连），
//     没有 balanceParts 就用这个账号今日在 usage.accounts 里的
//     用量（“今日 56 次 · 2.7M tok · $2.93”）；
//     一张卡有多个窗口时取重置最晚的那个当主窗口（Codex 的 5h
//     窗口不画，只画 12/19 重置的那个）。
//   四个接口并行拉，各自 try/catch：用量拉不到就报错 + 显示缓存，
//   额度卡拉不到就只显示用量（页脚提示一句），/v1 拉不到就
//   不显示版本和模型数，7d 拉不到就不显示页脚那半句。
//   周期固定是今日（today），App 里的周期选择已经拿掉了。
//
// 取数和京东那两个小组件一样：小组件自己拉，用系统原生超时
// AbortSignal.timeout()，不用 setTimeout（在小组件里靠不住）；
// 拉不到就显示缓存，绝不转圈。配置（服务器地址、网关 Key）
// 存在共享 Storage 'magpie_config'，App 里填一次，小组件自己读；
// Key 只存在手机本地，不上 GitHub。

const CACHE_KEY = 'magpie_usage'
const CONFIG_KEY = 'magpie_config'
const CACHE_FILE = 'cache.json'
const CONFIG_FILE = 'preference.json'
const CACHE_VERSION = 3
const FETCH_TIMEOUT = 8000
// 统计口径：当天（period=today，Magpie 里 Today="today"，
// 从今天 0 点算起，series 按小时）。注意 Magpie 的周期值不是
// today/week/month/all，而是 today/7d/30d/all——
// Week="7d"、Month="30d"；以前传 period=month 会被当成未知值，
// 静默回落到 30d（internal/usageapi/usageapi.go 的 PeriodOf）。
// 页脚的“7 日 N 次”另外拉 period=7d 的 Totals.calls。
const PERIOD = 'today'
const WEEK_PERIOD = '7d'
// 自动更新：每天 9–22 点，每小时整点更新一次（和京东那两个一样，
// 按整点时段算：上次更新在当前整点之前才拉，手动刷新不影响下一个整点）。
function currentSlot(now: Date): Date {
  const s = new Date(now)
  const h = s.getHours()
  s.setMinutes(0, 0, 0)
  if (h < 9) {
    s.setDate(s.getDate() - 1)
    s.setHours(22, 0, 0, 0)
  } else if (h > 22) {
    s.setHours(22, 0, 0, 0)
  }
  return s
}

function nextSlot(now: Date): Date {
  const s = new Date(now)
  const h = s.getHours()
  if (h < 9) s.setHours(9, 0, 0, 0)
  else if (h >= 22) {
    s.setDate(s.getDate() + 1)
    s.setHours(9, 0, 0, 0)
  } else s.setHours(h + 1, 0, 0, 0)
  return s
}

interface ModelRow {
  name: string
  sub: string
  calls: number
  tokens: number // 网页排行口径：input + output + cache_read + cache_write
  cost: number
  errors: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheUnknown: number
  timed: number
  ttftMs: number
  decodeMs: number
  decodeOut: number
  decodeN: number
  floorMs: number
  floorOut: number
  floorN: number
  rates: any // { s: {bin: 条数}, f: {bin: 条数} }，没有就是 null
}

// 新旧两种字段名都认：接口回来是下划线，老缓存里是驼峰；
// 老缓存的 models 只有 tokens（input+output 口径），input/output
// 都是 0 时就沿用它存的 tokens，等下次拉取再按新口径算。
function normalizeModel(m: any): ModelRow {
  const input = Number(m.input) || 0
  const output = Number(m.output) || 0
  const cacheRead = Number(m.cache_read ?? m.cacheRead) || 0
  const cacheWrite = Number(m.cache_write ?? m.cacheWrite) || 0
  const sum = input + output + cacheRead + cacheWrite
  return {
    name: String(m.name || m.id || ''),
    sub: String(m.sub || m.provider || ''),
    calls: Number(m.calls) || 0,
    tokens: sum || Number(m.tokens) || 0,
    cost: Number(m.cost) || 0,
    errors: Number(m.errors) || 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    cacheUnknown: Number(m.cache_unknown ?? m.cacheUnknown) || 0,
    timed: Number(m.timed) || 0,
    ttftMs: Number(m.ttft_ms ?? m.ttftMs) || 0,
    decodeMs: Number(m.decode_ms ?? m.decodeMs) || 0,
    decodeOut: Number(m.decode_out ?? m.decodeOut) || 0,
    decodeN: Number(m.decode_n ?? m.decodeN) || 0,
    floorMs: Number(m.floor_ms ?? m.floorMs) || 0,
    floorOut: Number(m.floor_out ?? m.floorOut) || 0,
    floorN: Number(m.floor_n ?? m.floorN) || 0,
    rates: m.rates && typeof m.rates === 'object' ? m.rates : null,
  }
}

interface QuotaWindow {
  name: string
  used: number // 0-1 的已用占比，-1 表示没读到
  resetsAt: number // 毫秒时间戳，0 表示没有
  amount: number
  limit: number
  unit: string
  runsOut: number
  runsOutAt: number // 毫秒时间戳，0 表示没有
  balance: number | null
  display: string
  text: boolean
  unlimited: boolean
}

function normalizeWindow(w: any): QuotaWindow {
  const resets = w.resetsAt ? new Date(w.resetsAt).getTime() : 0
  const runsOut = w.runsOutAt ? new Date(w.runsOutAt).getTime() : 0
  return {
    name: String(w.name || ''),
    used: w.used == null ? -1 : Number(w.used) || 0,
    resetsAt: isNaN(resets) ? 0 : resets,
    amount: Number(w.amount) || 0,
    limit: Number(w.limit) || 0,
    unit: String(w.unit || ''),
    runsOut: Number(w.runsOut) || 0,
    runsOutAt: isNaN(runsOut) ? 0 : runsOut,
    balance: w.balance == null ? null : Number(w.balance),
    display: String(w.display || ''),
    text: !!w.text,
    unlimited: !!w.unlimited,
  }
}

interface BalancePart {
  label: string
  text: string
}

interface QuotaCard {
  provider: string
  name: string
  plan: string
  user: string
  windows: QuotaWindow[]
  balance: string
  balanceParts: BalancePart[]
  error: string
}

function normalizeCard(q: any): QuotaCard {
  return {
    provider: String(q.provider || ''),
    name: String(q.name || q.provider || ''),
    plan: String(q.plan || ''),
    user: String(q.user || ''),
    windows: Array.isArray(q.windows) ? q.windows.map(normalizeWindow) : [],
    balance: String(q.balance || ''),
    balanceParts: Array.isArray(q.balanceParts)
      ? q.balanceParts.map((p: any) => ({
          label: String(p.label || ''),
          text: String(p.text || ''),
        }))
      : [],
    error: String(q.error || ''),
  }
}

interface AccountRow {
  provider: string
  account: string
  name: string
  calls: number
  tokens: number
  cost: number
}

interface UsageData {
  v: number
  period: string
  calls: number
  errors: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
  tokens: number // 总 Token 口径：input+output+cache_read+cache_write
  timed: number
  ttftMs: number
  decodeMs: number
  decodeOut: number
  decodeN: number
  floorMs: number
  floorOut: number
  floorN: number
  rates: any
  models: ModelRow[]
  totalTokens: number // 全部模型的 token 之和
  accounts: AccountRow[]
  weekCalls: number // 近 7 日请求数（period=7d 那次的 Totals.calls），页脚用；0 表示未知
  sessionCount: number
  version: string
  modelCount: number
  cards: QuotaCard[]
  updatedAt: string
  updatedTs: number
  fromCache: boolean
  error: string
  cardsError: string
}

interface Config {
  base: string
  key: string
}

function fetchWithTimeout(url: string, init: any, ms: number): Promise<any> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
}

async function readJsonFile(name: string): Promise<any> {
  try {
    const p = FileManager.appGroupDocumentsDirectory + '/' + Script.name + '/' + name
    if (!FileManager.fileExists(p)) return null
    const text = FileManager.readString(p)
    if (!text) return null
    return JSON.parse(text)
  } catch (e) {
    return null
  }
}

function getConfig(): Config {
  let cfg: any = null
  try {
    cfg = Storage.get(CONFIG_KEY, { shared: true })
  } catch (e) {}
  return {
    base: cfg && cfg.base ? String(cfg.base).replace(/\/$/, '') : '',
    key: cfg && cfg.key ? String(cfg.key) : '',
  }
}

async function getConfigAsync(): Promise<Config> {
  const cfg = getConfig()
  if (cfg.base && cfg.key) return cfg
  const pref = await readJsonFile(CONFIG_FILE)
  if (pref) {
    return {
      base: pref.base ? String(pref.base).replace(/\/$/, '') : cfg.base,
      key: pref.key ? String(pref.key) : cfg.key,
    }
  }
  return cfg
}

function normalizeBase(b: string): string {
  let s = b.trim()
  const q = s.search(/[?#]/)
  if (q >= 0) s = s.slice(0, q)
  const m = s.match(/^(https?:\/\/[^/]+)(\/.*)?$/)
  if (m) s = m[1]
  return s.replace(/\/$/, '')
}

async function fetchJson(url: string, key: string): Promise<any> {
  let res: any
  try {
    res = await fetchWithTimeout(
      url,
      { headers: { Authorization: 'Bearer ' + key.trim(), Accept: 'application/json' } },
      FETCH_TIMEOUT,
    )
  } catch (e) {
    throw new Error('请求失败')
  }
  if (res.status === 401) throw new Error('Key 不对（401）')
  if (res.status === 403) throw new Error('没开局域网共享或 Key 没权限（403）')
  if (res.status !== 200) throw new Error(`HTTP${res.status}`)
  let j: any = null
  const text = await res.text()
  try {
    j = text && text.trim() ? JSON.parse(text) : null
  } catch (e) {
    throw new Error('非JSON')
  }
  if (!j) throw new Error('无返回')
  if (j.error) throw new Error(j.error.message || j.error.code || '请求被拒')
  return j
}

// 直方图的中值：和网页 ledHistMedian 一样——bin 的中值是
// 1.02^(bin-399.5)，取中间一条（偶数条取中间两条的平均）。
function histMedian(h: any): number {
  if (!h || typeof h !== 'object') return 0
  const bins = Object.keys(h)
    .map(Number)
    .sort((a, b) => a - b)
  let n = 0
  for (const b of bins) n += Number(h[String(b)]) || 0
  if (n === 0) return 0
  const lo = Math.floor((n - 1) / 2)
  const hi = Math.floor(n / 2)
  let seen = 0
  let sum = 0
  for (const b of bins) {
    const c = Number(h[String(b)]) || 0
    for (const i of [lo, hi]) {
      if (i >= seen && i < seen + c) sum += Math.pow(1.02, b - 399.5)
    }
    seen += c
  }
  return sum / 2
}

// 整体输出速度（token/秒）：和网页 ledSpeed 一样——
// 有直方图且不止一条取中值，只有一条按实测算。
function overallSpeed(d: UsageData): number {
  if (d.rates && d.decodeN !== 1) return histMedian(d.rates.s)
  if (d.decodeMs > 0) return (1000 * d.decodeOut) / d.decodeMs
  return 0
}

// 平均首字等待（毫秒）：ttft_ms / timed。
function overallTTFT(d: UsageData): number {
  return d.timed > 0 ? d.ttftMs / d.timed : 0
}

function emptyData(): UsageData {
  return {
    v: CACHE_VERSION,
    period: PERIOD,
    calls: 0,
    errors: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    tokens: 0,
    timed: 0,
    ttftMs: 0,
    decodeMs: 0,
    decodeOut: 0,
    decodeN: 0,
    floorMs: 0,
    floorOut: 0,
    floorN: 0,
    rates: null,
    models: [],
    totalTokens: 0,
    accounts: [],
    weekCalls: 0,
    sessionCount: 0,
    version: '',
    modelCount: 0,
    cards: [],
    updatedAt: '',
    updatedTs: 0,
    fromCache: true,
    error: '',
    cardsError: '',
  }
}

// 老缓存升级：模型按新口径重算、取前 4；
// 缺了新字段的（v 不是 3）直接作废重拉，免得旧 30 日
// 数据顶着“今日”的名头显示。
function normalizeCached(c: any): UsageData | null {
  if (!c || typeof c !== 'object' || typeof c.calls !== 'number') return null
  if (c.v !== CACHE_VERSION) return null
  const d = { ...emptyData(), ...c, fromCache: true } as UsageData
  d.models = (c.models || [])
    .map((m: any) => normalizeModel(m))
    .filter((m: ModelRow) => m.name)
    .sort((a: ModelRow, b: ModelRow) => b.tokens - a.tokens)
    .slice(0, 4)
  d.totalTokens = d.models.reduce((s: number, m: ModelRow) => s + m.tokens, 0)
  d.cards = Array.isArray(c.cards) ? c.cards.map(normalizeCard) : []
  d.accounts = Array.isArray(c.accounts) ? c.accounts : []
  d.weekCalls = typeof c.weekCalls === 'number' ? c.weekCalls : 0
  return d
}

async function loadData(): Promise<{ data: UsageData; cfg: Config }> {
  const cfg = await getConfigAsync()
  let cached: UsageData | null = null
  try {
    const c: any = Storage.get(CACHE_KEY, { shared: true })
    cached = normalizeCached(c)
  } catch (e) {}
  if (!cached) {
    const f = await readJsonFile(CACHE_FILE)
    cached = normalizeCached(f)
  }
  if (!cfg.base) {
    const d = cached || emptyData()
    return { data: { ...d, error: '还没填服务器地址' }, cfg }
  }
  if (!cfg.key) {
    const d = cached || emptyData()
    return { data: { ...d, error: '还没填网关 Key' }, cfg }
  }
  // 整点时段制：上次更新在当前整点之前才拉
  const slot = currentSlot(new Date()).getTime()
  if (cached && cached.updatedTs && cached.updatedTs >= slot) return { data: cached, cfg }
  const base = normalizeBase(cfg.base)
  const key = cfg.key
  // 四个接口并行拉：今日用量是主数据，拉不到整个刷新失败；
  // /v1、额度卡、近 7 日用量各自失败不连累别的（只丢版本/模型数、
  // 额度卡或页脚的 7 日数）。
  const usageP = fetchJson(base + `/v1/magpie/usage?period=${PERIOD}`, key)
  const infoP = fetchJson(base + '/v1', key).catch(() => null)
  const cardsP = fetchJson(base + '/v1/magpie/quotas/cards', key).catch(() => null)
  const weekP = fetchJson(base + `/v1/magpie/usage?period=${WEEK_PERIOD}`, key).catch(() => null)
  let usage: any = null
  let usageErr = ''
  try {
    usage = await usageP
  } catch (e: any) {
    usageErr = e && e.message ? e.message : '拉取失败'
  }
  const [info, cards, week] = await Promise.all([infoP, cardsP, weekP])
  if (!usage) {
    const d = cached || emptyData()
    return { data: { ...d, error: usageErr || '拉取失败' }, cfg }
  }
  const j = usage
  const input = Number(j.input) || 0
  const output = Number(j.output) || 0
  const cacheRead = Number(j.cache_read) || 0
  const cacheWrite = Number(j.cache_write) || 0
  const models: ModelRow[] = Array.isArray(j.models)
    ? j.models
        .map((m: any) => normalizeModel(m))
        .filter((m: ModelRow) => m.name)
        .sort((a: ModelRow, b: ModelRow) => b.tokens - a.tokens)
    : []
  const totalTokens = models.reduce((s: number, m: ModelRow) => s + m.tokens, 0)
  const accounts: AccountRow[] = Array.isArray(j.accounts)
    ? j.accounts.map((a: any) => {
        const ai = Number(a.input) || 0
        const ao = Number(a.output) || 0
        const acr = Number(a.cache_read) || 0
        const acw = Number(a.cache_write) || 0
        return {
          provider: String(a.provider || ''),
          account: String(a.account || ''),
          name: String(a.name || a.account || a.provider || ''),
          calls: Number(a.calls) || 0,
          tokens: ai + ao + acr + acw,
          cost: Number(a.cost) || 0,
        }
      })
    : []
  const weekCalls = week ? Number(week.calls) || 0 : 0
  const now = new Date()
  let version = ''
  let modelCount = 0
  if (info) {
    const v = String(info.version || '')
    version = v ? (v.startsWith('v') ? v : 'v' + v) : ''
    modelCount = Number(info.models) || 0
  }
  const fresh: UsageData = {
    v: CACHE_VERSION,
    period: PERIOD,
    calls: Number(j.calls) || 0,
    errors: Number(j.errors) || 0,
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: Number(j.cost) || 0,
    tokens: input + output + cacheRead + cacheWrite,
    timed: Number(j.timed) || 0,
    ttftMs: Number(j.ttft_ms) || 0,
    decodeMs: Number(j.decode_ms) || 0,
    decodeOut: Number(j.decode_out) || 0,
    decodeN: Number(j.decode_n) || 0,
    floorMs: Number(j.floor_ms) || 0,
    floorOut: Number(j.floor_out) || 0,
    floorN: Number(j.floor_n) || 0,
    rates: j.rates && typeof j.rates === 'object' ? j.rates : null,
    models: models.slice(0, 4),
    totalTokens,
    accounts,
    weekCalls,
    sessionCount: Number(j.sessionCount) || 0,
    version,
    modelCount,
    cards: Array.isArray(cards) ? cards.map(normalizeCard).filter((c: QuotaCard) => c.name) : [],
    updatedAt: fmtTimeShort(now),
    updatedTs: now.getTime(),
    fromCache: false,
    error: '',
    cardsError: cards ? '' : '额度卡没拉到',
  }
  try {
    Storage.set(CACHE_KEY, fresh, { shared: true })
  } catch (e) {}
  return { data: fresh, cfg }
}

// ---- 视图 ----

// 模型名只留最后一段，不带供应商前缀：
// nvidia/nemotron-3.5-super-vl:free -> nemotron-3.5-super-vl:free
function shortModelName(name: string): string {
  const i = name.lastIndexOf('/')
  return i >= 0 ? name.slice(i + 1) : name
}

// 剩余百分比：整数就整数（90%），不整就一位小数（98.5%）。
function fmtRemain(rem: number): string {
  const r = Math.max(0, Math.min(100, rem))
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + '%'
}

// 秒数：6.4s、12s 这样，<1 秒显示毫秒。
function fmtSecs(ms: number): string {
  const r = Math.round(ms)
  if (r < 1000) return `${r}毫秒`
  const s = r / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
}

// 一张卡的主窗口：有已用占比、不是纯文本行的窗口里，
// 取重置最晚的那个（Codex 的 5h 窗口不画，只画 12/19 那个）；
// 没有就取第一个有占比的；都没有就 null（只剩余额的卡）。
function primaryWindow(card: QuotaCard): QuotaWindow | null {
  const withUsed = card.windows.filter((w) => !w.text && !w.unlimited && w.used >= 0)
  if (!withUsed.length) return null
  const withReset = withUsed.filter((w) => w.resetsAt > 0)
  const pool = withReset.length ? withReset : withUsed
  let best = pool[0]
  for (const w of pool) {
    if (w.resetsAt > best.resetsAt) best = w
  }
  return best
}

// 卡右上角：有 amount/limit 就“已用 / 总量”，
// 没有就重置日期，什么都没有就空着。
function cardRightText(card: QuotaCard, w: QuotaWindow | null): string {
  if (w && w.limit > 0) return `${fmtNum(w.amount)} / ${fmtNum(w.limit)}`
  if (w && w.resetsAt > 0) {
    const d = new Date(w.resetsAt)
    const days = Math.ceil((w.resetsAt - Date.now()) / 86400000)
    return days > 0 ? `${fmtDate(d)} 重置 (${days}d)` : `${fmtDate(d)} 重置`
  }
  if (card.balance) return card.balance
  return ''
}

// 橙色 pill：最近要过期的点数（runsOut），“100 · 11/26 过期”。
function runsOutPill(card: QuotaCard): string {
  const now = Date.now()
  for (const w of card.windows) {
    if (w.runsOut > 0 && w.runsOutAt > now) {
      return `${fmtNum(w.runsOut)} · ${fmtDate(new Date(w.runsOutAt))} 过期`
    }
  }
  return ''
}

// 找到这个账号今日在 usage.accounts 里的用量行。
function accountUsage(data: UsageData, card: QuotaCard): AccountRow | null {
  const user = card.user.toLowerCase()
  for (const a of data.accounts) {
    if (a.provider !== card.provider) continue
    if (user && a.account && a.account.toLowerCase() !== user) continue
    return a
  }
  for (const a of data.accounts) {
    if (a.provider === card.provider) return a
  }
  return null
}

// 卡明细行：优先 balanceParts（“基础积分包 余 500/500 ·
// 赠送积分包 余 17,814/18,100”），没有就用账号今日用量
// （“今日 56 次 · 2.7M tok · $2.93”），再没有就用窗口的
// display，都没有就不画这行。
function cardDetail(data: UsageData, card: QuotaCard): string {
  if (card.balanceParts.length) {
    return card.balanceParts
      .map((p) => (p.label ? `${p.label} ${p.text}` : p.text))
      .filter((s) => s)
      .join(' · ')
  }
  const a = accountUsage(data, card)
  if (a && a.calls > 0) {
    return `今日 ${fmtNum(a.calls)} 次 · ${fmtTokens(a.tokens)} tok · ${fmtCost(a.cost)}`
  }
  const w = primaryWindow(card)
  if (w && w.display) return w.display
  return ''
}

function Pill({ text, kind }: { text: string; kind: 'plan' | 'warn' }) {
  const bg = kind === 'plan' ? 'rgba(124,58,237,0.12)' : 'rgba(245,158,11,0.15)'
  const fg = kind === 'plan' ? 'rgba(124,58,237,1)' : 'rgba(217,119,6,1)'
  return (
    <Text
      font={10} fontWeight="semibold" foregroundStyle={fg}
      padding={{ horizontal: 6, vertical: 2 }}
      background={{ shape: { type: 'rect', cornerRadius: 5 }, style: bg }}
    >
      {text}
    </Text>
  )
}

function Hairline({ w }: { w: number }) {
  return <Capsule frame={{ width: w, height: 1 }} fill="rgba(0,0,0,0.08)" />
}

function Header({ data, minimal }: { data: UsageData; minimal?: boolean }) {
  const sub =
    data.version && data.modelCount > 0
      ? `${data.version} · ${data.modelCount} 模型`
      : data.version || ''
  return (
    <HStack alignment="center" spacing={6}>
      <Text
        font={13} fontWeight="bold"
        foregroundStyle="white"
        padding={5}
        background={{ shape: 'circle', style: 'rgba(124,58,237,1)' }}
      >
        M
      </Text>
      <Text font={minimal ? 13 : 15} fontWeight="bold">Magpie</Text>
      {!minimal && sub ? (
        <Text font={11} foregroundStyle="secondaryLabel">
          {sub}
        </Text>
      ) : null}
      <Spacer />
      {!minimal ? (
        <Text
          font={13} fontWeight="bold"
          foregroundStyle="rgba(124,58,237,1)"
          padding={4}
          background={{ shape: 'circle', style: 'rgba(124,58,237,0.1)' }}
        >
          ↻
        </Text>
      ) : null}
    </HStack>
  )
}

function QuotaBar({ rem, barW, hidePct }: { rem: number; barW: number; hidePct?: boolean }) {
  const frac = Math.max(0.02, Math.min(1, rem / 100))
  return (
    <HStack alignment="center" spacing={6}>
      <ZStack alignment="leading">
        <Capsule frame={{ width: barW, height: 7 }} fill="rgba(0,0,0,0.08)" />
        <Capsule frame={{ width: Math.max(4, barW * frac), height: 7 }} fill="rgba(16,185,129,1)" />
      </ZStack>
      {hidePct ? null : (
        <Text font={12} fontWeight="bold" foregroundStyle="rgba(16,185,129,1)">
          {fmtRemain(rem)}
        </Text>
      )}
    </HStack>
  )
}

function QuotaCardView({
  data,
  card,
  barW,
}: {
  data: UsageData
  card: QuotaCard
  barW: number
}) {
  const w = primaryWindow(card)
  const rem = w ? 100 - w.used * 100 : null
  const right = cardRightText(card, w)
  const detail = cardDetail(data, card)
  const pill = runsOutPill(card)
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack alignment="center" spacing={4}>
        <Text font={14} fontWeight="bold">
          {card.name}
        </Text>
        {card.plan ? <Pill text={card.plan} kind="plan" /> : null}
        {pill ? <Pill text={pill} kind="warn" /> : null}
        <Spacer />
        {right ? (
          <Text font={11} foregroundStyle="secondaryLabel">
            {right}
          </Text>
        ) : null}
      </HStack>
      {rem !== null ? <QuotaBar rem={rem} barW={barW} /> : null}
      {rem === null && card.balance ? (
        <Text font={11} foregroundStyle="secondaryLabel">
          {card.balance}
        </Text>
      ) : null}
      {detail ? (
        <Text font={11} foregroundStyle="secondaryLabel">
          {detail}
        </Text>
      ) : null}
      {card.error ? (
        <Text font={11} foregroundStyle="rgba(239,68,68,1)">
          {card.error}
        </Text>
      ) : null}
    </VStack>
  )
}

function StatCell({
  label,
  value,
  color,
  w,
  valueFont = 20,
}: {
  label: string
  value: string
  color: string
  w: number
  valueFont?: number
}) {
  return (
    <VStack alignment="leading" spacing={1} frame={{ width: w }}>
      <Text font={11} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Text font={valueFont} fontWeight="bold" foregroundStyle={color}>
        {value}
      </Text>
    </VStack>
  )
}

function StatsRow({ data, pad = 16, valueFont = 20 }: { data: UsageData; pad?: number; valueFont?: number }) {
  const W = Widget.displaySize.width
  const cellW = (W - 2 * pad) / 4
  const success = data.calls > 0 ? (100 * (data.calls - data.errors)) / data.calls : 100
  const speed = overallSpeed(data)
  return (
    <HStack alignment="top" spacing={0}>
      <StatCell label="今日调用" value={fmtNum(data.calls)} color="rgba(17,17,17,1)" w={cellW} valueFont={valueFont} />
      <StatCell
        label="成功率"
        value={success.toFixed(1) + '%'}
        color={success >= 100 ? 'rgba(16,185,129,1)' : 'rgba(245,158,11,1)'}
        w={cellW}
        valueFont={valueFont}
      />
      <StatCell label="估算费用" value={fmtCost(data.cost)} color="rgba(124,58,237,1)" w={cellW} valueFont={valueFont} />
      <StatCell
        label="输出速度"
        value={speed > 0 ? `${Math.round(speed)} t/s` : '—'}
        color="rgba(16,185,129,1)"
        w={cellW}
        valueFont={valueFont}
      />
    </HStack>
  )
}

// 页脚左半句：N/N 账号在线，7 日数只在拉到时才写
// （weekCalls 为 0 表示那次没拉到，不写，免得显示“7日 0 次”误导）。
function footerLeft(data: UsageData): string {
  const online = data.cards.filter((c) => !c.error).length
  const parts: string[] = []
  if (data.cards.length > 0) parts.push(`${online}/${data.cards.length} 账号在线`)
  if (data.weekCalls > 0) parts.push(`7日 ${fmtNum(data.weekCalls)} 次`)
  return parts.join(' · ')
}

function SubLine({ data }: { data: UsageData }) {
  const parts: string[] = []
  const ttft = overallTTFT(data)
  if (ttft > 0) parts.push(`首字 ${fmtSecs(ttft)}`)
  parts.push(`总 Token ${fmtTokens(data.tokens)} (缓存 ${fmtTokens(data.cacheRead)})`)
  return (
    <Text font={11} foregroundStyle="secondaryLabel">
      {parts.join(' · ')}
    </Text>
  )
}

function HotModels({
  data,
  count = 4,
  gap = 3,
  rowFont = 13,
  slim = false,
}: {
  data: UsageData
  count?: number
  gap?: number
  rowFont?: number
  slim?: boolean
}) {
  const models = data.models.slice(0, count)
  if (!models.length) return null
  return (
    <VStack alignment="leading" spacing={gap}>
      <HStack alignment="center" spacing={4}>
        <Text font={12} fontWeight="semibold">热门模型（今日）</Text>
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {slim ? 'Token' : 'Token / 调用'}
        </Text>
      </HStack>
      {models.map((m, i) =>
        slim ? (
          <HStack key={i} alignment="center" spacing={6}>
            <Text font={rowFont} fontWeight="semibold" minScaleFactor={0.8}>
              {shortModelName(m.name)}
            </Text>
            <Spacer />
            <Text font={rowFont}>{fmtTokens(m.tokens)}</Text>
          </HStack>
        ) : (
          <HStack key={i} alignment="center" spacing={6}>
            <Text font={11} foregroundStyle="secondaryLabel">
              {String(i + 1).padStart(2, '0')}
            </Text>
            <Text font={rowFont} fontWeight="semibold" minScaleFactor={0.8}>
              {shortModelName(m.name)}
            </Text>
            <Spacer />
            <Text font={rowFont}>{fmtTokens(m.tokens)}</Text>
            <Text font={rowFont} foregroundStyle="secondaryLabel">
              {fmtNum(m.calls)} 次
            </Text>
          </HStack>
        ),
      )}
    </VStack>
  )
}

function LargeView({ data }: { data: UsageData }) {
  const W = Widget.displaySize.width
  const contentW = W - 32
  const barW = contentW - 48
  return (
    <VStack alignment="leading" spacing={6} padding={{ horizontal: 16, vertical: 12 }}>
      <Header data={data} />
      {data.cards.slice(0, 2).map((c, i) => (
        <QuotaCardView key={i} data={data} card={c} barW={barW} />
      ))}
      {data.cards.length === 0 && data.cardsError ? (
        <Text font={11} foregroundStyle="secondaryLabel">
          {data.cardsError}
        </Text>
      ) : null}
      <Hairline w={contentW} />
      <StatsRow data={data} />
      <SubLine data={data} />
      <Hairline w={contentW} />
      <HotModels data={data} />
      <Spacer />
      <HStack alignment="center" spacing={4}>
        {footerLeft(data) ? (
          <Text font={11} foregroundStyle="secondaryLabel">
            {footerLeft(data)}
          </Text>
        ) : null}
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {data.updatedAt ? `更新于 ${data.updatedAt}` : '暂无数据'}
          {data.error ? ` · ${data.error}` : ''}
        </Text>
      </HStack>
    </VStack>
  )
}

// 小号统计格：标签 + 数字同一行（155 宽放不下上下两行的 2×2 大数字格）。
function SmallStat({
  label,
  value,
  color,
  w,
}: {
  label: string
  value: string
  color: string
  w: number
}) {
  return (
    <HStack alignment="center" spacing={3} frame={{ width: w }}>
      <Text font={10} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Text font={12} fontWeight="bold" foregroundStyle={color} minScaleFactor={0.85}>
        {value}
      </Text>
    </HStack>
  )
}

function CompactView({ data }: { data: UsageData }) {
  const W = Widget.displaySize.width
  const isSmall = Widget.family === 'systemSmall' || (!Widget.family && W < 200)
  const contentW = W - 24
  const footerRight = data.updatedAt ? `更新于 ${data.updatedAt}` : '暂无数据'
  if (isSmall) {
    // 小号：顶栏 + 2×2 单行统计格 + 热门模型前 3（精简行）+ 更新时间。
    // 顶栏和更新时间是 john 点名要的；155×155 塞不下 2 行大数字格，
    // 所以统计改成一行一个小格（标签 10 号、数字 12 号）。
    const cellW = contentW / 2
    const success = data.calls > 0 ? (100 * (data.calls - data.errors)) / data.calls : 100
    const speed = overallSpeed(data)
    return (
      <VStack alignment="leading" spacing={3} padding={{ horizontal: 12, vertical: 4 }}>
        <Header data={data} minimal />
        <VStack alignment="leading" spacing={3}>
          <HStack alignment="center" spacing={0}>
            <SmallStat label="调用" value={fmtNum(data.calls)} color="rgba(17,17,17,1)" w={cellW} />
            <SmallStat
              label="成功率"
              value={success.toFixed(1) + '%'}
              color={success >= 100 ? 'rgba(16,185,129,1)' : 'rgba(245,158,11,1)'}
              w={cellW}
            />
          </HStack>
          <HStack alignment="center" spacing={0}>
            <SmallStat label="费用" value={fmtCost(data.cost)} color="rgba(124,58,237,1)" w={cellW} />
            <SmallStat
              label="速度"
              value={speed > 0 ? `${Math.round(speed)} t/s` : '—'}
              color="rgba(16,185,129,1)"
              w={cellW}
            />
          </HStack>
        </VStack>
        <HotModels data={data} count={3} gap={2} rowFont={12} slim />
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {footerRight}
          {data.error ? ` · ${data.error}` : ''}
        </Text>
      </VStack>
    )
  }
  // 中号：统计行 + 明细行 + 热门模型前 3 + 页脚。155 高很紧，
  // 间距收到 4、上下留白收到 5、统计数字 18 号、模型行 12 号，
  // 刚好放得下（真机上以实际显示为准）。
  return (
    <VStack alignment="leading" spacing={4} padding={{ horizontal: 12, vertical: 5 }}>
      <StatsRow data={data} pad={12} valueFont={18} />
      <SubLine data={data} />
      <HotModels data={data} count={3} gap={2} rowFont={12} />
      <Spacer />
      <HStack alignment="center" spacing={4}>
        {footerLeft(data) ? (
          <Text font={11} foregroundStyle="secondaryLabel">
            {footerLeft(data)}
          </Text>
        ) : null}
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {footerRight}
          {data.error ? ` · ${data.error}` : ''}
        </Text>
      </HStack>
    </VStack>
  )
}

function LockCircularView({ data }: { data: UsageData }) {
  return (
    <VStack alignment="center" spacing={1} padding={8}>
      <Text font={26} fontWeight="bold">{fmtTokens(data.tokens)}</Text>
      <Text font={11} foregroundStyle="secondaryLabel">
        Token
      </Text>
    </VStack>
  )
}

function LockRectangularView({ data }: { data: UsageData }) {
  return (
    <VStack alignment="leading" spacing={2} padding={{ horizontal: 12, vertical: 8 }}>
      <Text font={13} fontWeight="bold">Magpie · 今日</Text>
      <Text font={12}>
        {fmtNum(data.calls)} 次请求 · {fmtCost(data.cost)}
      </Text>
    </VStack>
  )
}

;(async () => {
  const { data } = await loadData()
  const family = Widget.family
  let view: any
  if (family === 'accessoryCircular') view = <LockCircularView data={data} />
  else if (family === 'accessoryRectangular') view = <LockRectangularView data={data} />
  else if (family === 'systemLarge' || family === 'systemExtraLarge') view = <LargeView data={data} />
  else view = <CompactView data={data} />

  Widget.present(view, {
    reloadPolicy: {
      policy: 'after',
      date: nextSlot(new Date()),
    },
  })
})()
