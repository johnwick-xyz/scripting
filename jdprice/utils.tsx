import { Widget } from 'scripting'

// ==================== 类型定义 ====================

export interface PriceEntry {
  t: number
  p: number
}

export interface WidgetData {
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

export interface AppConfig {
  sku: string
  name: string
  cookie: string
  slots: string
}

// ==================== 常量 ====================

export const DEFAULT_IMAGE_URL =
  'https://img10.360buyimg.com/img/jfs/t1/572241/19/12897/149428/6afed993F3dda89e5/008332032016639f.jpg'

export const DEFAULT_SLOTS = [9, 15, 21]

export const PRICE_URLS = (sku: string) => [
  `https://p.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
  `https://pm.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
]

export const BOXJS_URLS = [
  'http://boxjs.com/query/data/jd_cookie',
  'http://boxjs.com/query/data/@JD.cookie',
]

export const WARE_BUSINESS_URL = (sku: string) =>
  'https://api.m.jd.com/client.action?functionId=wareBusiness&appid=productDetail&body=' +
  encodeURIComponent(JSON.stringify({ skuId: sku }))

export const PRODUCT_INFO_URL = (sku: string) =>
  `https://item.m.jd.com/product/${sku}.html`

// 路径集中管理，避免 index.tsx / widget.tsx 重复拼接
export const getAppRoot = () => Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
export const getPrefPath = () => Path.join(getAppRoot(), 'preference.json')
export const getCachePath = () => Path.join(getAppRoot(), 'cache.json')
export const getHistoryPath = () => Path.join(getAppRoot(), 'price_history.json')
export const getImagePath = () => Path.join(getAppRoot(), 'product.jpg')

// ==================== 尺寸工具 ====================

export const vmin = (num: number) => {
  const { width, height } = Widget.displaySize
  return (num * Math.min(width, height)) / 100
}

export const rpt = (n: number) => vmin((n * 100) / 155)

// ==================== 时间点解析 ====================

/**
 * 解析用户填的更新时间点："9,15,21"、"9:00,15:00"、"9，15，21" 都行，
 * 只取整点小时（分钟忽略），0–23，去重排序；填错、填空就回默认。
 */
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

/** 显示用："9:00、15:00、21:00" */
export function slotsLabel(slots: number[]): string {
  return slots.map((h) => `${h}:00`).join('、')
}

export function fmtTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtSlot(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 下一个整点（拉价时间） */
export function nextSlot(now: Date, slots: number[]): Date {
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

/** 当前这个更新点：最近过去的那个 */
export function currentSlot(now: Date, slots: number[]): Date {
  let slot = -1
  for (const h of slots) {
    if (now.getHours() >= h) slot = h
  }
  const d = new Date(now)
  if (slot === -1) d.setDate(d.getDate() - 1)
  d.setHours(slot === -1 ? slots[slots.length - 1] : slot, 0, 0, 0)
  return d
}

/** 更新窗口 = 第一个点到最后一个点之后 1 小时 */
export function isUpdateWindow(now: Date, slots: number[]): boolean {
  const h = now.getHours()
  return h >= slots[0] && h < slots[slots.length - 1] + 1
}

// ==================== 价格解析 ====================

/** 严格取数：只认纯数字（"479"、"479.00"），拒绝 "4??" 这种被遮住的价格 */
export function strictNum(v: any): number | null {
  if (typeof v === 'number') return v > 0 ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    const p = parseFloat(s)
    return !isNaN(p) && p > 0 ? p : null
  }
  return null
}

/** App 接口返回里价格位置不固定，挨个试，拿到大于 0 的数就返回 */
export function extractWarePrice(j: any): number | null {
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

// ==================== 网络请求 ====================

/** 单个请求带超时（Promise.race + setTimeout，因为 AbortSignal 在 Scripting 里断不开 fetch） */
export async function fetchWithTimeout(url: string, options: any, ms: number): Promise<any> {
  return Promise.race([
    fetch(url, options),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('请求超时')), ms),
    ),
  ])
}

/** 外层超时兜底 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (typeof setTimeout !== 'function') return p
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('超时')), ms)
    }),
  ])
}

/** 从 BoxJs 查询 Cookie */
export async function getBoxJsCookie(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(url, { method: 'GET' }, 3000)
    const j: any = await res.json()
    const v = j && (j.val || j.data || j.value)
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof j === 'string' && j.trim()) return j.trim()
  } catch (e) {}
  return ''
}

// ==================== Cookie & SKU 获取 ====================

/**
 * 获取京东 Cookie，优先级：
 * 1) App 存进 Storage 共享域的 Cookie
 * 2) App 设置页保存的 preference.json
 * 3) BoxJs（Loon 抓的），每条 3 秒原生超时
 */
export async function getCookie(): Promise<string> {
  try {
    const v: any = Storage.get('jd_cookie', { shared: true })
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (e) {}

  try {
    const prefPath = getPrefPath()
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.cookie) return String(pref.cookie)
    }
  } catch (e) {}

  for (const url of BOXJS_URLS) {
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

/** 获取要监控的商品 SKU，优先级：Storage 共享域 > preference.json > 默认值 */
export async function getSku(): Promise<string> {
  try {
    const v: any = Storage.get('jd_sku', { shared: true })
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (e) {}

  try {
    const prefPath = getPrefPath()
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.sku) return String(pref.sku)
    }
  } catch (e) {}

  return '100244780555'
}

// ==================== 价格获取 ====================

/** p.3.cn / pm.3.cn 轻量价接口，5 秒超时 */
export async function fetchP3Price(sku: string, cookie: string): Promise<number | null> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: `https://item.jd.com/${sku}.html`,
  }
  if (cookie) headers.Cookie = cookie

  for (const url of PRICE_URLS(sku)) {
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

/** 京东 App 自身接口 wareBusiness（api.m.jd.com），8 秒超时 */
export async function fetchWareBusinessPrice(
  sku: string,
  cookie: string
): Promise<number | null> {
  const apiHeaders: any = {
    Host: 'api.m.jd.com',
    'User-Agent':
      'jdapp;iPhone;9.4.4;14.3;network/4g;Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1',
  }
  if (cookie) apiHeaders.Cookie = cookie

  const res: any = await fetchWithTimeout(
    WARE_BUSINESS_URL(sku),
    { method: 'GET', headers: apiHeaders },
    8000,
  )
  const j: any = await res.json()
  return extractWarePrice(j)
}

/**
 * 取价主流程：先走轻量的 p.3.cn（带 Cookie，5 秒），
 * 再走 wareBusiness（api.m.jd.com，8 秒），
 * 最后备用商品页（item.m.jd.com，10 秒）。
 * 所有源都失败才抛错，错误信息里会带上各源调试结果。
 */
export async function fetchPrice(sku: string, cookie: string): Promise<number> {
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

  // 备用：带 Cookie 拉商品页，页里 "jdPrice":"459.00" 就是真价；
  // 没登录时这里是 "4??"，带问号的不要。
  try {
    const headers: any = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      Referer: `https://item.jd.com/${sku}.html`,
    }
    if (cookie) headers.Cookie = cookie

    const text: string = await Promise.race([
      fetch(PRODUCT_INFO_URL(sku), {
        method: 'GET',
        headers,
      }).then((r) => r.text()),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('商品页超时')), 10000),
      ),
    ])

    const m = typeof text === 'string' ? text.match(/"jdPrice":"([0-9]+(?:\.[0-9]+)?)"/) : null
    if (m) {
      const p = parseFloat(m[1])
      if (!isNaN(p) && p > 0) return p
    }
    dbg.push('商品页无价')
  } catch (e) {
    dbg.push('商品页 ' + String((e as any)?.message || e).slice(0, 20))
  }

  throw new Error(
    '取价接口没返回价格，可能是网络或接口被拦了（' +
      dbg.join('；') +
      '）' +
      (cookie ? '' : '。这个商品要登录才能看价，先填京东 Cookie 再试'),
  )
}

// ==================== 商品图片与名称 ====================

/** 从商品页一次取回主图链接和商品名。失败也不影响价格。 */
export async function fetchProductInfo(
  sku: string,
  cookie: string
): Promise<{ imageUrl: string; name: string }> {
  try {
    const headers: any = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    }
    if (cookie) headers.Cookie = cookie

    const text: string = await Promise.race([
      fetch(PRODUCT_INFO_URL(sku), {
        method: 'GET',
        headers,
      }).then((r) => r.text()),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('商品页超时')), 10000),
      ),
    ])

    let imageUrl = ''
    let name = ''
    if (typeof text === 'string') {
      const im = text.match(/"imagePath":"([^"]+)"/)
      if (im) imageUrl = `https://img10.360buyimg.com/img/${im[1]}`
      const nm = text.match(/"skuName":"([^"]+)"/)
      if (nm) name = nm[1].split(' ')[0]
    }
    return { imageUrl, name }
  } catch (e) {}
  return { imageUrl: '', name: '' }
}

/** 把商品图下载到本地文件。小组件里远程图经常加载失败，本地文件才稳。 */
export async function downloadImage(url: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch(url, { method: 'GET' })
    const buf: ArrayBuffer = await res.arrayBuffer()
    if (!buf || buf.byteLength < 1000) return ''
    FileManager.writeAsBytesSync(getImagePath(), new Uint8Array(buf))
    return getImagePath()
  } catch (e) {}
  return ''
}

// ==================== 缓存读写 ====================

/** 读缓存：优先 Storage 共享域，其次本地文件 cache.json */
export function readCached(): WidgetData | null {
  try {
    const v: any = Storage.get('jd_price_cache', { shared: true })
    if (v) return typeof v === 'string' ? JSON.parse(v) : v
  } catch (e) {}

  try {
    const cachePath = getCachePath()
    if (FileManager.existsSync(cachePath)) {
      return JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
    }
  } catch (e) {}

  return null
}

/** 写缓存：同时写 Storage 共享域 + 本地文件（文件只当备用） */
export function saveCache(data: WidgetData) {
  try {
    Storage.set('jd_price_cache', data, { shared: true })
  } catch (e) {}

  try {
    const root = getAppRoot()
    if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
    FileManager.writeAsStringSync(getCachePath(), JSON.stringify(data))
    FileManager.writeAsStringSync(getHistoryPath(), JSON.stringify(data.history || []))
  } catch (e) {}
}
