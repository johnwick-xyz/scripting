import {
  Button,
  HStack,
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

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const prefPath = Path.join(root, 'preference.json')
const cachePath = Path.join(root, 'cache.json')
const historyPath = Path.join(root, 'price_history.json')

const PRICE_URLS = (sku: string) => [
  `https://p.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
  `https://pm.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
]
const BOXJS_URLS = [
  'http://boxjs.com/query/data/jd_cookie',
  'http://boxjs.com/query/data/@JD.cookie',
]

// 更新时间段：9-22 点，每 6 小时一次，
// 也就是 9:00、15:00、21:00 三个点。
function nextSlot(now: Date): Date {
  const slots = [9, 15, 21]
  for (const h of slots) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d.getTime() > now.getTime()) return d
  }
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

function fmtSlot(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isUpdateWindow(now: Date): boolean {
  const h = now.getHours()
  return h >= 9 && h < 22
}

// 取价只在 App 里做（小组件里 fetch 一旦没反应就一直转圈）。
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

async function fetchPrice(sku: string, cookie: string): Promise<number> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: `https://item.jd.com/${sku}.html`,
  }
  if (cookie) headers.Cookie = cookie
  for (const url of PRICE_URLS(sku)) {
    try {
      const res: any = await fetchJsonWithTimeout(url, { method: 'GET', headers })
      const list = Array.isArray(res) ? res : []
      for (const item of list) {
        if (String(item.id || '').replace(/^J_/, '') === String(sku) && item.p) {
          const p = parseFloat(item.p)
          if (!isNaN(p) && p > 0) return p
        }
      }
    } catch (e) {}
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
  } catch (e) {}
  throw new Error(
    '取价接口没返回价格，可能是网络或接口被拦了' +
      (cookie ? '' : '。这个商品要登录才能看价，先填京东 Cookie 再试'),
  )
}

function App() {
  const [sku, setSku] = useState<string>('100244780555')
  const [name, setName] = useState<string>('西昊豆包椅L1')
  const [cookie, setCookie] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [price, setPrice] = useState<string>('')
  const [status, setStatus] = useState<string>('打开 App 后自动拉价…')

  // auto=true 是打开 App 时自动拉，manual（点“刷新价格”）永远拉。
  // 自动拉只在 9-22 点、且上次拉取超过 6 小时才拉。
  async function refresh(auto = false) {
    const now0 = new Date()
    if (auto) {
      if (!isUpdateWindow(now0)) {
        setStatus(`不在更新时间（9-22点），下次：${fmtSlot(nextSlot(now0))}`)
        return
      }
      try {
        const cached: any = Storage.get('jd_price_cache', { shared: true })
        const ts = cached ? (typeof cached === 'string' ? JSON.parse(cached).updatedTs : cached.updatedTs) : null
        if (ts && now0.getTime() - ts < 6 * 3600 * 1000) {
          setStatus(`6小时内已拉过，下次：${fmtSlot(nextSlot(now0))}`)
          return
        }
      } catch (e) {}
      try {
        if (FileManager.existsSync(cachePath)) {
          const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
          if (cached.updatedTs && now0.getTime() - cached.updatedTs < 6 * 3600 * 1000) {
            setStatus(`6小时内已拉过，下次：${fmtSlot(nextSlot(now0))}`)
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
        name,
        sku,
        price: p,
        prevPrice,
        low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        history: kept,
        updatedAt,
        updatedTs: now,
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
      setPrice(p.toFixed(2))
      setStatus(`已更新：${updatedAt}，下次：${fmtSlot(nextSlot(new Date()))}`)
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
      } catch (e) {
        console.error('Failed to parse preference', e)
      }
    }
    if (FileManager.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
        if (cached.price != null) setPrice(Number(cached.price).toFixed(2))
        if (cached.updatedAt) setStatus(`上次更新：${cached.updatedAt}`)
      } catch (e) {}
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (!FileManager.existsSync(root)) {
      FileManager.createDirectorySync(root, true)
    }
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ sku, name, cookie }))
    Widget.reloadAll()
  }, [sku, name, cookie, loaded])

  // 设置加载完后自动拉一次价（按 9-22 点、每 6 小时那个规则）
  useEffect(() => {
    if (!loaded) return
    refresh(true)
  }, [loaded])

  return (
    <NavigationStack>
      <List navigationTitle="京东价格监控">
        <Section header={<Text>当前价格</Text>}>
          <HStack>
            <Text>实时价</Text>
            <Text fontWeight="bold">¥{price || '—'}</Text>
          </HStack>
          <Text foregroundStyle="secondaryLabel">{status}</Text>
          <Button title="刷新价格" action={() => refresh()} />
        </Section>
        <Section header={<Text>商品</Text>}>
          <HStack>
            <Text>商品编号</Text>
            <TextField title="100244780555" value={sku} onChanged={setSku} />
          </HStack>
          <HStack>
            <Text>商品简称</Text>
            <TextField title="西昊豆包椅L1" value={name} onChanged={setName} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            编号就是京东链接里 item.jd.com/ 后面的数字。换商品只改编号和简称，不用改代码。
          </Text>
        </Section>
        <Section header={<Text>京东 Cookie（这个商品要登录才能看价）</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴京东 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            没登录的请求 p.3.cn 直接没反应。先手动粘贴一次就能用；也可以用 Loon 抓：装好 Jd.lpx 后，打开京东 App 刷一次商品页，Cookie 会自动写进 BoxJs，小组件会自动读，不用填这里。Cookie 不要发给别人，也不要提交到 GitHub。
          </Text>
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text foregroundStyle="secondaryLabel">
            小组件本身不联网，只读 App 存下来的缓存，所以预览秒出、绝不转圈。自动更新是 9-22 点、每 6 小时一次（9:00、15:00、21:00），打开 App 时按这个规则自动拉；点“刷新价格”随时都能手动拉。预览里如果还是旧的，点右上角“重新载入”再看一次。
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
