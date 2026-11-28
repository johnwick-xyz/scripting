import {
  Button,
  HStack,
  Image,
  List,
  Navigation,
  NavigationStack,
  Path,
  Script,
  Section,
  SecureField,
  Text,
  TextField,
  Widget,
  fetch,
  useEffect,
  useState,
} from 'scripting'
import { parseSlots, slotsLabel } from './utils'

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const prefPath = Path.join(root, 'preference.json')
const cachePath = Path.join(root, 'cache.json')
const historyPath = Path.join(root, 'price_history.json')
const imagePath = Path.join(root, 'product.jpg')

const PRICE_URLS = (sku: string) => [
  `https://p.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
  `https://pm.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
]
const BOXJS_URLS = [
  'http://boxjs.com/query/data/jd_cookie',
  'http://boxjs.com/query/data/@JD.cookie',
]

const DEFAULT_IMAGE_URL =
  'https://img10.360buyimg.com/img/jfs/t1/572241/19/12897/149428/6afed993F3dda89e5/008332032016639f.jpg'

// 从商品页一次取回主图链接和商品名。失败也不影响价格。
async function fetchProductInfo(
  sku: string,
  cookie: string,
): Promise<{ imageUrl: string; name: string }> {
  try {
    const headers: any = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    }
    if (cookie) headers.Cookie = cookie
    const text: string = await Promise.race([
      fetch(`https://item.m.jd.com/product/${sku}.html`, {
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

// 把商品图下载到本地文件。小组件里远程图经常加载失败
// （之前右上角就是一个破图图标），本地文件才稳。
async function downloadImage(url: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch(url, { method: 'GET' })
    const buf: ArrayBuffer = await res.arrayBuffer()
    if (!buf || buf.byteLength < 1000) return ''
    FileManager.writeAsBytesSync(imagePath, new Uint8Array(buf))
    return imagePath
  } catch (e) {}
  return ''
}

// 更新时间点是用户在 App 里填的（默认 9:00、15:00、21:00），
// 存在共享域 'jd_refresh_slots'，两个京东小组件共用。
// 更新窗口 = 第一个点到最后一个点之后 1 小时（默认 9-22 点）。
// 取数比整点晚 2 分钟：手动刷也要很久才拿到价，
// 整点那一下可能正赶上忙、取数慢，小组件在后台等不起，
// 往后挪 2 分钟再取，错开整点。
const SLOT_DELAY_MINUTES = 2
function nextSlot(now: Date, slots: number[]): Date {
  for (const h of slots) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d.getTime() > now.getTime()) {
      d.setMinutes(d.getMinutes() + SLOT_DELAY_MINUTES)
      return d
    }
  }
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(slots[0], 0, 0, 0)
  d.setMinutes(d.getMinutes() + SLOT_DELAY_MINUTES)
  return d
}

function fmtSlot(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isUpdateWindow(now: Date, slots: number[]): boolean {
  const h = now.getHours()
  return h >= slots[0] && h < slots[slots.length - 1] + 1
}

// 当前这个更新点：最近过去的那个。
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

// 这个商品要登录才能看价，带上京东 Cookie 再去拉。
async function fetchJsonWithTimeout(url: string, options: any, ms = 8000): Promise<any> {
  return Promise.race([
    fetch(url, options).then((r) => r.json()),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('取价超时（8秒没返回）')), ms),
    ),
  ])
}

async function getBoxJsCookie(url: string): Promise<string> {
  try {
    const res = await fetchJsonWithTimeout(url, { method: 'GET' }, 3000)
    const v = res && (res.val || res.data || res.value)
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof res === 'string' && res.trim()) return res.trim()
  } catch (e) {}
  return ''
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
    const p = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
    if (!isNaN(p) && p > 0) return p
  }
  try {
    const s = JSON.stringify(j)
    let m = s.match(/"jdPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/)
    if (m) {
      const p = parseFloat(m[1])
      if (!isNaN(p) && p > 0) return p
    }
    m = s.match(/"price"\s*:\s*\{\s*"p"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/)
    if (m) {
      const p = parseFloat(m[1])
      if (!isNaN(p) && p > 0) return p
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
  const j: any = await fetchJsonWithTimeout(url, { method: 'GET', headers: apiHeaders }, 8000)
  return extractWarePrice(j)
}

async function fetchPrice(sku: string, cookie: string): Promise<number> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: `https://item.jd.com/${sku}.html`,
  }
  if (cookie) headers.Cookie = cookie
  // 先走京东 App 自己的接口 api.m.jd.com（京豆就是走这边的，能通）：
  //   GET https://api.m.jd.com/client.action?functionId=wareBusiness&appid=productDetail&body={"skuId":"..."}
  // p.3.cn 在小组件后台拉不到价，所以放前面；不行再走 p.3.cn。
  // dbg 记下每个源的结果，万一都失败，报错里能看到是哪一步出的错。
  const dbg: string[] = []
  try {
    const p = await fetchWareBusinessPrice(sku, cookie)
    if (p != null) return p
    dbg.push('wareBusiness 无价')
  } catch (e) {
    dbg.push('wareBusiness ' + String((e as any)?.message || e).slice(0, 20))
  }
  for (const url of PRICE_URLS(sku)) {
    try {
      const res: any = await fetchJsonWithTimeout(url, { method: 'GET', headers })
      const list = Array.isArray(res) ? res : []
      let found = false
      for (const item of list) {
        if (String(item.id || '').replace(/^J_/, '') === String(sku) && item.p) {
          const p = parseFloat(item.p)
          if (!isNaN(p) && p > 0) return p
        }
      }
      if (!found)
        dbg.push(url.indexOf('pm.3.cn') >= 0 ? 'pm 无价' : 'p3 无价')
    } catch (e) {
      dbg.push(
        (url.indexOf('pm.3.cn') >= 0 ? 'pm ' : 'p3 ') +
          String((e as any)?.message || e).slice(0, 20),
      )
    }
  }
  // 备用：带 Cookie 拉商品页，页里 "jdPrice":"459.00" 就是真价；
  // 没登录时这里是 "4??"，带问号的不要。
  try {
    const text: string = await Promise.race([
      fetch(`https://item.m.jd.com/product/${sku}.html`, {
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

function App() {
  const [sku, setSku] = useState<string>('100244780555')
  const [name, setName] = useState<string>('西昊豆包椅L1')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [imageLocal, setImageLocal] = useState<string>('')
  const [cookie, setCookie] = useState<string>('')
  const [slotsText, setSlotsText] = useState<string>('9,15,21')
  const [loaded, setLoaded] = useState(false)
  const [price, setPrice] = useState<string>('')
  const [status, setStatus] = useState<string>('打开 App 后自动拉价…')

  // auto=true 是打开 App 时自动拉，manual（点“刷新价格”）永远拉。
  // 自动拉只在更新窗口内、且上次拉取在当前这个更新点之前才拉。
  // 不能用“6 小时内已拉过”来判断——手动点一次刷新，
  // updatedTs 就刷成现在，小组件到下一个更新点一看“才过 4 小时”
  // 就直接跳过，自动更新就永远不跑（2026-11-22 15:00 就是这么错过的）。
  async function refresh(auto = false) {
    const now0 = new Date()
    const slots = parseSlots(slotsText)
    if (auto) {
      if (!isUpdateWindow(now0, slots)) {
        setStatus(
          `不在更新时间（${slots[0]}-${slots[slots.length - 1] + 1}点），下次：${fmtSlot(nextSlot(now0, slots))}`,
        )
        return
      }
      try {
        const cached: any = Storage.get('jd_price_cache', { shared: true })
        const ts = cached ? (typeof cached === 'string' ? JSON.parse(cached).updatedTs : cached.updatedTs) : null
        if (ts && ts >= currentSlot(now0, slots).getTime()) {
          setStatus(`这个更新点已经拉过，下次：${fmtSlot(nextSlot(now0, slots))}`)
          return
        }
      } catch (e) {}
      try {
        if (FileManager.existsSync(cachePath)) {
          const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
          if (cached.updatedTs && cached.updatedTs >= currentSlot(now0, slots).getTime()) {
            setStatus(`这个更新点已经拉过，下次：${fmtSlot(nextSlot(now0, slots))}`)
            return
          }
        }
      } catch (e) {}
    }
    setStatus('正在拉价…')
    try {
      let ck = cookie
      if (!ck) {
        for (const url of BOXJS_URLS) {
          const v = await getBoxJsCookie(url)
          if (v) {
            ck = v
            break
          }
        }
      }
      const p = await fetchPrice(sku, ck)
      const info = await fetchProductInfo(sku, ck)
      let img = info.imageUrl || imageUrl || DEFAULT_IMAGE_URL
      let local = ''
      if (info.imageUrl) local = await downloadImage(info.imageUrl)
      if (!local && FileManager.existsSync(imagePath)) local = imagePath
      const displayName = info.name || name || '京东商品'
      setName(displayName)
      setImageUrl(img)
      setImageLocal(local)
      const now = Date.now()
      const d = new Date()
      const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
      const updatedAt = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      let history: { t: number; p: number }[] = []
      try {
        if (FileManager.existsSync(historyPath)) {
          history = JSON.parse(FileManager.readAsStringSync(historyPath) || '[]')
          if (!Array.isArray(history)) history = []
        }
      } catch (e) {}
      const prevPrice = history.length > 0 ? history[history.length - 1].p : null
      const last = history.length > 0 ? history[history.length - 1] : null
      if (!last || last.p !== p || now - last.t > 15 * 60 * 1000) {
        history.push({ t: now, p })
      }
      const kept = history.slice(-30)
      const prices = kept.map((x) => x.p)
      const data = {
        name: displayName,
        sku,
        price: p,
        prevPrice,
        low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        history: kept,
        updatedAt,
        updatedTs: now,
        imageUrl: img,
        imagePath: local,
        fromCache: false,
        error: '',
      }
      if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
      FileManager.writeAsStringSync(cachePath, JSON.stringify(data))
      FileManager.writeAsStringSync(historyPath, JSON.stringify(kept))
      // 跨界面共享：App 和小组件是两次分开的执行，文件传不过去，
      // 必须写进 Storage 的 shared 域，小组件才能读到。
      Storage.set('jd_price_cache', data, { shared: true })
      Storage.set('jd_price_history', kept, { shared: true })
      Storage.set('jd_sku', sku, { shared: true })
      if (ck) Storage.set('jd_cookie', ck, { shared: true })
      setPrice(p.toFixed(2))
      setStatus(`已更新：${updatedAt}，下次：${fmtSlot(nextSlot(new Date(), slots))}`)
      Widget.reloadAll()
    } catch (e) {
      setStatus('拉取失败：' + String(e))
    }
  }

  useEffect(() => {
    if (FileManager.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.sku) setSku(String(pref.sku))
        if (pref.name) setName(pref.name)
        if (pref.cookie) setCookie(pref.cookie)
        if (pref.slots) setSlotsText(String(pref.slots))
      } catch (e) {
        console.error('Failed to parse preference', e)
      }
    }
    // 共享域优先：两边共用同一份刷新时间，改一边两边都生效，
    // 共享域里的值会覆盖上面 preference.json 里旧的那份。
    try {
      const v: any = Storage.get('jd_refresh_slots', { shared: true })
      if (v != null && String(v).trim()) setSlotsText(String(v))
    } catch (e) {}
    if (FileManager.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
        if (cached.price != null) setPrice(Number(cached.price).toFixed(2))
        if (cached.name) setName(cached.name)
        if (cached.imageUrl) setImageUrl(cached.imageUrl)
        if (cached.imagePath) setImageLocal(cached.imagePath)
        if (cached.updatedAt) setStatus(`上次更新：${cached.updatedAt}`)
      } catch (e) {}
    }
    if (FileManager.existsSync(imagePath)) setImageLocal(imagePath)
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (!FileManager.existsSync(root)) {
      FileManager.createDirectorySync(root, true)
    }
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ sku, name, cookie, slots: slotsText }))
    try {
      Storage.set('jd_sku', sku, { shared: true })
      if (cookie) Storage.set('jd_cookie', cookie, { shared: true })
      Storage.set('jd_refresh_slots', slotsText, { shared: true })
    } catch (e) {}
    Widget.reloadAll()
  }, [sku, name, cookie, slotsText, loaded])

  // 设置加载完后自动拉一次价（按更新点那个规则）
  useEffect(() => {
    if (!loaded) return
    refresh(true)
  }, [loaded])

  return (
    <NavigationStack>
      <List navigationTitle="京东价格监控">
        <Section header={<Text>当前价格</Text>}>
          <HStack>
            <Text>{name}</Text>
            <Text fontWeight="bold">¥{price || '—'}</Text>
          </HStack>
          <Text foregroundStyle="secondaryLabel">{status}</Text>
          <Button title="刷新价格" action={() => refresh()} />
        </Section>
        <Section header={<Text>商品图片</Text>}>
          <HStack>
            {imageLocal ? (
              <Image filePath={imageLocal} resizable frame={{ width: 80, height: 80 }} />
            ) : (
              <Image
                imageUrl={imageUrl || DEFAULT_IMAGE_URL}
                resizable
                frame={{ width: 80, height: 80 }}
              />
            )}
            <Text foregroundStyle="secondaryLabel">
              小组件右边的图就是这张，App 拉价时自动下载到本地。
            </Text>
          </HStack>
        </Section>
        <Section header={<Text>商品</Text>}>
          <HStack>
            <Text>商品编号</Text>
            <TextField title="100244780555" value={sku} onChanged={setSku} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            编号就是京东链接里 item.jd.com/ 后面的数字。换商品只改编号，商品名和图片会自动去拉，不用改代码。
          </Text>
        </Section>
        <Section header={<Text>京东 Cookie（这个商品要登录才能看价）</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴京东 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            没登录的请求 p.3.cn 直接没反应。先手动粘贴一次就能用；也可以用 Loon 抓：装好 Jd.lpx 后，打开京东 App 刷一次商品页，Cookie 会自动写进 BoxJs，小组件会自动读，不用填这里。Cookie 只存在手机本地，不会上传云端，也不要提交到 GitHub。
          </Text>
        </Section>
        <Section header={<Text>刷新时间</Text>}>
          <HStack>
            <Text>更新时间点</Text>
            <TextField title="9,15,21" value={slotsText} onChanged={setSlotsText} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            填整点小时，用逗号隔开，例如 9,15,21；也可以写 9:00,15:00（分钟忽略）。小组件会在这些时间点各拉一次新数据。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            当前生效：{slotsLabel(parseSlots(slotsText))}。和京豆那个小组件共用同一份设置，在这边改了，那边也跟着变。
          </Text>
          <Button title="恢复默认（9,15,21）" action={() => setSlotsText('9,15,21')} />
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text foregroundStyle="secondaryLabel">
            小组件到更新点（{slotsLabel(parseSlots(slotsText))}）会自己拉一次新价，用的是系统原生超时，拉不到就显示旧价格，不会转圈。打开 App
            时也按更新点这个规则自动拉；点“刷新价格”随时都能手动拉。
          </Text>
        </Section>
        <Section>
          <Button
            title="清空价格历史"
            action={() => {
              try {
                Storage.remove('jd_price_cache', { shared: true })
                Storage.remove('jd_price_history', { shared: true })
              } catch (e) {}
              if (FileManager.existsSync(historyPath)) {
                FileManager.removeItemSync(historyPath)
              }
              if (FileManager.existsSync(cachePath)) {
                FileManager.removeItemSync(cachePath)
              }
              setPrice('')
              setStatus('历史已清空，打开 App 会重新拉价')
              Widget.reloadAll()
            }}
          />
          <Button title="预览小组件" action={() => Widget.preview()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
