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
import { rpt, fmtTimeShort, fmtTokens, fmtCost, fmtNum } from './utils'

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
//   供应商名、calls、input、output、cost）、agents[]、sessions[]、
//   sessionCount、series[]（时间轴，每点有 calls）。
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
const STALE_MS = 10 * 60 * 1000 // 缓存超过 10 分钟才重新拉

interface ModelRow {
  name: string
  sub: string
  calls: number
  tokens: number
  cost: number
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

async function fetchUsage(base: string, key: string, period: string): Promise<UsageData> {
  const url = `${base.trim().replace(/\/$/, '')}/v1/magpie/usage?period=${period}`
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
        .map((m: any) => ({
          name: String(m.name || m.id || ''),
          sub: String(m.sub || m.provider || ''),
          calls: Number(m.calls) || 0,
          tokens: (Number(m.input) || 0) + (Number(m.output) || 0),
          cost: Number(m.cost) || 0,
        }))
        .filter((m: ModelRow) => m.name)
        .sort((a: ModelRow, b: ModelRow) => b.calls - a.calls)
    : []
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
    models: models.slice(0, 4),
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
  if (!cfg.base) {
    const d = cached || emptyData(cfg.period)
    return { data: { ...d, error: '还没填服务器地址' }, cfg }
  }
  if (!cfg.key) {
    const d = cached || emptyData(cfg.period)
    return { data: { ...d, error: '还没填网关 Key' }, cfg }
  }
  const stale = !cached || !cached.updatedTs || Date.now() - cached.updatedTs > STALE_MS
  if (!stale && cached) return { data: cached, cfg }
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

function Header({ data, online }: { data: UsageData; online: boolean }) {
  return (
    <HStack alignment="center" spacing={6}>
      <Text
        font={{ size: 13, weight: 'bold' }}
        foregroundStyle="white"
        padding={5}
        background={{ shape: 'circle', style: 'rgba(17,17,17,1)' }}
      >
        M
      </Text>
      <Text font={{ size: 14, weight: 'bold' }}>Magpie</Text>
      <Text font={{ size: 11 }} foregroundStyle={online ? 'rgba(34,197,94,1)' : 'rgba(239,68,68,1)'}>
        {online ? '● 在线' : '● 离线'}
      </Text>
      <Spacer />
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        {periodLabel(data.period)}
      </Text>
    </HStack>
  )
}

function StatCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <VStack alignment="leading" spacing={1}>
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Text font={{ size: 20, weight: 'bold' }}>{value}</Text>
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        {sub}
      </Text>
    </VStack>
  )
}

function ModelRowView({ m, max, barW }: { m: ModelRow; max: number; barW: number }) {
  const frac = max > 0 ? Math.max(0.04, m.calls / max) : 0
  return (
    <VStack alignment="leading" spacing={2}>
      <HStack alignment="center" spacing={4}>
        <Text font={{ size: 12, weight: 'semibold' }}>{m.name}</Text>
        <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
          {m.sub}
        </Text>
        <Spacer />
        <Text font={{ size: 12 }}>{fmtNum(m.calls)} 次</Text>
      </HStack>
      <ZStack alignment="leading">
        <Capsule frame={{ width: barW, height: 5 }} fill="rgba(0,0,0,0.08)" />
        <Capsule frame={{ width: Math.max(5, barW * frac), height: 5 }} fill="rgba(17,17,17,0.85)" />
      </ZStack>
    </VStack>
  )
}

function CompactView({ data }: { data: UsageData }) {
  const online = !data.error || data.fromCache
  const W = Widget.displaySize.width
  const isSmall = Widget.family === 'systemSmall' || (!Widget.family && W < 200)
  return (
    <VStack alignment="leading" spacing={isSmall ? 4 : 6} padding={{ horizontal: 12, vertical: 8 }}>
      <Header data={data} online={online} />
      <HStack alignment="center" spacing={4}>
        <Text font={{ size: isSmall ? 26 : 30, weight: 'bold' }}>{fmtNum(data.calls)}</Text>
        <Text font={{ size: 12 }} foregroundStyle="secondaryLabel">
          次请求
        </Text>
        {data.errors > 0 && (
          <Text font={{ size: 12 }} foregroundStyle="rgba(239,68,68,1)">
            失败 {data.errors}
          </Text>
        )}
      </HStack>
      <HStack alignment="center" spacing={12}>
        <Text font={{ size: 12 }}>
          Token <Text font={{ size: 12, weight: 'semibold' }}>{fmtTokens(data.tokens)}</Text>
        </Text>
        <Text font={{ size: 12 }}>
          费用 <Text font={{ size: 12, weight: 'semibold' }}>{fmtCost(data.cost)}</Text>
        </Text>
      </HStack>
      {data.topModel && (
        <Text font={{ size: 12 }} foregroundStyle="secondaryLabel">
          最多：{data.topModel.name} · {fmtNum(data.topModel.calls)} 次
        </Text>
      )}
      <Spacer />
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        {data.updatedAt ? `${data.updatedAt} 更新` : '暂无数据'}
        {data.error ? ` · ${data.error}` : ''}
      </Text>
    </VStack>
  )
}

function LargeView({ data }: { data: UsageData }) {
  const online = !data.error || data.fromCache
  const max = data.series.length ? Math.max(...data.series, 1) : 1
  return (
    <VStack alignment="leading" spacing={10} padding={20}>
      <Header data={data} online={online} />
      <HStack alignment="top" spacing={16}>
        <StatCell label="请求" value={fmtNum(data.calls)} sub={data.errors > 0 ? `失败 ${data.errors}` : `${data.sessionCount} 个会话`} />
        <StatCell label="Token" value={fmtTokens(data.tokens)} sub={`输入 ${fmtTokens(data.input)} · 输出 ${fmtTokens(data.output)}`} />
        <StatCell label="费用" value={fmtCost(data.cost)} sub="美元" />
      </HStack>
      {data.series.length > 1 && (
        <HStack alignment="bottom" spacing={3}>
          {data.series.map((v, i) => (
            <Capsule
              key={i}
              fill="rgba(17,17,17,0.75)"
              frame={{ width: 12, height: Math.max(4, Math.round((v / max) * 36)) }}
            />
          ))}
        </HStack>
      )}
      {data.models.map((m, i) => (
        <ModelRowView key={i} m={m} max={data.models[0] ? data.models[0].calls : 1} barW={Widget.displaySize.width - 40} />
      ))}
      {data.topAgent && (
        <Text font={{ size: 12 }} foregroundStyle="secondaryLabel">
          最活跃：{data.topAgent.name} · {fmtNum(data.topAgent.calls)} 次
        </Text>
      )}
      <Spacer />
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        {data.updatedAt ? `${data.updatedAt} 更新` : '暂无数据'}
        {data.error ? ` · ${data.error}` : ''}
      </Text>
    </VStack>
  )
}

function LockCircularView({ data }: { data: UsageData }) {
  return (
    <VStack alignment="center" spacing={1} padding={8}>
      <Text font={{ size: 26, weight: 'bold' }}>{fmtTokens(data.tokens)}</Text>
      <Text font={{ size: 11 }} foregroundStyle="secondaryLabel">
        Token
      </Text>
    </VStack>
  )
}

function LockRectangularView({ data }: { data: UsageData }) {
  return (
    <VStack alignment="leading" spacing={2} padding={{ horizontal: 12, vertical: 8 }}>
      <Text font={{ size: 13, weight: 'bold' }}>Magpie · {periodLabel(data.period)}</Text>
      <Text font={{ size: 12 }}>
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
      date: new Date(Date.now() + 15 * 60 * 1000),
    },
  })
})()
