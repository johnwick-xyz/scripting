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
  Widget,
  fetch,
  useEffect,
  useState,
} from 'scripting'

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const prefPath = Path.join(root, 'preference.json')
const cachePath = Path.join(root, 'cache.json')
const avatarPath = Path.join(root, 'avatar.jpg')

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

// 当前这个更新点：9:00、15:00、21:00 里最近过去的那个。
function currentSlot(now: Date): Date {
  const slots = [9, 15, 21]
  let slot = -1
  for (const h of slots) {
    if (now.getHours() >= h) slot = h
  }
  const d = new Date(now)
  if (slot === -1) d.setDate(d.getDate() - 1)
  d.setHours(slot === -1 ? 21 : slot, 0, 0, 0)
  return d
}

function fmtDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function fetchWithTimeout(url: string, options: any, ms: number): Promise<any> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
}

async function fetchJsonWithTimeout(url: string, options: any, ms = 8000): Promise<any> {
  const res = await fetchWithTimeout(url, options, ms)
  // 先读文本再解析：BoxJs 里没有这个 key、或 BoxJs 没起来时，
  // 返回的可能不是 JSON（比如 "file not found" 之类的纯文本），
  // 直接 res.json() 会抛 SyntaxError: Unexpected identifier "file"。
  // 不是 JSON 就返回空，让调用方当成“没有这个 key”继续找下一个。
  const text = await res.text()
  if (!text || !text.trim()) return null
  try {
    return JSON.parse(text)
  } catch (e) {
    return null
  }
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

// 头像下载到本地文件，小组件里远程图经常加载失败，本地文件才稳。
async function downloadAvatar(url: string): Promise<string> {
  if (!url) return ''
  try {
    const res = await fetch(url, { method: 'GET' })
    const buf: ArrayBuffer = await res.arrayBuffer()
    if (!buf || buf.byteLength < 500) return ''
    FileManager.writeAsBytesSync(avatarPath, new Uint8Array(buf))
    return avatarPath
  } catch (e) {}
  return ''
}

interface DayBean {
  date: string
  income: number
  expense: number
}

async function fetchBean(cookie: string): Promise<{
  total: number
  nickname: string
  avatarUrl: string
  days: DayBean[]
  // 明细那一步为什么没拿到数（'' = 拿到了），见 widget.tsx 里
  // BeanData.detailError 的说明：之前是悄悄吞掉的，总数能显示、
  // 今日却是 0，根本看不出是哪一步出的错。
  detailError: string
}> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Cookie: cookie,
  }
  const infoRes = await fetchWithTimeout(
    'https://me-api.jd.com/user_new/info/GetJDUserInfoUnion?isLogin=1',
    { method: 'GET', headers },
    8000,
  )
  const infoText = await infoRes.text()
  let info: any
  try {
    info = infoText && infoText.trim() ? JSON.parse(infoText) : null
  } catch (e) {
    throw new Error('用户信息接口返回的不是 JSON：' + (infoText || '').slice(0, 80))
  }
  if (!info || info.retcode !== '0' || !info.data || !info.data.assetInfo) {
    throw new Error(
      '京豆总数拉取失败' +
        (info && info.msg ? '：' + info.msg : '') +
        '，Cookie 可能过期了。注意：京豆接口必须登录才能拉，和价格那个不一样，价格不用 Cookie 也能拉。',
    )
  }
  const total = Number(info.data.assetInfo.beanNum) || 0
  const nickname =
    (info.data.userInfo && info.data.userInfo.baseInfo && info.data.userInfo.baseInfo.nickname) ||
    ''
  let avatarUrl =
    (info.data.userInfo && info.data.userInfo.baseInfo && info.data.userInfo.baseInfo.headImageUrl) ||
    ''
  if (avatarUrl) avatarUrl = avatarUrl.replace(/big/, 'mid')

  const days: DayBean[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({ date: fmtDate(d), income: 0, expense: 0 })
  }
  const startDate = days[0].date
  const detailHeaders: any = {
    'X-Requested-With': 'XMLHttpRequest',
    Connection: 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: 'https://bean.m.jd.com',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15',
    Cookie: cookie,
    Host: 'bean.m.jd.com',
    Referer: 'https://bean.m.jd.com/beanDetail/index.action?resourceValue=bean',
    'Accept-Language': 'zh-cn',
    Accept: 'application/json, text/javascript, */*; q=0.01',
  }
  let page = 1
  let stop = false
  let detailError = ''
  while (!stop && page <= 8) {
    let text = ''
    try {
      const res = await fetchWithTimeout(
        'https://bean.m.jd.com/beanDetail/detail.json',
        { method: 'POST', headers: detailHeaders, body: `page=${page}` },
        8000,
      )
      text = await res.text()
    } catch (e) {
      // 明细这一步挂了也不能把总数也丢了：记下原因就停，
      // 总数照样显示。
      if (!detailError) detailError = '请求失败'
      break
    }
    // 明细接口 Cookie 失效时会返回 302 的 HTML 页面（不是 JSON），
    // 直接 res.json() 会抛 SyntaxError。这里先读文本、解析失败
    // 就记下原因、停止翻页，京豆总数已经拿到手了照样能显示。
    let j: any = null
    try {
      j = text && text.trim() ? JSON.parse(text) : null
    } catch (e) {
      if (!detailError) detailError = '非JSON'
      break
    }
    if (!j || j.code !== '0') {
      if (!detailError) detailError = j && j.code != null ? `code=${j.code}` : '无返回'
      break
    }
    const list = Array.isArray(j.jingDetailList) ? j.jingDetailList : []
    if (list.length === 0) {
      if (page === 1 && !detailError) detailError = '第1页0条'
      break
    }
    for (const item of list) {
      const dateStr = String(item.date || '').split(' ')[0]
      if (!dateStr || dateStr < startDate) {
        stop = true
        break
      }
      const day = days.find((x) => x.date === dateStr)
      if (!day) continue
      const amount = Number(item.amount) || 0
      if (amount > 0) day.income += amount
      else day.expense += amount
    }
    page++
  }
  return { total, nickname, avatarUrl, days, detailError }
}

function App() {
  const [cookie, setCookie] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [total, setTotal] = useState<string>('')
  const [nickname, setNickname] = useState<string>('')
  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [avatarLocal, setAvatarLocal] = useState<string>('')
  const [days, setDays] = useState<DayBean[]>([])
  const [status, setStatus] = useState<string>('打开 App 后自动拉取…')

  // auto=true 是打开 App 时自动拉，manual（点“刷新京豆”）永远拉。
  // 自动拉只在 9-22 点、且上次拉取在当前这个更新点（9:00/15:00/21:00）
  // 之前才拉。不能用“6 小时内已拉过”来判断——手动点一次刷新，
  // updatedTs 就刷成现在，小组件到下一个更新点一看“才过 4 小时”
  // 就直接跳过，自动更新就永远不跑（价格那个 2026-11-22 15:00
  // 就是这么错过的，这里是同一个问题，一起改掉）。
  async function refresh(auto = false) {
    const now0 = new Date()
    if (auto) {
      if (!isUpdateWindow(now0)) {
        setStatus(`不在更新时间（9-22点），下次：${fmtSlot(nextSlot(now0))}`)
        return
      }
      try {
        const cached: any = Storage.get('jdbean_cache', { shared: true })
        let ts = null
        try {
          ts = cached
            ? typeof cached === 'string'
              ? JSON.parse(cached).updatedTs
              : cached.updatedTs
            : null
        } catch (e) {
          ts = null
        }
        if (ts && ts >= currentSlot(now0).getTime()) {
          setStatus(`这个更新点已经拉过，下次：${fmtSlot(nextSlot(now0))}`)
          return
        }
      } catch (e) {}
    }
    setStatus('正在拉取…')
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
      if (!ck)
        throw new Error(
          '还没拿到 Cookie。京豆接口必须登录才能拉，和价格那个不一样（价格不用 Cookie 也能拉）。先在下面“京东 Cookie”里粘贴一次，或用 Loon 装 Jd.lpx 抓一次。',
        )
      const bean = await fetchBean(ck)
      let local = ''
      if (bean.avatarUrl) local = await downloadAvatar(bean.avatarUrl)
      if (!local && FileManager.existsSync(avatarPath)) local = avatarPath
      setTotal(String(bean.total))
      setNickname(bean.nickname)
      setAvatarUrl(bean.avatarUrl)
      setAvatarLocal(local)
      setDays(bean.days)
      const now = Date.now()
      const data = {
        total: bean.total,
        nickname: bean.nickname,
        avatarUrl: bean.avatarUrl,
        avatarPath: local,
        days: bean.days,
        updatedAt: fmtTime(new Date()),
        updatedTs: now,
        fromCache: false,
        error: '',
        detailError: bean.detailError,
      }
      if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
      FileManager.writeAsStringSync(cachePath, JSON.stringify(data))
      Storage.set('jdbean_cache', data, { shared: true })
      if (ck) Storage.set('jd_cookie', ck, { shared: true })
      setStatus(
        `已更新：${fmtTime(new Date())}，下次：${fmtSlot(nextSlot(new Date()))}` +
          (bean.detailError ? `；明细：${bean.detailError}` : ''),
      )
      Widget.reloadAll()
    } catch (e) {
      setStatus('拉取失败：' + String(e))
    }
  }

  useEffect(() => {
    try {
      const v: any = Storage.get('jd_cookie', { shared: true })
      if (typeof v === 'string' && v.trim()) setCookie(v.trim())
    } catch (e) {}
    if (FileManager.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.cookie) setCookie(pref.cookie)
      } catch (e) {
        console.error('Failed to parse preference', e)
      }
    }
    if (FileManager.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
        if (cached.total != null) setTotal(String(cached.total))
        if (cached.nickname) setNickname(cached.nickname)
        if (cached.avatarUrl) setAvatarUrl(cached.avatarUrl)
        if (cached.avatarPath) setAvatarLocal(cached.avatarPath)
        if (Array.isArray(cached.days)) setDays(cached.days)
        if (cached.updatedAt) setStatus(`上次更新：${cached.updatedAt}`)
      } catch (e) {}
    }
    if (FileManager.existsSync(avatarPath)) setAvatarLocal(avatarPath)
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (!FileManager.existsSync(root)) {
      FileManager.createDirectorySync(root, true)
    }
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ cookie }))
    try {
      if (cookie) Storage.set('jd_cookie', cookie, { shared: true })
    } catch (e) {}
    Widget.reloadAll()
  }, [cookie, loaded])

  // 设置加载完后自动拉一次（按 9-22 点、每 6 小时那个规则）
  useEffect(() => {
    if (!loaded) return
    refresh(true)
  }, [loaded])

  const today = days.length > 0 ? days[days.length - 1] : null
  const yesterday = days.length > 1 ? days[days.length - 2] : null

  return (
    <NavigationStack>
      <List navigationTitle="京东京豆">
        <Section header={<Text>京豆总数</Text>}>
          <HStack>
            {avatarLocal ? (
              <Image filePath={avatarLocal} resizable frame={{ width: 40, height: 40 }} />
            ) : avatarUrl ? (
              <Image imageUrl={avatarUrl} resizable frame={{ width: 40, height: 40 }} />
            ) : null}
            <Text>{nickname || '京东账号'}</Text>
            <Text fontWeight="bold">{total || '—'} 京豆</Text>
          </HStack>
          <Text foregroundStyle="secondaryLabel">{status}</Text>
          <Button title="刷新京豆" action={() => refresh()} />
        </Section>
        <Section header={<Text>今日 / 昨日</Text>}>
          <HStack>
            <Text>今日净收入</Text>
            <Text fontWeight="bold">
              {today ? `${today.income + today.expense > 0 ? '+' : ''}${today.income + today.expense}` : '—'}
            </Text>
            <Text foregroundStyle="secondaryLabel">
              {today ? `收入 +${today.income} / 支出 ${today.expense}` : ''}
            </Text>
          </HStack>
          <HStack>
            <Text>昨日净收入</Text>
            <Text fontWeight="bold">
              {yesterday
                ? `${yesterday.income + yesterday.expense > 0 ? '+' : ''}${yesterday.income + yesterday.expense}`
                : '—'}
            </Text>
            <Text foregroundStyle="secondaryLabel">
              {yesterday ? `收入 +${yesterday.income} / 支出 ${yesterday.expense}` : ''}
            </Text>
          </HStack>
        </Section>
        <Section header={<Text>最近 7 天</Text>}>
          {days.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">暂无数据，刷新一次就有</Text>
          ) : (
            days
              .slice()
              .reverse()
              .map((d) => (
                <HStack>
                  <Text>{d.date}</Text>
                  <Text fontWeight="bold">
                    {d.income + d.expense > 0 ? '+' : ''}
                    {d.income + d.expense}
                  </Text>
                  <Text foregroundStyle="secondaryLabel">
                    +{d.income} / {d.expense}
                  </Text>
                </HStack>
              ))
          )}
        </Section>
        <Section header={<Text>京东 Cookie</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴京东 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            和京东价格那个小组件共用同一个 Cookie，填过一次就不用再填；也可以用 Loon 抓（Jd.lpx），Cookie 会自动写进 BoxJs。Cookie 只存在手机本地，不会上传云端，也不要提交到 GitHub。
          </Text>
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text foregroundStyle="secondaryLabel">
            参考脑瓜（anker1209）京东合一 v2 的京豆统计：总数来自京东用户信息接口，今日 / 昨日和 7 天走势来自京豆收支明细接口，按天汇总收入和支出。小组件到更新点（9:00、15:00、21:00）会自己拉一次新数据，拉不到就显示旧数据，不会转圈。打开 App 时也按 9-22 点、每 6 小时这个规则自动拉；点“刷新京豆”随时都能手动拉。
          </Text>
        </Section>
        <Section>
          <Button
            title="清空京豆缓存"
            action={() => {
              try {
                Storage.remove('jdbean_cache', { shared: true })
              } catch (e) {}
              if (FileManager.existsSync(cachePath)) {
                FileManager.removeItemSync(cachePath)
              }
              setTotal('')
              setDays([])
              setStatus('缓存已清空，打开 App 会重新拉取')
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
