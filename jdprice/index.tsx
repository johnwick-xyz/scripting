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

import {
  DEFAULT_IMAGE_URL,
  DEFAULT_SLOTS,
  fetchPrice,
  fetchProductInfo,
  downloadImage,
  getBoxJsCookie,
  getSku,
  isUpdateWindow,
  nextSlot,
  parseSlots,
  slotsLabel,
  saveCache,
  strictNum,
  getAppRoot,
  getPrefPath,
  getCachePath,
  getHistoryPath,
  getImagePath,
  readCached,
} from './utils'

const prefPath = getPrefPath()
const cachePath = getCachePath()
const historyPath = getHistoryPath()
const imagePath = getImagePath()

const BOXJS_URLS = [
  'http://boxjs.com/query/data/jd_cookie',
  'http://boxjs.com/query/data/@JD.cookie',
]

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
  const [isForceRefreshing, setIsForceRefreshing] = useState<boolean>(false)

  // 严格取数：只认纯数字，拒绝 "4??" 这种被遮住的价格
  // （此处复用 utils.strictNum，若需本地校验可直接调用）

  // auto=true 是打开 App 时自动拉，manual（点“刷新价格”）永远拉。
  // 自动拉只在更新窗口内、且上次拉取在当前这个更新点之前才拉。
  // 不能用“6 小时内已拉过”来判断——手动点一次刷新，
  // updatedTs 就刷成现在，小组件到下一个更新点一看“才过 4 小时”
  // 就直接跳过，自动更新就永远不跑（2026-11-22 15:00 就是这么错过的）。
  async function refresh(force = false) {
    const now0 = new Date()
    const slots = parseSlots(slotsText)

    // 非强制刷新且为自动拉取时，才受更新时间窗口和缓存新鲜度限制
    if (!force) {
      if (now0.getHours() < slots[0] || now0.getHours() >= slots[slots.length - 1] + 1) {
        setStatus(
          `不在更新时间（${slots[0]}-${slots[slots.length - 1] + 1}点），下次：${nextSlot(now0, slots).toLocaleString()}`,
        )
        return
      }
      try {
        const cached = readCached()
        const ts = cached?.updatedTs
        const slotMs = currentSlotMs(now0, slots)
        if (ts && ts >= slotMs) {
          setStatus(`这个更新点已经拉过，下次：${formatSlot(nextSlot(now0, slots))}`)
          return
        }
      } catch (e) {}
    }

    setStatus(force ? '正在强制刷新…' : '正在拉价…')
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
      if (!local && (await fileExists(imagePath))) local = imagePath

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
        if (await fileExists(historyPath)) {
          history = JSON.parse((await readFile(historyPath)) || '[]')
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

      const root = getAppRoot()
      if (!(await fileExists(root))) {
        FileManager.createDirectorySync(root, true)
      }
      FileManager.writeAsStringSync(cachePath, JSON.stringify(data))
      FileManager.writeAsStringSync(historyPath, JSON.stringify(kept))

      // 跨界面共享：App 和小组件是两次分开的执行，文件传不过去，
      // 必须写进 Storage 的 shared 域，小组件才能读到。
      Storage.set('jd_price_cache', data, { shared: true })
      Storage.set('jd_price_history', kept, { shared: true })
      Storage.set('jd_sku', sku, { shared: true })
      if (ck) Storage.set('jd_cookie', ck, { shared: true })

      setPrice(p.toFixed(2))
      setStatus(
        force
          ? `已强制刷新：${updatedAt}，下次：${formatSlot(nextSlot(new Date(), slots))}`
          : `已更新：${updatedAt}，下次：${formatSlot(nextSlot(new Date(), slots))}`,
      )
      Widget.reloadAll()
    } catch (e) {
      setStatus('拉取失败：' + String(e))
    }
  }

  // 辅助：当前这个更新点的毫秒时间
  function currentSlotMs(now: Date, slots: number[]): number {
    let slot = -1
    for (const h of slots) {
      if (now.getHours() >= h) slot = h
    }
    const d = new Date(now)
    if (slot === -1) d.setDate(d.getDate() - 1)
    d.setHours(slot === -1 ? slots[slots.length - 1] : slot, 0, 0, 0)
    return d.getTime()
  }

  function formatSlot(d: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function fileExists(p: string): Promise<boolean> {
    try {
      return FileManager.existsSync(p)
    } catch {
      return false
    }
  }

  async function readFile(p: string): Promise<string> {
    try {
      return FileManager.readAsStringSync(p) || ''
    } catch {
      return ''
    }
  }

  useEffect(() => {
    // 读本地配置
    try {
      if (await fileExists(prefPath)) {
        const pref = JSON.parse(await readFile(prefPath) || '{}')
        if (pref.sku) setSku(String(pref.sku))
        if (pref.name) setName(pref.name)
        if (pref.cookie) setCookie(pref.cookie)
        if (pref.slots) setSlotsText(String(pref.slots))
      }
    } catch (e) {
      console.error('Failed to parse preference', e)
    }

    // 共享域优先：两边共用同一份刷新时间，改一边两边都生效
    try {
      const v: any = Storage.get('jd_refresh_slots', { shared: true })
      if (v != null && String(v).trim()) setSlotsText(String(v))
    } catch (e) {}

    // 读缓存回显
    try {
      const cached = readCached()
      if (cached) {
        if (cached.price != null) setPrice(Number(cached.price).toFixed(2))
        if (cached.name) setName(cached.name)
        if (cached.imageUrl) setImageUrl(cached.imageUrl)
        if (cached.imagePath) setImageLocal(cached.imagePath)
        if (cached.updatedAt) setStatus(`上次更新：${cached.updatedAt}`)
      }
    } catch (e) {}

    try {
      if (await fileExists(imagePath)) setImageLocal(imagePath)
    } catch {}
    setLoaded(true)
  }, [])

  // 配置变更时持久化并通知小组件
  useEffect(() => {
    if (!loaded) return
    try {
      const root = getAppRoot()
      if (!(await fileExists(root))) {
        FileManager.createDirectorySync(root, true)
      }
      FileManager.writeAsStringSync(
        prefPath,
        JSON.stringify({ sku, name, cookie, slots: slotsText }),
      )
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
          <HStack spacing={8}>
            <Button title="刷新价格" action={() => refresh()} />
            <Button
              title={isForceRefreshing ? '强制刷新中…' : '强制刷新价格'}
              action={() => {
                setIsForceRefreshing(true)
                refresh(true).finally(() => setIsForceRefreshing(false))
              }}
            />
          </HStack>
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
              try {
                if (await fileExists(historyPath)) {
                  FileManager.removeItemSync(historyPath)
                }
                if (await fileExists(cachePath)) {
                  FileManager.removeItemSync(cachePath)
                }
              } catch (e) {}
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
