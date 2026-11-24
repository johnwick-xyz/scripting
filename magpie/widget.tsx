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
import { rpt, fmtTimeShort, fmtTokens, fmtCost, fmtCostWeb, fmtNum } from './utils'

// Magpie Scripting 小组件
// Magpie 是 yetone 的本地 AI 网关（Docker 跑在 john 的 Debian 服务器上，
// 网关 3425，Web UI 3430），所有 coding agent 的模型都走它。
//
// 接口（Magpie 自己的网关 API，源码 internal/gateway/usage_api.go）：
//   GET {base}/v1/magpie/usage?period=today|week|month|all
//   Header: Authorization: Bearer <网关 Key>（或 x-api-key）
//   回来是 Usage 页的汇总 JSON：顶层就是 Totals——
//   calls（请求数）、errors、input、output、cache_read、cache_write、
//   reasoning、cost（美元）、unpriced，还有 models[]（Group：name、sub
//   供应商名、再加 Totals 全套：timed、ttft_ms、decode_ms/out/n、
//   floor_ms/out/n、rates 直方图、cache_unknown）、agents[]、sessions[]、
//   sessionCount、series[]（时间轴，每点有 calls）。
//   网页 Usage 页的模型排行（drawLedRank，metric=tokens）：
//   排按 token 数（input+output+cache_read+cache_write），
//   右边大数是这个口径，条按第一名算占比，明细行是
//   请求 · 费用 · 速度 · 首字 · 命中率 · 占比 · 失败。
//   速度是计时回复的中值（rates 直方图的 bin 中值，bin 400 是 1，
//   每档 1.02 倍；只有一条时按 decode_out/decode_ms 实测算）；
//   首字是 ttft_ms/timed 的平均；命中率是
//   cache_read/(input+cache_read+cache_write-cache_unknown)。
//   注意：手机不是本机，所以必须同时满足两点：
//   1) Magpie 开了局域网共享（Web UI → Settings → Network and sharing
//      → Share on local network），否则 403；
//   2) 用网关 Key（不是 MAGPIE_WEB_KEY 那个网页 Key），只读 Key 就够，
//      在 Web UI → Gateway → Gateway keys 里建，或在服务器上
//      docker exec magpie magpie gateway-key add widget --read-only。
//   403 = 没开共享或 Key 没权限，401 = Key 不对。
//
// 取数和京东那两个小组件一样：小组件自己拉，用系统原生超时
// AbortSignal.timeout()，不用 setTimeout（在小组件里靠不住，
// 之前就是它让预览一直打圈圈）；拉不到就显示缓存，绝不转圈。
// 配置（服务器地址、网关 Key、周期）存在共享 Storage 'magpie_config'，
// App 里填一次，小组件自己读；Key 只存在手机本地，不上 GitHub。

const CACHE_KEY = 'magpie_usage'
const CONFIG_KEY = 'magpie_config'
const CACHE_FILE = 'cache.json'
const CONFIG_FILE = 'preference.json'
const FETCH_TIMEOUT = 8000
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

// 计时回复的写入速度（token/秒）：有直方图且不止一条取中值，
// 只有一条按实测算，和网页 ledSpeed 一样。
function modelSpeed(m: ModelRow): number {
  if (m.rates && m.decodeN !== 1) return histMedian(m.rates.s)
  if (m.decodeMs > 0) return (1000 * m.decodeOut) / m.decodeMs
  return 0
}

// 没计时的回复至少写多快（token/秒）：和网页 ledFloor 一样。
function modelFloor(m: ModelRow): number {
  if (m.rates && m.floorN !== 1) return histMedian(m.rates.f)
  if (m.floorMs > 0) return (1000 * m.floorOut) / m.floorMs
  return 0
}

// 平均首字等待（毫秒）：ttft_ms / timed。
function modelTTFT(m: ModelRow): number {
  return m.timed > 0 ? m.ttftMs / m.timed : 0
}

// 缓存命中率：cache_read / (input+cache_read+cache_write-cache_unknown)，
// 分母 <= 0 时没有（网页 cacheHitOf 一样）。
function modelHitRate(m: ModelRow): number | null {
  const p = m.input + m.cacheRead + m.cacheWrite - m.cacheUnknown
  if (p <= 0) return null
  return m.cacheRead / p
}

// 命中率：网页是两位小数，99.99 / 0.01 封顶。
function fmtHitRate(h: number): string {
  const s = (100 * h).toFixed(2)
  if (h < 1 && Number(s) >= 100) return '99.99%'
  if (h > 0 && Number(s) <= 0) return '0.01%'
  return s + '%'
}

// 等待时长：<1 秒显示毫秒，否则秒（<10 秒一位小数，否则整数），和网页 ledTook 一样。
function fmtTook(ms: number): string {
  const r = Math.round(ms)
  if (r < 1000) return `${r} 毫秒`
  const s = r / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} 秒`
}

// 速度那一段：实测 “147 token/秒 · 1 次计时”，没计时的
// “≥100 token/秒 · 30 次回复”，两样都有时条数多的在前，中间用 “；”。
function speedText(m: ModelRow): string {
  const v = modelSpeed(m)
  const f = modelFloor(m)
  const measured = v > 0 ? `${Math.round(v)} token/秒${m.decodeN > 0 ? ` · ${m.decodeN} 次计时` : ''}` : ''
  const floor = f > 0 ? `≥${Math.round(f)} token/秒${m.floorN > 0 ? ` · ${m.floorN} 次回复` : ''}` : ''
  if (measured && floor) {
    return m.floorN > m.decodeN ? `${floor}；${measured}` : `${measured}；${floor}`
  }
  return measured || floor
}

// 明细行：和网页排行行（rk-b）一样的顺序和内容——
// 请求 · 费用 · 速度 · 首字 · 命中率 · 占比 · 失败。
// 没有的项不写（费用 0、没计时、没缓存、没失败都跳过）。
function modelDetails(m: ModelRow, totalTokens: number): string {
  const parts: string[] = []
  parts.push(`${fmtNum(m.calls)} 个请求`)
  if (m.cost) parts.push(fmtCostWeb(m.cost))
  const sp = speedText(m)
  if (sp) parts.push(sp)
  const ttft = modelTTFT(m)
  if (ttft > 0) parts.push(`首字 ${fmtTook(ttft)}`)
  const hit = modelHitRate(m)
  if (hit !== null) parts.push(`命中率 ${fmtHitRate(hit)}`)
  if (totalTokens > 0) parts.push(`${Math.round((100 * m.tokens) / totalTokens)}%`)
  if (m.errors > 0) parts.push(`${m.errors} 失败`)
  return parts.join(' · ')
}

interface AgentRow {
  name: string
  calls: number
  tokens: number
  cost: number
}

interface UsageData {
  period: string
  calls: number
  errors: number
  input: number
  output: number
  cost: number
  tokens: number
  topModel: ModelRow | null
  topAgent: AgentRow | null
  models: ModelRow[]
  totalTokens: number // 全部模型的 token 之和，算占比的分母
  agents: AgentRow[]
  series: number[] // 每点请求数（今日按小时）
  sessionCount: number
  updatedAt: string
  updatedTs: number
  fromCache: boolean
  error: string
}

interface Config {
  base: string
  key: string
  period: string
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
  if (!cfg) {
    // 同步接口拿不到文件时再读 preference.json（App 写的那份）
  }
  return {
    base: cfg && cfg.base ? String(cfg.base).replace(/\/$/, '') : '',
    key: cfg && cfg.key ? String(cfg.key) : '',
    period: cfg && cfg.period ? String(cfg.period) : 'today',
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
      period: pref.period ? String(pref.period) : cfg.period,
    }
  }
  return cfg
}

function periodLabel(p: string): string {
  if (p === 'week') return '本周'
  if (p === 'month') return '本月'
  if (p === 'all') return '全部'
  return '今日'
}

function normalizeBase(b: string): string {
  let s = b.trim()
  const q = s.search(/[?#]/)
  if (q >= 0) s = s.slice(0, q)
  const m = s.match(/^(https?:\/\/[^/]+)(\/.*)?$/)
  if (m) s = m[1]
  return s.replace(/\/$/, '')
}

async function fetchUsage(base: string, key: string, period: string): Promise<UsageData> {
  // 地址栏只认 scheme://host:port：如果粘贴了网页带 ?k= 的完整网址，
  // 把 ?k=、# 和后面的路径都去掉，不然拼出来的 /v1/magpie/usage 请求不到正确位置。
  const url =
    normalizeBase(base) + `/v1/magpie/usage?period=${period}`
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
  const input = Number(j.input) || 0
  const output = Number(j.output) || 0
  const models: ModelRow[] = Array.isArray(j.models)
    ? j.models
        .map((m: any) => normalizeModel(m))
        .filter((m: ModelRow) => m.name)
        .sort((a: ModelRow, b: ModelRow) => b.tokens - a.tokens)
    : []
  const totalTokens = models.reduce((s: number, m: ModelRow) => s + m.tokens, 0)
  const agents: AgentRow[] = Array.isArray(j.agents)
    ? j.agents
        .map((a: any) => ({
          name: String(a.name || a.id || ''),
          calls: Number(a.calls) || 0,
          tokens: (Number(a.input) || 0) + (Number(a.output) || 0),
          cost: Number(a.cost) || 0,
        }))
        .filter((a: AgentRow) => a.name)
        .sort((a: AgentRow, b: AgentRow) => b.calls - a.calls)
    : []
  const series: number[] = Array.isArray(j.series)
    ? j.series.map((p: any) => Number(p.calls) || 0)
    : []
  const now = new Date()
  return {
    period,
    calls: Number(j.calls) || 0,
    errors: Number(j.errors) || 0,
    input,
    output,
    cost: Number(j.cost) || 0,
    tokens: input + output,
    topModel: models[0] || null,
    topAgent: agents[0] || null,
    models: models.slice(0, 3),
    totalTokens,
    agents: agents.slice(0, 2),
    series: series.slice(-12),
    sessionCount: Number(j.sessionCount) || 0,
    updatedAt: fmtTimeShort(now),
    updatedTs: now.getTime(),
    fromCache: false,
    error: '',
  }
}

function emptyData(period: string): UsageData {
  return {
    period,
    calls: 0,
    errors: 0,
    input: 0,
    output: 0,
    cost: 0,
    tokens: 0,
    topModel: null,
    topAgent: null,
    models: [],
    totalTokens: 0,
    agents: [],
    series: [],
    sessionCount: 0,
    updatedAt: '',
    updatedTs: 0,
    fromCache: true,
    error: '',
  }
}

async function loadData(): Promise<{ data: UsageData; cfg: Config }> {
  const cfg = await getConfigAsync()
  let cached: UsageData | null = null
  try {
    const c: any = Storage.get(CACHE_KEY, { shared: true })
    if (c && typeof c === 'object' && typeof c.calls === 'number') {
      cached = { ...c, fromCache: true } as UsageData
    }
  } catch (e) {}
  if (!cached) {
    const f = await readJsonFile(CACHE_FILE)
    if (f && typeof f.calls === 'number') cached = { ...f, fromCache: true }
  }
  if (cached) {
    // 老缓存的模型行按新口径重算（token 含缓存流量、按 token 排、前三个），
    // 占比分母也重算，免得旧缓存少了字段就显示 0。
    cached.models = (cached.models || [])
      .map((m: any) => normalizeModel(m))
      .filter((m: ModelRow) => m.name)
      .sort((a: ModelRow, b: ModelRow) => b.tokens - a.tokens)
      .slice(0, 3)
    cached.topModel = cached.models[0] || null
    cached.totalTokens = cached.models.reduce((s: number, m: ModelRow) => s + m.tokens, 0)
  }
  if (!cfg.base) {
    const d = cached || emptyData(cfg.period)
    return { data: { ...d, error: '还没填服务器地址' }, cfg }
  }
  if (!cfg.key) {
    const d = cached || emptyData(cfg.period)
    return { data: { ...d, error: '还没填网关 Key' }, cfg }
  }
  // 整点时段制：上次更新在当前整点之前才拉
  const slot = currentSlot(new Date()).getTime()
  if (cached && cached.updatedTs && cached.updatedTs >= slot) return { data: cached, cfg }
  try {
    const fresh = await fetchUsage(cfg.base, cfg.key, cfg.period)
    try {
      Storage.set(CACHE_KEY, fresh, { shared: true })
    } catch (e) {}
    return { data: fresh, cfg }
  } catch (e: any) {
    const d = cached || emptyData(cfg.period)
    return { data: { ...d, error: e && e.message ? e.message : '拉取失败' }, cfg }
  }
}

// ---- 视图 ----

function Header({ data, online, minimal }: { data: UsageData; online: boolean; minimal?: boolean }) {
  return (
    <HStack alignment="center" spacing={6}>
      <Text
        font={13} fontWeight="bold"
        foregroundStyle="white"
        padding={minimal ? 3 : 5}
        background={{ shape: 'circle', style: 'rgba(17,17,17,1)' }}
      >
        M
      </Text>
      <Text font={14} fontWeight="bold">Magpie</Text>
      {!minimal && (
        <Text font={11} foregroundStyle={online ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)'}>
          {online ? '● 在线' : '● 离线'}
        </Text>
      )}
      <Spacer />
      {!minimal && (
        <Text font={11} foregroundStyle="secondaryLabel">
          {periodLabel(data.period)}
        </Text>
      )}
    </HStack>
  )
}

function StatCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <VStack alignment="leading" spacing={1}>
      <Text font={11} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Text font={20} fontWeight="bold">{value}</Text>
      <Text font={11} foregroundStyle="secondaryLabel">
        {sub}
      </Text>
    </VStack>
  )
}

// 模型名只留最后一段，不带供应商前缀：
// nvidia/nemotron-3.5-super-vl:free -> nemotron-3.5-super-vl:free
function shortModelName(name: string): string {
  const i = name.lastIndexOf('/')
  return i >= 0 ? name.slice(i + 1) : name
}

// 网页 Usage 页排行行的配色（--c1..--c7，浅色主题）
const MODEL_COLORS = [
  'rgba(79,70,229,1)',
  'rgba(14,165,233,1)',
  'rgba(16,185,129,1)',
  'rgba(245,158,11,1)',
  'rgba(236,72,153,1)',
  'rgba(139,92,246,1)',
  'rgba(100,116,139,1)',
]

// 网页排行行的样式：色块 + 模型名（全名，带供应商前缀）+ 右边 token 数；
// 下面是按第一名算占比的同色条；再下面是灰色明细行（请求 · 费用 ·
// 速度 · 首字 · 命中率 · 占比 · 失败），没有的项不写。
// 注意：一段 Text 只能一种颜色，所以失败次数跟在明细里是灰色的，
// 做不到网页那样单独标红。
function ModelRowView({
  m,
  index,
  max,
  totalTokens,
  barW,
  nameFont = 12,
  nameScale = 0.85,
  showDetails = true,
  barH = 5,
  rowGap = 2,
  showBar = true,
}: {
  m: ModelRow
  index: number
  max: number
  totalTokens: number
  barW: number
  nameFont?: number
  nameScale?: number
  showDetails?: boolean
  barH?: number
  rowGap?: number
  showBar?: boolean
}) {
  const color = MODEL_COLORS[index % MODEL_COLORS.length]
  const frac = max > 0 ? Math.max(0.015, m.tokens / max) : 0
  return (
    <VStack alignment="leading" spacing={rowGap}>
      <HStack alignment="center" spacing={4}>
        <Text
          font={10}
          frame={{ width: 10, height: 10 }}
          background={{ shape: { type: 'rect', cornerRadius: 2 }, style: color }}
        >
          {' '}
        </Text>
        <Text font={nameFont} fontWeight="semibold" minScaleFactor={nameScale}>
          {shortModelName(m.name)}
        </Text>
        <Spacer />
        <Text font={nameFont} fontWeight="bold">{fmtTokens(m.tokens)}</Text>
      </HStack>
      {showBar && (
        <ZStack alignment="leading">
          <Capsule frame={{ width: barW, height: barH }} fill="rgba(0,0,0,0.08)" />
          <Capsule frame={{ width: Math.max(5, barW * frac), height: barH }} fill={color} />
        </ZStack>
      )}
      {showDetails && (
        <Text font={11} foregroundStyle="secondaryLabel">
          {modelDetails(m, totalTokens)}
        </Text>
      )}
    </VStack>
  )
}

function CompactView({ data }: { data: UsageData }) {
  const online = !data.error || data.fromCache
  const W = Widget.displaySize.width
  const isSmall = Widget.family === 'systemSmall' || (!Widget.family && W < 200)
  // 统计行：一行放下请求数 · Token · 费用（155 高度放不下大卡片
  // 那种三列大数字，失败次数单独标红）。
  const stats = isSmall
    ? `${fmtNum(data.calls)} 次 · ${fmtTokens(data.tokens)} · ${fmtCost(data.cost)}`
    : `${fmtNum(data.calls)} 次请求 · ${fmtTokens(data.tokens)} Token · ${fmtCost(data.cost)}`
  return (
    <VStack
      alignment="leading"
      spacing={isSmall ? 2 : 3}
      padding={{ horizontal: 12, vertical: isSmall ? 8 : 6 }}
    >
      <Header data={data} online={online} minimal={isSmall} />
      {isSmall ? (
        <VStack alignment="leading" spacing={2}>
          <HStack alignment="center" spacing={4}>
            <Text font={24} fontWeight="bold">{fmtNum(data.calls)}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">
              次请求
            </Text>
            {data.errors > 0 && (
              <Text font={12} foregroundStyle="rgba(239,68,68,1)">
                失败 {data.errors}
              </Text>
            )}
          </HStack>
          <HStack alignment="center" spacing={4}>
            <HStack alignment="center" spacing={2}>
              <Text font={9} foregroundStyle="secondaryLabel">
                Token
              </Text>
              <Text font={9} fontWeight="semibold">{fmtTokens(data.tokens)}</Text>
            </HStack>
            <HStack alignment="center" spacing={2}>
              <Text font={9} foregroundStyle="secondaryLabel">
                费用
              </Text>
              <Text font={9} fontWeight="semibold">{fmtCost(data.cost)}</Text>
            </HStack>
          </HStack>
        </VStack>
      ) : (
        <HStack alignment="center" spacing={4}>
          <Text font={12} fontWeight="semibold" minScaleFactor={0.85}>
            {stats}
          </Text>
          {data.errors > 0 && (
            <Text font={12} foregroundStyle="rgba(239,68,68,1)">
              失败 {data.errors}
            </Text>
          )}
        </HStack>
      )}
      {data.models.map((m, i) => (
        <ModelRowView
          key={i}
          m={m}
          index={i}
          max={data.models[0] ? data.models[0].tokens : 1}
          totalTokens={data.totalTokens}
          barW={W - 24}
          nameFont={isSmall ? 10 : 11}
          nameScale={isSmall ? 0.7 : 0.85}
          showDetails={false}
          barH={4}
          rowGap={1}
          showBar={!isSmall}
        />
      ))}
      <Spacer />
      <Text font={11} foregroundStyle="secondaryLabel">
        {data.updatedAt ? `${data.updatedAt} 更新` : '暂无数据'}
        {data.error ? ` · ${data.error}` : ''}
      </Text>
    </VStack>
  )
}

function LargeView({ data }: { data: UsageData }) {
  const online = !data.error || data.fromCache
  return (
    <VStack alignment="leading" spacing={8} padding={16}>
      <Header data={data} online={online} />
      <HStack alignment="top" spacing={16}>
        <StatCell label="请求" value={fmtNum(data.calls)} sub={data.errors > 0 ? `失败 ${data.errors}` : `${data.sessionCount} 个会话`} />
        <StatCell label="Token" value={fmtTokens(data.tokens)} sub={`输入 ${fmtTokens(data.input)} · 输出 ${fmtTokens(data.output)}`} />
        <StatCell label="费用" value={fmtCost(data.cost)} sub="美元" />
      </HStack>
      {data.models.map((m, i) => (
        <ModelRowView
          key={i}
          m={m}
          index={i}
          max={data.models[0] ? data.models[0].tokens : 1}
          totalTokens={data.totalTokens}
          barW={Widget.displaySize.width - 32}
        />
      ))}
      {data.topAgent && (
        <Text font={12} foregroundStyle="secondaryLabel">
          最活跃：{data.topAgent.name} · {fmtNum(data.topAgent.calls)} 次
        </Text>
      )}
      <Spacer />
      <Text font={11} foregroundStyle="secondaryLabel">
        {data.updatedAt ? `${data.updatedAt} 更新` : '暂无数据'}
        {data.error ? ` · ${data.error}` : ''}
      </Text>
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
      <Text font={13} fontWeight="bold">Magpie · {periodLabel(data.period)}</Text>
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
