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
const avatarPath = Path.join(root, 'avatar.jpg')

const BOXJS_URLS = [
  'http://boxjs.com/query/data/jd_cookie',
  'http://boxjs.com/query/data/@JD.cookie',
]

// 更新时间点是用户在 App 里填的（默认 9:00、15:00、21:00），
// 存在共享域 'jd_refresh_slots'，两个京东小组件共用。
// 更新窗口 = 第一个点到最后一个点之后 1 小时（默认 9-22 点）。
function nextSlot(now: Date, slots: number[]): Date {
  for (const h of slots) {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    if (d.getTime() > now.getTime()) return d
  }
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(slots[0], 0, 0, 0)
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
  // 明细返回非 JSON 时，服务器到底回了什么（状态码 + 正文前 80 字）。
  detailDebug: string
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
  // 明细先走京东 App 自己的接口：
  //   POST https://api.m.jd.com/client.action?functionId=getJingBeanBalanceDetail
  //   body: body=<URL编码的 {"pageSize":"20","page":"N"}>&appid=ld
  //   回来是 detailList[]，每条有 date 和 amount。
  // 原来那个 bean.m.jd.com 的 H5 接口现在直接回 403
  // “file-no.2 conf not found”——不是 Cookie 的问题，是京东那边
  // 这个接口的配置找不到了（或不给走了），所以先走 App 接口，
  // App 接口不行再试 H5 接口；第一次哪边通了，后面就固定走哪边。
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
  const apiHeaders: any = {
    Host: 'api.m.jd.com',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent':
      'jdapp;iPhone;9.4.4;14.3;network/4g;Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148;supportJDSHWK/1',
    Cookie: cookie,
  }
  // 明细接口返回的 date 可能是 "2026-11-22 10:00:00"，也可能是
  // ISO 串，都先归一成 YYYY-MM-DD 再比对。
  function toDayStr(v: any): string {
    const s = String(v || '')
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    const d = new Date(s)
    return isNaN(d.getTime()) ? '' : fmtDate(d)
  }
  // 拉一页明细。source '' = 先试 App 接口，不行再试 H5 接口；
  // 'api' / 'bean' = 只走一边。返回 { list, source, error, debug }，
  // source 是这页实际走通的那边。
  async function fetchDetailPage(
    page: number,
    source: string,
  ): Promise<{ list: any[] | null; source: string; error: string; debug: string }> {
    if (source !== 'bean') {
      try {
        const res = await fetchWithTimeout(
          'https://api.m.jd.com/client.action?functionId=getJingBeanBalanceDetail',
          {
            method: 'POST',
            headers: apiHeaders,
            body: `body=${encodeURIComponent(JSON.stringify({ pageSize: '20', page: String(page) }))}&appid=ld`,
          },
          8000,
        )
        const text = await res.text()
        let j: any = null
        try {
          j = text && text.trim() ? JSON.parse(text) : null
        } catch (e) {
          return { list: null, source: '', error: '非JSON', debug: `App接口 HTTP${res.status}` }
        }
        if (j && Array.isArray(j.detailList)) return { list: j.detailList, source: 'api', error: '', debug: '' }
        return {
          list: null,
          source: '',
          error: j && j.code != null ? `code=${j.code}` : '无明细',
          debug: `App接口 HTTP${res.status}`,
        }
      } catch (e) {
        // App 接口请求本身挂了（超时/断网），往下试 H5 接口
      }
      if (source === 'api') return { list: null, source: '', error: '请求失败', debug: '' }
    }
    try {
      const res = await fetchWithTimeout(
        'https://bean.m.jd.com/beanDetail/detail.json',
        { method: 'POST', headers: detailHeaders, body: `page=${page}` },
        8000,
      )
      const status = res.status
      const text = await res.text()
      let j: any = null
      try {
        j = text && text.trim() ? JSON.parse(text) : null
      } catch (e) {
        const snippet = (text || '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80)
        return { list: null, source: '', error: '非JSON', debug: `H5接口 HTTP${status} ${snippet || '（空内容）'}` }
      }
      if (j && j.code === '0' && Array.isArray(j.jingDetailList))
        return { list: j.jingDetailList, source: 'bean', error: '', debug: '' }
      return {
        list: null,
        source: '',
        error: j && j.code != null ? `code=${j.code}` : '无返回',
        debug: `H5接口 HTTP${status}`,
      }
    } catch (e) {
      return { list: null, source: '', error: '请求失败', debug: '' }
    }
  }
  let page = 1
  let stop = false
  let detailError = ''
  let detailDebug = ''
  let detailSource = ''
  while (!stop && page <= 8) {
    const r = await fetchDetailPage(page, detailSource)
    if (!r.list) {
      if (!detailError) detailError = r.error
      if (!detailDebug) detailDebug = r.debug
      break
    }
    if (!detailSource) detailSource = r.source
    if (r.list.length === 0) {
      if (page === 1 && !detailError) detailError = '第1页0条'
      break
    }
    for (const item of r.list) {
      const dateStr = toDayStr(item.date)
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
  return { total, nickname, avatarUrl, days, detailError, detailDebug }
}

function App() {
  const [cookie, setCookie] = useState<string>('')
  const [slotsText, setSlotsText] = useState<string>('9,15,21')
  const [loaded, setLoaded] = useState(false)
  const [total, setTotal] = useState<string>('')
  const [nickname, setNickname] = useState<string>('')
  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [avatarLocal, setAvatarLocal] = useState<string>('')
  const [days, setDays] = useState<DayBean[]>([])
  const [status, setStatus] = useState<string>('打开 App 后自动拉取…')

  // auto=true 是打开 App 时自动拉，manual（点“刷新京豆”）永远拉。
  // 自动拉只在更新窗口内、且上次拉取在当前这个更新点之前才拉。
  // 不能用“6 小时内已拉过”来判断——手动点一次刷新，
  // updatedTs 就刷成现在，小组件到下一个更新点一看“才过 4 小时”
  // 就直接跳过，自动更新就永远不跑（价格那个 2026-11-22 15:00
  // 就是这么错过的，这里是同一个问题，一起改掉）。
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
        if (ts && ts >= currentSlot(now0, slots).getTime()) {
          setStatus(`这个更新点已经拉过，下次：${fmtSlot(nextSlot(now0, slots))}`)
          return
        }
      } catch (e) {}
    }
    setStatus('正在拉取…')
    try {
      // Cookie 优先用 BoxJs 里 Loon 新抓的，再用 App 里填过的。
      // 之前是反过来的：App 里一旦填过（或存过）旧 Cookie，
      // refresh 就一直用旧的，BoxJs 根本轮不到——
      // 所以 Loon 明明新抓到了（弹了通知），App 还在用旧 Cookie，
      // 明细一直「非JSON」。新抓到的就换上，并同步回输入框和共享区，
      // 小组件下次也跟着用新的。
      let ck = ''
      let cookieSource = '输入框'
      for (const url of BOXJS_URLS) {
        const v = await getBoxJsCookie(url)
        if (v) {
          ck = v
          cookieSource = 'BoxJs'
          break
        }
      }
      if (ck && ck !== cookie) {
        setCookie(ck)
      } else if (!ck) {
        ck = cookie
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
        detailDebug: bean.detailDebug,
      }
      if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
      FileManager.writeAsStringSync(cachePath, JSON.stringify(data))
      Storage.set('jdbean_cache', data, { shared: true })
      if (ck) Storage.set('jd_cookie', ck, { shared: true })
      setStatus(
        `已更新：${fmtTime(new Date())}，下次：${fmtSlot(nextSlot(new Date(), slots))}` +
          (bean.detailError ? `；明细：${bean.detailError}` : '') +
          (bean.detailDebug ? `（${bean.detailDebug}）` : '') +
          `；Cookie来源：${cookieSource}`,
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
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ cookie, slots: slotsText }))
    try {
      if (cookie) Storage.set('jd_cookie', cookie, { shared: true })
      Storage.set('jd_refresh_slots', slotsText, { shared: true })
    } catch (e) {}
    Widget.reloadAll()
  }, [cookie, slotsText, loaded])

  // 设置加载完后自动拉一次（按更新点那个规则）
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
            和京东价格那个小组件共用同一个 Cookie，填过一次就不用再填；也可以用 Loon 抓（Jd.lpx），Cookie 会自动写进 BoxJs。每次刷新优先用 BoxJs 里 Loon 新抓的，App 里填的只当备用。Cookie 只存在手机本地，不会上传云端，也不要提交到 GitHub。
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
            当前生效：{slotsLabel(parseSlots(slotsText))}。和价格那个小组件共用同一份设置，在这边改了，那边也跟着变。
          </Text>
          <Button title="恢复默认（9,15,21）" action={() => setSlotsText('9,15,21')} />
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text foregroundStyle="secondaryLabel">
            参考脑瓜（anker1209）京东合一 v2 的京豆统计：总数来自京东用户信息接口，今日 / 昨日和 7 天走势来自京豆收支明细接口，按天汇总收入和支出。小组件到更新点（{slotsLabel(parseSlots(slotsText))}）会自己拉一次新数据，拉不到就显示旧数据，不会转圈。打开 App
            时也按更新点这个规则自动拉；点“刷新京豆”随时都能手动拉。
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
