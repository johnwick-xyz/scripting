import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Script,
  Section,
  Spacer,
  Text,
  TextField,
  VStack,
  Widget,
  fetch,
  useEffect,
  useState,
} from 'scripting'
import { fmtTime, fmtTimeShort, fmtTokens, fmtCost, fmtNum, fmtDate, fmtPct, unwrapCards } from './utils'

// Magpie 设置页（App 内打开）
// 填服务器地址和网关 Key，点“刷新用量”手动拉一次。
// 配置存在手机本地 preference.json + 共享 Storage 'magpie_config'，
// 小组件自己读；网关 Key 只存在手机本地，不会上传云端，
// 也不要提交到 GitHub。
//
// 新版（2026-11-26）和小组件一样拉四个接口，统计周期改成今日：
//   GET {base}/v1 -> 版本 + 模型数
//   GET {base}/v1/magpie/usage?period=today -> 今日用量、热门模型、账号用量
//   GET {base}/v1/magpie/usage?period=7d -> 只取 Totals.calls，当“近 7 日”
//   GET {base}/v1/magpie/quotas/cards -> 额度卡（Codex、CodeArts）
//   注意周期值是 today/7d/30d/all，不是 today/week/month/all——
//   传 period=month 会被当成未知值静默回落到 30d。
// App 和小组件共用同一份缓存（Storage 'magpie_usage' + cache.json），
// 两边的字段结构必须一模一样，不然 App 刷新一次就会把缓存里的
// 新字段冲掉（2026-11-24 就这么丢过一次模型数据）。
// 缓存带版本号 v=3，老缓存（v2、30 日口径）直接作废重拉。
//
// 服务器那边要先做两件事（不然手机连上也是 403）：
//   1) Web UI → Settings → Network and sharing → Share on local network
//      打开（局域网共享）；
//   2) 建一个只读网关 Key：Web UI → Gateway → Gateway keys 里建，
//      或在服务器上 docker exec magpie magpie gateway-key add widget --read-only。
//   注意：这个 Key 不是 MAGPIE_WEB_KEY（那是进网页用的），
//   是 sk-magpie-… 开头的网关 Key。
// 手机要和服务器在同一个局域网（同一 Wi-Fi），或服务器有公网地址。

const CACHE_KEY = 'magpie_usage'
const CONFIG_KEY = 'magpie_config'
const CACHE_FILE = 'cache.json'
const CONFIG_FILE = 'preference.json'
const CACHE_VERSION = 4
const FETCH_TIMEOUT = 8000
const PERIOD = 'today'
const WEEK_PERIOD = '7d'

// 自动更新：每天 9–22 点，每小时整点更新一次（和小组件一样的整点时段制）。
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
  rates: any
}

// 和 widget.tsx 里同一个函数。
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
  used: number
  resetsAt: number
  amount: number
  limit: number
  unit: string
  runsOut: number
  runsOutAt: number
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
  tokens: number
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
  totalTokens: number
  accounts: AccountRow[]
  weekCalls: number // 近 7 日请求数（period=7d 那次的 Totals.calls）
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

function fetchWithTimeout(url: string, init: any, ms: number): Promise<any> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
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
    throw new Error('请求失败：服务器连不上（检查地址和 Wi-Fi）')
  }
  if (res.status === 401) throw new Error('Key 不对（401）：网关 Key 填错了')
  if (res.status === 403)
    throw new Error('403：服务器没开局域网共享，或这个 Key 没权限读用量')
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

async function fetchAll(base: string, key: string): Promise<UsageData> {
  const b = normalizeBase(base)
  const usageP = fetchJson(b + `/v1/magpie/usage?period=${PERIOD}`, key)
  const infoP = fetchJson(b + '/v1', key).catch(() => null)
  const cardsP = fetchJson(b + '/v1/magpie/quotas/cards', key).catch(() => null)
  const weekP = fetchJson(b + `/v1/magpie/usage?period=${WEEK_PERIOD}`, key).catch(() => null)
  const usage = await usageP
  const [info, cards, week] = await Promise.all([infoP, cardsP, weekP])
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
  return {
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
    cards: unwrapCards(cards).map(normalizeCard).filter((c: QuotaCard) => c.name),
    updatedAt: fmtTimeShort(now),
    updatedTs: now.getTime(),
    fromCache: false,
    error: '',
    cardsError: cards ? '' : '额度卡没拉到',
  }
}

function saveConfig(base: string, key: string) {
  const cfg = { base, key }
  try {
    Storage.set(CONFIG_KEY, cfg, { shared: true })
  } catch (e) {}
  try {
    const dir = FileManager.appGroupDocumentsDirectory + '/' + Script.name
    FileManager.createDirectory(dir, true)
    FileManager.writeString(dir + '/' + CONFIG_FILE, JSON.stringify(cfg))
  } catch (e) {}
}

function saveCache(d: UsageData) {
  try {
    Storage.set(CACHE_KEY, d, { shared: true })
  } catch (e) {}
  try {
    const dir = FileManager.appGroupDocumentsDirectory + '/' + Script.name
    FileManager.createDirectory(dir, true)
    FileManager.writeString(dir + '/' + CACHE_FILE, JSON.stringify(d))
  } catch (e) {}
}

// 一张卡的主窗口：和 widget.tsx 里同一个规则。
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

function App() {
  const [base, setBase] = useState<string>('')
  const [key, setKey] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState<UsageData | null>(null)
  const [status, setStatus] = useState<string>('打开 App 后自动拉取…')

  useEffect(() => {
    let base0 = ''
    let key0 = ''
    try {
      const cfg: any = Storage.get(CONFIG_KEY, { shared: true })
      if (cfg) {
        base0 = cfg.base || ''
        key0 = cfg.key || ''
      }
    } catch (e) {}
    try {
      const p = FileManager.appGroupDocumentsDirectory + '/' + Script.name + '/' + CONFIG_FILE
      if (FileManager.fileExists(p)) {
        const pref = JSON.parse(FileManager.readString(p))
        if (pref) {
          base0 = pref.base || base0
          key0 = pref.key || key0
        }
      }
    } catch (e) {}
    setBase(base0)
    setKey(key0)
    setLoaded(true)
    // 注意：setBase/setKey 是异步的，这里直接把读到的值传给 refresh，
    // 不能等 state（否则打开 App 自动拉那次读到的 base 还是空的，
    // 会直接报“还没填服务器地址”）。
    refresh(true, base0, key0)
  }, [])

  useEffect(() => {
    if (!loaded) return
    saveConfig(base, key)
  }, [base, key, loaded])

  async function refresh(auto = false, b = base, k = key) {
    const base0 = b.replace(/\/$/, '')
    if (!base0) {
      setStatus('还没填服务器地址（下面“服务器地址”里填，如 http://192.168.1.20:3425）')
      return
    }
    if (!k) {
      setStatus('还没填网关 Key（只读 Key 就够，sk-magpie-… 开头）')
      return
    }
    if (auto) {
      try {
        const cached = normalizeCached(Storage.get(CACHE_KEY, { shared: true }))
        if (cached && cached.updatedTs && cached.updatedTs >= currentSlot(new Date()).getTime()) {
          setData({ ...cached, fromCache: true })
          setStatus(`已更新：${cached.updatedAt}（缓存），下次 ${fmtTime(nextSlot(new Date()))}`)
          return
        }
      } catch (e) {}
    }
    setStatus('正在拉取…')
    try {
      const fresh = await fetchAll(base0, k)
      setData(fresh)
      saveCache(fresh)
      Widget.reloadAll()
      setStatus(`已更新：${fresh.updatedAt}，下次 ${fmtTime(nextSlot(new Date()))}`)
    } catch (e: any) {
      setStatus(e && e.message ? e.message : '拉取失败')
    }
  }

  const success = data && data.calls > 0 ? (100 * (data.calls - data.errors)) / data.calls : 100

  return (
    <NavigationStack>
      <List navigationTitle="Magpie">
        <Section header={<Text>用量（今日）</Text>}>
          {data && (
            <HStack>
              <Text>请求</Text>
              <Spacer />
              <Text fontWeight="bold">{fmtNum(data.calls)} 次</Text>
            </HStack>
          )}
          {data && (
            <HStack>
              <Text>Token</Text>
              <Spacer />
              <Text fontWeight="bold">{fmtTokens(data.tokens)}</Text>
            </HStack>
          )}
          {data && (
            <HStack>
              <Text>费用</Text>
              <Spacer />
              <Text fontWeight="bold">{fmtCost(data.cost)}</Text>
            </HStack>
          )}
          {data && (
            <HStack>
              <Text>成功率</Text>
              <Spacer />
              <Text fontWeight="bold">{fmtPct(success)}</Text>
            </HStack>
          )}
          {data && data.models[0] && (
            <HStack>
              <Text>用的最多</Text>
              <Spacer />
              <Text>
                {data.models[0].name} · {fmtNum(data.models[0].calls)} 次
              </Text>
            </HStack>
          )}
          {data && data.errors > 0 && (
            <HStack>
              <Text>失败</Text>
              <Spacer />
              <Text foregroundStyle="red">{data.errors} 次</Text>
            </HStack>
          )}
          {data && data.weekCalls > 0 && (
            <HStack>
              <Text>近 7 日</Text>
              <Spacer />
              <Text>{fmtNum(data.weekCalls)} 次</Text>
            </HStack>
          )}
          {data && data.version ? (
            <HStack>
              <Text>版本</Text>
              <Spacer />
              <Text>
                {data.version} · {data.modelCount} 模型
              </Text>
            </HStack>
          ) : null}
          <Text foregroundStyle="secondaryLabel">{status}</Text>
          <Button title="刷新用量" action={() => refresh(false)} />
        </Section>
        {data && data.cards.length > 0 && (
          <Section header={<Text>账号额度</Text>}>
            {data.cards.map((c, i) => {
              const w = primaryWindow(c)
              const rem = w ? 100 - w.used * 100 : null
              const right =
                w && w.limit > 0
                  ? `${fmtNum(w.amount)} / ${fmtNum(w.limit)}`
                  : w && w.resetsAt > 0
                    ? `${fmtDate(new Date(w.resetsAt))} 重置`
                    : c.balance
              return (
                <VStack key={i} alignment="leading" spacing={2}>
                  <HStack>
                    <Text fontWeight="bold">{c.name}</Text>
                    {c.plan ? <Text foregroundStyle="secondaryLabel"> · {c.plan}</Text> : null}
                    <Spacer />
                    <Text>{rem !== null ? `${rem % 1 === 0 ? Math.round(rem) : rem.toFixed(1)}% 剩余` : ''}</Text>
                  </HStack>
                  <HStack>
                    <Text foregroundStyle="secondaryLabel">{right}</Text>
                    <Spacer />
                    {c.error ? <Text foregroundStyle="red">{c.error}</Text> : null}
                  </HStack>
                </VStack>
              )
            })}
          </Section>
        )}
        {data && data.cards.length === 0 && data.cardsError ? (
          <Section header={<Text>账号额度</Text>}>
            <Text foregroundStyle="secondaryLabel">{data.cardsError}</Text>
          </Section>
        ) : null}
        <Section header={<Text>设置</Text>}>
          <HStack>
            <Text>服务器地址</Text>
            <TextField title="如 http://192.168.1.20:3425" value={base} onChanged={setBase} />
          </HStack>
          <HStack>
            <Text>网关 Key</Text>
            <TextField title="只读 Key 就够" value={key} onChanged={setKey} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            填手机能直接访问的那个地址：在家同一 Wi-Fi 就填局域网 IP + 3425 端口；远程就填
            WorkBuddy 里用的那个地址 + 3430 端口。两个端口都能拉用量和额度。网关 Key
            只存在手机本地，不会上传云端，也不要提交到 GitHub。
          </Text>
        </Section>
        <Section header={<Text>怎么用</Text>}>
          <Text foregroundStyle="secondaryLabel">
            服务器那边要先做两件事，不然手机连上也是 403：1）Web UI → Settings → Network and
            sharing → Share on local network 打开；2）建一个只读网关 Key：Web UI → Gateway →
            Gateway keys 里建，或在服务器上 docker exec magpie magpie gateway-key add widget
            --read-only。这个 Key 不是 MAGPIE_WEB_KEY（那是进网页用的）。小组件每天 9–22
            点每小时自动更新一次，统计周期固定 30 日。
          </Text>
        </Section>
        <Section>
          <Button title="预览小组件" action={() => Widget.preview()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
