import {
  Capsule,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  fetch,
  modifiers,
} from 'scripting'
import { rpt, parseSlots, DEFAULT_SLOTS } from './utils'

// 京东价格监控 Scripting 小组件
//
// 取价分两路：
// 1) 小组件自己拉价——每个源都用 Promise.race + setTimeout 超时
//    （AbortSignal.timeout 在 Scripting 里断不开 fetch），
//    先走轻量的 p.3.cn（带 Cookie，5 秒），再走 wareBusiness
//    （api.m.jd.com，8 秒）。之前只走 wareBusiness 一个源，
//    它带 Cookie 时回得慢，后台里 setTimeout 又不准，
//    超时没触发就被系统掐掉，连报错都留不下。
//    失败了就直接显示缓存价，绝不转圈。
// 2) App 里拉价（打开 App 时，到更新点就拉一次），
//    拉到就写进 Storage 共享域 + 本地文件，小组件读缓存。
// 两边共用同一份缓存（Storage 'jd_price_cache'，shared: true）。
// App 和小组件是两次分开的执行，文件传不过去，
// 必须走 Storage shared 域，文件只当备用。

interface PriceEntry {
  t: number
  p: number
}

interface WidgetData {
  name: string
  sku: string
  price: number | null
  prevPrice: number | null
  low: number | null
  high: number | null
  history: PriceEntry[]
  updatedAt: string
  updatedTs?: number
  lastTryTs?: number
  lastTryAt?: string
  imageUrl?: string
  imagePath?: string
  fromCache: boolean
  error: string
}

// 西昊豆包椅L1 的主图（从京东商品页取到的第一张图，已验证能打开）。
// 换商品时 App 会自动去拉新图并下载到本地；
// 这里只是兜底，让旧缓存里没存图的时候也能先显示出来。
const DEFAULT_IMAGE_URL =
  'https://img10.360buyimg.com/img/jfs/t1/572241/19/12897/149428/6afed993F3dda89e5/008332032016639f.jpg'

// 更新时间点是用户在 App 里填的（默认 9:00、15:00、21:00），
// 存在共享域 'jd_refresh_slots'，两个京东小组件共用。
// 更新窗口 = 第一个点到最后一个点之后 1 小时（默认 9-22 点）。
// 两步分开：
//   整点（9:00、15:00…）拉价——小组件在整点跑一次，
//   去京东拉新价存进共享缓存；
//   整点 + 5 分钟（9:05、15:05…）取数——小组件再跑一次，
//   只读共享缓存显示，不再拉价。
// 拉价那一下慢（手动刷也要等很久），分开后 5 分钟那次
// 读缓存一定快，不会被后台掐掉。
// currentSlot（判断该不该取）按整点算，不动。
const DISPLAY_DELAY_MINUTES = 5
function nextSlot(now: Date, slots: number[]): Date {
  for (const h of slots) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d.getTime() > now.getTime()) {
      return d
    }
  }
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(slots[0], 0, 0, 0)
  return d
}

// 这个整点对应的取数时间（整点 + 5 分钟）。
function displayTime(slot: Date): Date {
  const d = new Date(slot)
  d.setMinutes(d.getMinutes() + DISPLAY_DELAY_MINUTES)
  return d
}

function isUpdateWindow(now: Date, slots: number[]): boolean {
  const h = now.getHours()
  return h >= slots[0] && h < slots[slots.length - 1] + 1
}

// 当前这个更新点：最近过去的那个。
// 比如现在 15:30，当前点就是今天 15:00；
// 现在 10:00，当前点就是今天 9:00；
// 现在 8:30，还没到今天 9:00，当前点就是昨天 21:00。
function currentSlot(now: Date, slots: number[]): Date {
  let slot = -1
  for (const h of slots) {
    if (now.getHours() >= h) slot = h
  }
  const d = new Date(now)
  if (slot === -1) d.setDate(d.getDate() - 1)
  d.setHours(slot === -1 ? slots[slots.length - 1] : slot, 0, 0, 0)
  return d
}

// 读用户设的更新时间点：1) 共享域（两个 App 都往这里写），
// 2) 本脚本的 preference.json，3) 默认 9,15,21。
function getSlots(): number[] {
  try {
    const v: any = Storage.get('jd_refresh_slots', { shared: true })
    if (v != null && String(v).trim()) return parseSlots(v)
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.slots != null && String(pref.slots).trim()) return parseSlots(pref.slots)
    }
  } catch (e) {}
  return DEFAULT_SLOTS.slice()
}

function fmt(n: number): string {
  return n.toFixed(2)
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function changeInfo(data: WidgetData): { text: string; short: string; up: boolean; down: boolean } {
  if (data.price == null || data.prevPrice == null) {
    return { text: '首次记录', short: '首次记录', up: false, down: false }
  }
  const diff = data.price - data.prevPrice
  if (Math.abs(diff) < 0.005) return { text: '没变', short: '没变', up: false, down: false }
  const pct = (diff / data.prevPrice) * 100
  const sign = diff > 0 ? '+' : ''
  const delta = `${diff > 0 ? '▲' : '▼'} ${sign}${fmt(diff)}`
  return {
    text: `${delta} (${sign}${pct.toFixed(1)}%)`,
    // 小图那格只有 73pt 宽（155-24留白-50图-8间距），
    // 全文 "▲ +20.00 (+4.2%)" 94pt 放不下会被截成 "▲ +20.00…"，
    // 小图只显示涨跌额，不带百分比（49.5pt，放得下）。
    short: delta,
    up: diff > 0,
    down: diff < 0,
  }
}

// ---- 取价（小组件里，每个请求都用 Promise.race 超时） ----

// AbortSignal.timeout 在 Scripting 里断不开 fetch（只靠它，
// 一个源 hang 住就卡死在那，永远到不了下一个源）。
// 这里改成 Promise.race + setTimeout，每个源最多等 ms 毫秒，
// 超时就 reject、立刻试下一个源；外面还有 withTimeout 兜底。
async function fetchWithTimeout(url: string, options: any, ms: number): Promise<any> {
  return Promise.race([
    fetch(url, options),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('请求超时')), ms),
    ),
  ])
}

// 超时兜底：AbortSignal.timeout 未必能断开 Scripting 的 fetch，
// 光靠它，取价一 hang 预览就一直转圈。
// 再加一层 Promise.race，超时就直接 reject，
// 外面 catch 住就显示缓存价，绝不转圈。
// setTimeout 在小组件里不一定准，但有它比没有强；
// 它不存在就退回原 promise（只靠 AbortSignal）。
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (typeof setTimeout !== 'function') return p
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('超时')), ms)
    }),
  ])
}

async function getCookie(): Promise<string> {
  // 1) App 存进 Storage 共享域的 Cookie
  try {
    const v: any = Storage.get('jd_cookie', { shared: true })
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (e) {}
  // 2) App 设置页保存的 preference.json
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.cookie) return String(pref.cookie)
    }
  } catch (e) {}
  // 3) BoxJs（Loon 抓的），每条 3 秒原生超时
  for (const url of [
    'http://boxjs.com/query/data/jd_cookie',
    'http://boxjs.com/query/data/@JD.cookie',
  ]) {
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, 3000)
      const j: any = await res.json()
      const v = j && (j.val || j.data || j.value)
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (typeof j === 'string' && j.trim()) return j.trim()
    } catch (e) {}
  }
  return ''
}

async function getSku(): Promise<string> {
  try {
    const v: any = Storage.get('jd_sku', { shared: true })
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.sku) return String(pref.sku)
    }
  } catch (e) {}
  return '100244780555'
}

// 严格取数：只认纯数字（"479"、"479.00"），
// "4??" 这种被遮住的价格必须拒掉——parseFloat("4??") 会返回 4，
// 小组件就显示 ¥4.00。Number("4??") 是 NaN，但这里用正则更稳。
function strictNum(v: any): number | null {
  if (typeof v === 'number') return v > 0 ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    const p = parseFloat(s)
    return !isNaN(p) && p > 0 ? p : null
  }
  return null
}

// App 接口返回里价格位置不固定（data.price.p / price.p / jdPrice 等），
// 挨个试，拿到大于 0 的数就返回；再扫一遍全文找 "jdPrice" 或 "price":{"p":…}。
function extractWarePrice(j: any): number | null {
  const candidates: any[] = [
    j?.data?.price?.p,
    j?.wareBusiness?.price?.p,
    j?.price?.p,
    j?.data?.price,
    j?.wareBusiness?.price,
    j?.price,
    j?.data?.jdPrice,
    j?.wareBusiness?.jdPrice,
    j?.jdPrice,
    j?.data?.warePrice,
    j?.warePrice,
  ]
  for (const v of candidates) {
    const p = strictNum(v)
    if (p != null) return p
  }
  try {
    const s = JSON.stringify(j)
    let m = s.match(/"jdPrice"\s*:\s*"([0-9]+(?:\.[0-9]+)?)"/)
    if (m) {
      const p = strictNum(m[1])
      if (p != null) return p
    }
    m = s.match(/"price"\s*:\s*\{\s*"p"\s*:\s*"([0-9]+(?:\.[0-9]+)?)"/)
    if (m) {
      const p = strictNum(m[1])
      if (p != null) return p
    }
  } catch (e) {}
  return null
}

async function fetchWareBusinessPrice(sku: string, cookie: string): Promise<number | null> {
  const apiHeaders: any = {
    Host: 'api.m.jd.com',
    'User-Agent':
      'jdapp;iPhone;9.4.4;14.3;network/4g;Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1',
  }
  if (cookie) apiHeaders.Cookie = cookie
  // 按文档用 GET，body 放查询串（之前 POST 放 body 里可能不认）：
  //   GET https://api.m.jd.com/client.action?functionId=wareBusiness&appid=productDetail&body={"skuId":"..."}
  const url =
    'https://api.m.jd.com/client.action?functionId=wareBusiness&appid=productDetail&body=' +
    encodeURIComponent(JSON.stringify({ skuId: sku }))
  const res: any = await fetchWithTimeout(url, { method: 'GET', headers: apiHeaders }, 8000)
  const j: any = await res.json()
  return extractWarePrice(j)
}

// p.3.cn / pm.3.cn 轻量价接口：返回 [{"id":"J_xxx","p":"479.00",...}]，
// 比 wareBusiness 轻得多。之前小组件里拉不到价，是因为没带 Cookie
// （这商品不登录就遮价，p.3.cn 直接回空）；App 里带 Cookie 拉是通的。
// 带上 Cookie 再试，5 秒超时，拿到了就直接用，不用等 wareBusiness。
async function fetchP3Price(sku: string, cookie: string): Promise<number | null> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: `https://item.jd.com/${sku}.html`,
  }
  if (cookie) headers.Cookie = cookie
  for (const url of [
    `https://p.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
    `https://pm.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
  ]) {
    try {
      const res: any = await fetchWithTimeout(url, { method: 'GET', headers }, 5000)
      const list = await res.json()
      if (Array.isArray(list)) {
        for (const item of list) {
          if (String(item.id || '').replace(/^J_/, '') === String(sku)) {
            const p = strictNum(item.p)
            if (p != null) return p
          }
        }
      }
    } catch (e) {}
  }
  return null
}

// 小组件取价：先走轻量的 p.3.cn（带 Cookie，5 秒），
// 再走 wareBusiness（api.m.jd.com，8 秒）。
// 之前只走 wareBusiness 一个源：它带 Cookie 时回得慢，
// 手动刷都要等很久，后台里 setTimeout 又不准，
// 超时没触发就被系统掐掉，连报错都留不下，底行一直停在旧时间。
// p.3.cn 轻、回得快，先试它；拿不到再走 wareBusiness。
// dbg 记下结果，万一都没价，报错里能看到。
async function fetchPrice(sku: string, cookie: string): Promise<number> {
  const dbg: string[] = []
  try {
    const p = await fetchP3Price(sku, cookie)
    if (p != null) return p
    dbg.push('p3 无价')
  } catch (e) {
    dbg.push('p3 ' + String((e as any)?.message || e).slice(0, 20))
  }
  try {
    const p = await fetchWareBusinessPrice(sku, cookie)
    if (p != null) return p
    dbg.push('wareBusiness 无价')
  } catch (e) {
    dbg.push('wareBusiness ' + String((e as any)?.message || e).slice(0, 20))
  }
  throw new Error('取价接口没返回价格（' + dbg.join('；') + '）')
}

// ---- 读 / 写缓存 ----

function readCached(): WidgetData | null {
  try {
    const v: any = Storage.get('jd_price_cache', { shared: true })
    if (v) return typeof v === 'string' ? JSON.parse(v) : v
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const cachePath = Path.join(root, 'cache.json')
    if (FileManager.existsSync(cachePath)) {
      return JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
    }
  } catch (e) {}
  return null
}

function saveCache(data: WidgetData) {
  try {
    Storage.set('jd_price_cache', data, { shared: true })
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
    FileManager.writeAsStringSync(Path.join(root, 'cache.json'), JSON.stringify(data))
    FileManager.writeAsStringSync(
      Path.join(root, 'price_history.json'),
      JSON.stringify(data.history || []),
    )
  } catch (e) {}
}

// ---- 视图 ----

function Header({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <HStack spacing={compact ? 6 : 8}>
      <Text
        font={compact ? 11 : 14}
        fontWeight="bold"
        foregroundStyle="white"
        padding={compact ? 3 : 6}
        background={{ shape: 'circle', style: 'rgba(225,37,27,1)' }}
      >
        京
      </Text>
      <Text
        font={compact ? 12 : 16}
        fontWeight="bold"
        foregroundStyle="label"
        lineLimit={compact ? 1 : 2}
      >
        {name}
      </Text>
      <Spacer />
      <Image
        systemName="arrow.clockwise"
        font={compact ? 10 : 12}
        foregroundStyle="secondaryLabel"
        padding={compact ? 4 : 6}
        background={{ shape: 'circle', style: 'rgba(0,0,0,0.06)' }}
      />
    </HStack>
  )
}

function PriceBlock({
  data,
  big,
  compact,
  tiny,
}: {
  data: WidgetData
  big: number
  compact?: boolean
  tiny?: boolean
}) {
  const ch = changeInfo(data)
  const chColor = ch.up
    ? 'rgba(225,37,27,1)'
    : ch.down
      ? 'rgba(34,197,94,1)'
      : 'secondaryLabel'
  return (
    <VStack spacing={2} alignment="leading">
      <Text font={compact ? 11 : 13} foregroundStyle="secondaryLabel">
        实时价
      </Text>
      <HStack spacing={4}>
        <Text font={compact ? 14 : 18} fontWeight="bold" foregroundStyle="rgba(225,37,27,1)">
          ¥
        </Text>
        <Text
          font={big}
          fontWeight="bold"
          foregroundStyle="rgba(225,37,27,1)"
          lineLimit={1}
          minScaleFactor={0.5}
        >
          {data.price != null ? fmt(data.price) : '—'}
        </Text>
      </HStack>
      <Text
        font={compact ? 11 : 13}
        fontWeight="semibold"
        foregroundStyle={chColor as any}
        lineLimit={1}
        minScaleFactor={0.7}
      >
        {tiny ? ch.short : ch.text}
      </Text>
    </VStack>
  )
}

// 商品图：优先用 App 下载到本地的图片文件（小组件里远程图经常加载失败，
// 上一版就是右上角一个破图图标），没有本地文件才用远程链接。
function PriceRow({
  data,
  big,
  imgSize,
  compact,
  tiny,
}: {
  data: WidgetData
  big: number
  imgSize: number
  compact?: boolean
  tiny?: boolean
}) {
  const img = data.imagePath ? (
    <Image filePath={data.imagePath} resizable frame={{ width: imgSize, height: imgSize }} />
  ) : (
    <Image
      imageUrl={data.imageUrl || DEFAULT_IMAGE_URL}
      resizable
      frame={{ width: imgSize, height: imgSize }}
    />
  )
  return (
    <HStack spacing={8}>
      <PriceBlock data={data} big={big} compact={compact} tiny={tiny} />
      <Spacer />
      {img}
    </HStack>
  )
}

function Footer({
  data,
  compact,
  tiny,
}: {
  data: WidgetData
  compact?: boolean
  // 小号只有 155pt 宽，底行 "最低 479.00 · 最高 479.00 · 11/22 21:13"
  // 放不下，时间会被截成 "11/22…"（2026-11-22 截图就是这样）。
  // 小号上今天更新的只显示 "21:13"，不是今天的才显示 "11/22 21:13"，
  // 字允许缩到 0.55；中号 329pt 宽放得下，不动。
  tiny?: boolean
}) {
  const f = compact ? 11 : 13
  let time = data.updatedAt
  let tryAt = data.lastTryAt || ''
  if (tiny && data.updatedTs) {
    const u = new Date(data.updatedTs)
    const n = new Date()
    const pad = (x: number) => (x < 10 ? '0' + x : '' + x)
    if (
      u.getFullYear() === n.getFullYear() &&
      u.getMonth() === n.getMonth() &&
      u.getDate() === n.getDate()
    ) {
      time = `${pad(u.getHours())}:${pad(u.getMinutes())}`
    }
    if (tryAt) tryAt = tryAt.split(' ')[1] || tryAt
  }
  return (
    <Text
      font={f}
      foregroundStyle="secondaryLabel"
      lineLimit={1}
      minScaleFactor={tiny ? 0.55 : 0.7}
    >
      最低 {data.low != null ? fmt(data.low) : '—'} · 最高{' '}
      {data.high != null ? fmt(data.high) : '—'} · {time}
      {data.lastTryTs != null &&
      data.updatedTs != null &&
      data.lastTryTs > data.updatedTs &&
      tryAt
        ? ` · ${tryAt} 更新失败`
        : ''}
    </Text>
  )
}

// 最新更新之前的三次价格及更新时间。
// history 最后一条就是最新那次，所以取倒数第 2、3、4 条，
// 最近的在上面。不用 map，用显式三行，避免小组件里
// JSX 数组渲染出问题。
function PrevPrices({ history }: { history: PriceEntry[] }) {
  const prev = (history || []).slice(0, -1).slice(-3).reverse()
  if (prev.length === 0) {
    return (
      <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
        暂无更早记录，刷新几次后显示前三次价格
      </Text>
    )
  }
  // 排版跟原来一样：价格贴左、时间贴右，中间一个 Spacer；
  // 只是外层留白加大了，文字不再贴边。
  // 上一版改成居中是不对的，已经改回来。
  const row = (x: PriceEntry | undefined) => {
    if (!x) return null
    return (
      <HStack spacing={4}>
        <Text font={10} fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          ¥{fmt(x.p)}
        </Text>
        <Spacer />
        <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
          {fmtTime(x.t)}
        </Text>
      </HStack>
    )
  }
  return (
    <VStack spacing={1} alignment="leading">
      {row(prev[0])}
      {row(prev[1])}
      {row(prev[2])}
    </VStack>
  )
}

function HistoryBars({ history }: { history: PriceEntry[] }) {
  const items = history.slice(-10)
  if (items.length < 2) return <Text font={12} foregroundStyle="secondaryLabel">历史还不够，打开 App 刷新几次就有走势图了</Text>
  const prices = items.map((x) => x.p)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min > 0 ? max - min : 1
  return (
    <VStack spacing={6} alignment="leading">
      <Text font={13} foregroundStyle="secondaryLabel">
        最近走势（共 {history.length} 条记录）
      </Text>
      <HStack spacing={6}>
        {items.map((x, i) => {
          const h = 8 + ((x.p - min) / span) * 72
          const isLast = i === items.length - 1
          return (
            <VStack spacing={0}>
              <Spacer />
              <Capsule
                frame={{ width: 12, height: h }}
                fill={isLast ? 'rgba(225,37,27,1)' : 'rgba(225,37,27,0.35)'}
              />
            </VStack>
          )
        })}
      </HStack>
      <HStack>
        <Text font={11} foregroundStyle="secondaryLabel">
          {fmt(min)}
        </Text>
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {fmt(max)}
        </Text>
      </HStack>
    </VStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isMedium = family.includes('Medium') || family === 'medium'
  const isSmall = family.includes('Small') || family === 'small'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')
  // 锁屏圆形（72x72）：只显示当前价，固定字号，不用 rpt
  if (isCircular) {
    return (
      <VStack
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={0}
      >
        <Text font={10} foregroundStyle="secondaryLabel">
          ¥
        </Text>
        <Text font={20} fontWeight="bold" foregroundStyle="rgba(225,37,27,1)" lineLimit={1} minScaleFactor={0.6}>
          {data.price != null ? fmt(data.price) : '—'}
        </Text>
      </VStack>
    )
  }
  // 锁屏矩形（157x72）：商品简称 + 价格 + 涨跌，固定字号 13/12
  if (isRectangular) {
    const ch = changeInfo(data)
    return (
      <VStack
        padding={8}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={4}
      >
        <Text font={13} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
          {data.name} ¥{data.price != null ? fmt(data.price) : '—'}
        </Text>
        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>
          {ch.text}
        </Text>
      </VStack>
    )
  }
  // 大号：每段之间各一个 Spacer，空余平均分开
  const body = (
    <VStack
      padding={20}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
      spacing={8}
      alignment="leading"
    >
      <Header name={data.name} />
      <Spacer />
      <PriceRow data={data} big={44} imgSize={88} />
      <PrevPrices history={data.history} />
      <Spacer />
      <HistoryBars history={data.history} />
      <Spacer />
      <Footer data={data} />
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：竖排列表。
  // 外层留白左右 12、上下 8，文字不再贴着卡片边；
  // 之前只有 6，价格和时间看着都贴边了。
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    const tiny = isSmall || (!family && W < 200)
    return (
      <VStack
        padding={{ horizontal: 12, vertical: 8 }}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={1}
        alignment="leading"
      >
        <Header name={data.name} compact />
        <PriceRow data={data} big={24} imgSize={50} compact tiny={tiny} />
        <PrevPrices history={data.history} />
        <Spacer />
        <Footer data={data} compact tiny={tiny} />
      </VStack>
    )
  }
  return body
}

function ErrorView({ message }: { message: string }) {
  return (
    <VStack
      padding={rpt(14)}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
    >
      <Text font={rpt(14)} fontWeight="bold" foregroundStyle="label">
        京东价格监控
      </Text>
      <Text font={rpt(12)} foregroundStyle="secondaryLabel">
        {message}
      </Text>
    </VStack>
  )
}

// 主流程分两步：
//   整点（9:00、15:00…）拉价：到更新点、缓存还是旧的，
//   就去京东拉一次新价存进共享缓存，下次跑在整点 + 5 分钟；
//   整点 + 5 分钟取数：只读共享缓存显示，不再拉价，
//   下次跑在下一个整点。
// 拉价那一下慢，分开后取数那次读缓存一定快，
// 不会被后台掐掉。注意：这里不能用“距上次超过 6 小时”来判断——
// 手动在 App 里点一次刷新，就会把 updatedTs 刷成现在，
// 那 15:00 那个点一看“才过了 4 小时”就直接跳过，
// 于是自动更新永远不跑（2026-11-22 15:00 就是这么错过的）。
// 改成按更新点判断：只要上次更新在当前这个更新点之前，就拉。
;(async () => {
  const now = new Date()
  const slots = getSlots()
  const cached = readCached()
  const slot = currentSlot(now, slots)
  const slotMs = slot.getTime()
  const dispMs = slotMs + DISPLAY_DELAY_MINUTES * 60 * 1000
  const cacheFresh =
    cached &&
    cached.price != null &&
    cached.updatedTs != null &&
    cached.updatedTs >= slotMs
  const needFetch =
    !cached ||
    cached.price == null ||
    (isUpdateWindow(now, slots) && !cacheFresh)
  // 拉价阶段：还在整点 + 5 分钟之前、且缓存是旧的——去拉价，
  // 拉完下次跑在整点 + 5 分钟（取数）。
  // 取数阶段：已过整点 + 5 分钟，或缓存已是这个点的——
  // 只读缓存显示，下次跑在下一个整点。
  const isFetchPhase = needFetch && now.getTime() < dispMs
  const nextReload = isFetchPhase ? new Date(dispMs) : nextSlot(now, slots)
  // 先立刻显示缓存，保证小组件绝不空白。
  // 到点自动跑时如果拉价 hang 住（后台 setTimeout 不准、
  // AbortSignal 断不开 fetch），后面的 present 跑不到，
  // 小组件就直接不显示。先 present 一次缓存顶上，
  // 拉到了再 present 一次新价，拉不到也已经有内容了。
  if (cached && cached.price != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    // 缓存还新鲜就不用再拉了，直接返回
    if (!isFetchPhase) return
  }
  if (isFetchPhase && cached) {
    // 有缓存时先拉，拉不到就用缓存顶上
    try {
      const p = await withTimeout(
        (async () => {
          const cookie = await getCookie()
          return fetchPrice(cached.sku, cookie)
        })(),
        20000,
      )
      const d = new Date()
      const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
      const history: PriceEntry[] = Array.isArray(cached.history) ? cached.history.slice() : []
      const prevPrice = history.length > 0 ? history[history.length - 1].p : null
      const last = history.length > 0 ? history[history.length - 1] : null
      if (!last || last.p !== p || now.getTime() - last.t > 15 * 60 * 1000) {
        history.push({ t: now.getTime(), p })
      }
      const kept = history.slice(-30)
      const prices = kept.map((x) => x.p)
      const data: WidgetData = {
        ...cached,
        price: p,
        prevPrice,
        low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        history: kept,
        updatedAt: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        updatedTs: now.getTime(),
        lastTryTs: undefined,
        lastTryAt: undefined,
        fromCache: false,
        error: '',
      }
      saveCache(data)
      Widget.present(<WidgetView data={data} />, {
        reloadPolicy: {
          policy: 'after',
          date: nextReload,
        },
      })
      return
    } catch (e) {
      // 拉失败了就显示旧缓存，不报错、不转圈，
      // 但把“这次尝试过、没拉到”记下来，底行会显示
      // “15:00 更新失败”，下次就知道小组件到底跑没跑。
      try {
        const d = new Date()
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
        cached.lastTryTs = now.getTime()
        cached.lastTryAt = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        saveCache(cached)
      } catch (e2) {}
    }
  }
  if (cached && cached.price != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    return
  }
  // 完全没有缓存（第一次用）：直接拉一次，拉不到就提示打开 App
  try {
    const sku = await getSku()
    const p = await withTimeout(
      (async () => {
        const cookie = await getCookie()
        return fetchPrice(sku, cookie)
      })(),
      20000,
    )
    const d = new Date()
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    const data: WidgetData = {
      name: '西昊豆包椅L1',
      sku,
      price: p,
      prevPrice: null,
      low: p,
      high: p,
      history: [{ t: now.getTime(), p }],
      updatedAt: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      updatedTs: now.getTime(),
      fromCache: false,
      error: '',
    }
    saveCache(data)
    Widget.present(<WidgetView data={data} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    return
  } catch (e) {}
  Widget.present(
    <ErrorView message="还没价格。打开一次 App，它会自动拉新价并刷新小组件。" />,
  )
})().catch(() => {
  // 兜底：入口任何地方抛错都不能让小组件空白。
  // 到点自动跑的那次最容易在外面抛错（前面只包了拉价那一段），
  // 一旦 Widget.present 没跑到，小组件就直接不显示。
  // 这里尽量显示缓存，实在没有就显示提示。
  try {
    const cached = readCached()
    if (cached && cached.price != null) {
      cached.fromCache = true
      Widget.present(<WidgetView data={cached} />, {
        reloadPolicy: {
          policy: 'after',
          date: nextSlot(new Date(), getSlots()),
        },
      })
      return
    }
  } catch (e2) {}
  try {
    Widget.present(
      <ErrorView message="还没价格。打开一次 App，它会自动拉新价并刷新小组件。" />,
    )
  } catch (e3) {}
})
