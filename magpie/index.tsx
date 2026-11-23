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
import { fmtTime, fmtTimeShort, fmtTokens, fmtCost, fmtNum } from './utils'

// Magpie 设置页（App 内打开）
// 填服务器地址和网关 Key，选周期，点“刷新用量”手动拉一次。
// 配置存在手机本地 preference.json + 共享 Storage 'magpie_config'，
// 小组件自己读；网关 Key 只存在手机本地，不会上传云端，
// 也不要提交到 GitHub。
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
const FETCH_TIMEOUT = 8000

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
  updatedAt: string
  updatedTs: number
  fromCache: boolean
  error: string
}

function fetchWithTimeout(url: string, init: any, ms: number): Promise<any> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
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
  const url = normalizeBase(base) + `/v1/magpie/usage?period=${period}`
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
    updatedAt: fmtTimeShort(now),
    updatedTs: now.getTime(),
    fromCache: false,
    error: '',
  }
}

function saveConfig(base: string, key: string, period: string) {
  const cfg = { base, key, period }
  try {
    Storage.set(CONFIG_KEY, cfg, { shared: true })
  } catch (e) {}
  try {
    const dir = FileManager.appGroupDocumentsDirectory + '/' + Script.name
    FileManager.createDirectory(dir, true)
    FileManager.writeString(dir + '/' + CONFIG_FILE, JSON.stringify(cfg))
  } catch (e) {}
}

function App() {
  const [base, setBase] = useState<string>('')
  const [key, setKey] = useState<string>('')
  const [period, setPeriod] = useState<string>('today')
  const [loaded, setLoaded] = useState(false)
  const [data, setData] = useState<UsageData | null>(null)
  const [status, setStatus] = useState<string>('打开 App 后自动拉取…')

  useEffect(() => {
    let base0 = ''
    let key0 = ''
    let period0 = 'today'
    try {
      const cfg: any = Storage.get(CONFIG_KEY, { shared: true })
      if (cfg) {
        base0 = cfg.base || ''
        key0 = cfg.key || ''
        period0 = cfg.period || 'today'
      }
    } catch (e) {}
    try {
      const p = FileManager.appGroupDocumentsDirectory + '/' + Script.name + '/' + CONFIG_FILE
      if (FileManager.fileExists(p)) {
        const pref = JSON.parse(FileManager.readString(p))
        if (pref) {
          base0 = pref.base || base0
          key0 = pref.key || key0
          period0 = pref.period || period0
        }
      }
    } catch (e) {}
    setBase(base0)
    setKey(key0)
    setPeriod(period0)
    setLoaded(true)
    // 注意：setBase/setKey 是异步的，这里直接把读到的值传给 refresh，
    // 不能等 state（否则打开 App 自动拉那次读到的 base 还是空的，
    // 会直接报“还没填服务器地址”）。
    refresh(true, base0, key0, period0)
  }, [])

  useEffect(() => {
    if (!loaded) return
    saveConfig(base, key, period)
  }, [base, key, period, loaded])

  async function refresh(auto = false, b = base, k = key, p = period) {
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
        const cached: any = Storage.get(CACHE_KEY, { shared: true })
        if (cached && cached.updatedTs && cached.updatedTs >= currentSlot(new Date()).getTime()) {
          setData({ ...cached, fromCache: true })
          setStatus(`已更新：${cached.updatedAt}（缓存），下次 ${fmtTime(nextSlot(new Date()))}`)
          return
        }
      } catch (e) {}
    }
    setStatus('正在拉取…')
    try {
      const fresh = await fetchUsage(base0, k, p)
      setData(fresh)
      try {
        Storage.set(CACHE_KEY, fresh, { shared: true })
      } catch (e) {}
      try {
        const dir = FileManager.appGroupDocumentsDirectory + '/' + Script.name
        FileManager.createDirectory(dir, true)
        FileManager.writeString(dir + '/' + CACHE_FILE, JSON.stringify(fresh))
      } catch (e) {}
      Widget.reloadAll()
      setStatus(`已更新：${fresh.updatedAt}，下次 ${fmtTime(nextSlot(new Date()))}`)
    } catch (e: any) {
      setStatus(e && e.message ? e.message : '拉取失败')
    }
  }

  function periodButton(p: string, label: string) {
    return (
      <Button
        title={label}
        action={() => {
          setPeriod(p)
          refresh(false, base, key, p)
        }}
      />
    )
  }

  return (
    <NavigationStack>
      <List navigationTitle="Magpie">
        <Section header={<Text>用量</Text>}>
          {data && (
            <HStack>
              <Text>{periodLabel(data.period)}请求</Text>
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
          {data && data.topModel && (
            <HStack>
              <Text>用的最多</Text>
              <Spacer />
              <Text>
                {data.topModel.name} · {fmtNum(data.topModel.calls)} 次
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
          <Text foregroundStyle="secondaryLabel">{status}</Text>
          <Button title="刷新用量" action={() => refresh(false)} />
        </Section>
        <Section header={<Text>设置</Text>}>
          <HStack>
            <Text>服务器地址</Text>
            <TextField title="如 http://192.168.1.20:3425" value={base} onChanged={setBase} />
          </HStack>
          <HStack>
            <Text>网关 Key</Text>
            <TextField title="只读 Key 就够" value={key} onChanged={setKey} />
          </HStack>
          <HStack>
            <Text>统计周期</Text>
            <Spacer />
            {periodButton('today', '今日')}
            {periodButton('week', '本周')}
            {periodButton('month', '本月')}
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            填手机能直接访问的那个地址：在家同一 Wi-Fi 就填局域网 IP + 3425 端口；远程就填
            WorkBuddy 里用的那个地址 + 3430 端口。两个端口都能拉用量。网关 Key
            只存在手机本地，不会上传云端，也不要提交到 GitHub。
          </Text>
        </Section>
        <Section header={<Text>怎么用</Text>}>
          <Text foregroundStyle="secondaryLabel">
            服务器那边要先做两件事，不然手机连上也是 403：1）Web UI → Settings → Network and
            sharing → Share on local network 打开；2）建一个只读网关 Key：Web UI → Gateway →
            Gateway keys 里建，或在服务器上 docker exec magpie magpie gateway-key add widget
            --read-only。这个 Key 不是 MAGPIE_WEB_KEY（那是进网页用的）。在家同一 Wi-Fi
            就填局域网 IP + 3425，远程就填 WorkBuddy 那个地址 + 3430，两个端口都能拉用量。小组件每天 9–22
            点每小时自动更新一次。
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
