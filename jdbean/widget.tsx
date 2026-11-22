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
import { rpt } from './utils'

// 京东京豆 Scripting 小组件
// 参考脑瓜（anker1209）的京东合一 v2（JD-in-one-v2.js v2.2.9）
// 里面的京豆统计及显示：
//   顶部：头像 + 昵称，右边是京豆总数（红色大字 + “京豆”）
//   中间：昨日 / 今日两栏，每栏是净收入大字，下面一行红色支出
//   下面：最近 6 天每日净收入柱状图（收入 - 支出）
//   缓存：京豆总数没变就用缓存的每日统计，变了才重新拉明细
//
// 接口（都是京东自己的，都是 anker 那个脚本用的）：
//   1) 京豆总数 + 用户信息：
//      GET https://me-api.jd.com/user_new/info/GetJDUserInfoUnion?isLogin=1
//      带 Cookie，返回 data.assetInfo.beanNum（京豆总数）、
//      data.userInfo.baseInfo.nickname、headImageUrl（头像）
//   2) 京豆收支明细：
//      POST https://bean.m.jd.com/beanDetail/detail.json，body page=N
//      带 Cookie，返回 code '0'，jingDetailList[] 每条有
//      date（"2026-11-22 10:00:00"）和 amount（正数=收入，负数=支出）
//      按天汇总：收入 = 正数之和，支出 = 负数之和，净收入 = 收入 + 支出
//      只汇总最近 7 天，翻页到日期超出范围或没数据就停，最多 8 页。
// Cookie 和京东价格那个小组件共用同一个（Storage 'jd_cookie'、
// preference.json、BoxJs jd_cookie / @JD.cookie），
// 不用再抓一次，也不用再填一次。
// 取价和京东价格小组件一样：小组件自己拉，用系统原生超时
// AbortSignal.timeout()，不用 setTimeout（在小组件里靠不住，
// 之前就是它让预览一直打圈圈）；拉不到就显示缓存价，绝不转圈。

interface DayBean {
  date: string // YYYY-MM-DD
  income: number
  expense: number // 负数
}

interface BeanData {
  total: number
  nickname: string
  avatarUrl: string
  avatarPath?: string
  days: DayBean[]
  updatedAt: string
  updatedTs?: number
  fromCache: boolean
  error: string
  // 明细那一步为什么没拿到数（'' = 拿到了）：
  // '请求失败' = 这一页请求本身抛错，'非JSON' = 返回的不是 JSON
  // （Cookie 对 bean.m.jd.com 不生效时常是 302 的 HTML），
  // 'code=X' = 接口返回了非 0 的 code，'第1页0条' = 第 1 页就是空的。
  // 之前这里是空着悄悄吞掉的，总数能显示、今日却是 0，
  // 根本看不出是哪一步出的错，现在把它记下来、显示出来。
  detailError?: string
}

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

function shortDate(dateStr: string): string {
  const p = dateStr.split('-')
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : dateStr
}

function fmtTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayStr(): string {
  return fmtDate(new Date())
}

function yesterdayStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

function dayOf(data: BeanData, dateStr: string): DayBean | null {
  for (const d of data.days || []) {
    if (d.date === dateStr) return d
  }
  return null
}

// ---- 取数（小组件里，用原生超时，绝不靠 setTimeout） ----

async function fetchWithTimeout(url: string, options: any, ms: number): Promise<any> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) })
}

async function getCookie(): Promise<string> {
  try {
    const v: any = Storage.get('jd_cookie', { shared: true })
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.cookie) return String(pref.cookie)
    }
  } catch (e) {}
  for (const url of [
    'http://boxjs.com/query/data/jd_cookie',
    'http://boxjs.com/query/data/@JD.cookie',
  ]) {
    try {
      // 先读文本再解析：BoxJs 里没有这个 key、或 BoxJs 没起来时，
      // 返回的可能不是 JSON（比如 "file not found" 之类的纯文本），
      // 直接 res.json() 会抛 SyntaxError: Unexpected identifier "file"，
      // 整个刷新就崩了。不是 JSON 就当这个 key 没有，继续找下一个。
      const res = await fetchWithTimeout(url, { method: 'GET' }, 3000)
      const text = await res.text()
      if (!text || !text.trim()) continue
      let j: any
      try {
        j = JSON.parse(text)
      } catch (e) {
        continue
      }
      const v = j && (j.val || j.data || j.value)
      if (typeof v === 'string' && v.trim()) return v.trim()
      if (typeof j === 'string' && j.trim()) return j.trim()
    } catch (e) {}
  }
  return ''
}

async function fetchBean(cookie: string): Promise<BeanData> {
  const headers: any = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Cookie: cookie,
  }
  // 1) 京豆总数 + 昵称 + 头像
  const infoRes = await fetchWithTimeout(
    'https://me-api.jd.com/user_new/info/GetJDUserInfoUnion?isLogin=1',
    { method: 'GET', headers },
    8000,
  )
  const infoText = await infoRes.text()
  let info: any
  try {
    info = JSON.parse(infoText)
  } catch (e) {
    throw new Error(
      '用户信息接口返回的不是 JSON：' + (infoText || '').slice(0, 80),
    )
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

  // 2) 收支明细，按天汇总最近 7 天
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
        {
          method: 'POST',
          headers: detailHeaders,
          body: `page=${page}`,
        },
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
    // 直接 res.json() 会抛 SyntaxError，整个拉取就崩了。
    // 这里先读文本、解析失败就记下原因、停止翻页，
    // 京豆总数已经拿到手了，照样能显示，只是当天收支是空的。
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
      const day = dayOf({ days } as BeanData, dateStr)
      if (!day) continue
      const amount = Number(item.amount) || 0
      if (amount > 0) day.income += amount
      else day.expense += amount
    }
    page++
  }
  const now = new Date()
  return {
    total,
    nickname,
    avatarUrl,
    days,
    updatedAt: fmtTime(now),
    updatedTs: now.getTime(),
    fromCache: false,
    error: '',
    detailError,
  }
}

// ---- 读 / 写缓存 ----

function readCached(): BeanData | null {
  try {
    const v: any = Storage.get('jdbean_cache', { shared: true })
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

function saveCache(data: BeanData) {
  try {
    Storage.set('jdbean_cache', data, { shared: true })
  } catch (e) {}
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
    FileManager.writeAsStringSync(Path.join(root, 'cache.json'), JSON.stringify(data))
  } catch (e) {}
}

// ---- 视图 ----

function Header({ data, compact }: { data: BeanData; compact?: boolean }) {
  const avatar = data.avatarPath ? (
    <Image filePath={data.avatarPath} resizable frame={{ width: 30, height: 30 }} />
  ) : data.avatarUrl ? (
    <Image imageUrl={data.avatarUrl} resizable frame={{ width: 30, height: 30 }} />
  ) : (
    <Text
      font={compact ? 11 : 14}
      fontWeight="bold"
      foregroundStyle="white"
      padding={compact ? 3 : 6}
      background={{ shape: 'circle', style: 'rgba(225,37,27,1)' }}
    >
      京
    </Text>
  )
  return (
    <HStack spacing={compact ? 6 : 8}>
      {avatar}
      <Text font={compact ? 12 : 16} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
        {data.nickname || '京东京豆'}
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

// 脑瓜那版的一栏：上面是“今日/昨日”小标签，
// 中间是净收入大字（收入 + 支出），
// 有支出时下面一行红色支出数。
function DayCell({
  label,
  day,
  compact,
}: {
  label: string
  day: DayBean | null
  compact?: boolean
}) {
  const net = day ? day.income + day.expense : 0
  const netText = net > 0 ? `+${net}` : `${net}`
  return (
    <VStack spacing={compact ? 1 : 2} alignment="leading">
      <Text font={compact ? 10 : 12} foregroundStyle="secondaryLabel">
        {label}
      </Text>
      <Text
        font={compact ? 18 : 22}
        fontWeight="bold"
        foregroundStyle={net >= 0 ? 'label' : 'rgba(225,37,27,1)'}
        lineLimit={1}
        minScaleFactor={0.6}
      >
        {netText}
      </Text>
      <Text font={compact ? 10 : 12} foregroundStyle="secondaryLabel" lineLimit={1}>
        收入 +{day ? day.income : 0}
      </Text>
      {day && day.expense < 0 ? (
        <Text font={compact ? 10 : 12} fontWeight="medium" foregroundStyle="rgba(250,45,25,1)" lineLimit={1}>
          支出 {day.expense}
        </Text>
      ) : null}
    </VStack>
  )
}

function TotalBlock({ data, compact }: { data: BeanData; compact?: boolean }) {
  return (
    <VStack spacing={2} alignment="leading">
      <Text font={compact ? 11 : 13} foregroundStyle="secondaryLabel">
        京豆总数
      </Text>
      <HStack spacing={4}>
        <Text
          font={compact ? 26 : 40}
          fontWeight="bold"
          foregroundStyle="rgba(225,37,27,1)"
          lineLimit={1}
          minScaleFactor={0.5}
        >
          {data.total}
        </Text>
        <Text font={compact ? 12 : 14} foregroundStyle="rgba(225,37,27,0.7)">
          京豆
        </Text>
      </HStack>
    </VStack>
  )
}

function Footer({ data, compact }: { data: BeanData; compact?: boolean }) {
  const f = compact ? 11 : 13
  return (
    <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1} minScaleFactor={0.7}>
      {data.fromCache ? '缓存 ' : ''}
      {data.updatedAt} 更新
      {data.detailError ? ` · 明细${data.detailError}` : ''}
    </Text>
  )
}

// 最近 7 天每日净收入柱状图（收入 - 支出），和京东价格
// 那个小组件的大号走势图同一个画法。
function WeekBars({ days }: { days: DayBean[] }) {
  const items = (days || []).slice(-7)
  if (items.length < 2) return <Text font={12} foregroundStyle="secondaryLabel">历史还不够，刷新几次后有 7 天走势图</Text>
  const nets = items.map((x) => x.income + x.expense)
  const max = Math.max(...nets, 1)
  const min = Math.min(...nets, 0)
  const span = max - min > 0 ? max - min : 1
  return (
    <VStack spacing={6} alignment="leading">
      <Text font={13} foregroundStyle="secondaryLabel">
        最近 7 天净收入
      </Text>
      <HStack spacing={8}>
        {items.map((x, i) => {
          const net = x.income + x.expense
          const h = 8 + ((net - min) / span) * 64
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
      <HStack spacing={4}>
        {items.map((x) => (
          <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1} frame={{ width: 30 }}>
            {shortDate(x.date)}
          </Text>
        ))}
      </HStack>
    </VStack>
  )
}

function WidgetView({ data }: { data: BeanData }) {
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isMedium = family.includes('Medium') || family === 'medium'
  const isSmall = family.includes('Small') || family === 'small'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')
  // 锁屏圆形（72x72）：只显示京豆总数，固定字号
  if (isCircular) {
    return (
      <VStack
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={0}
      >
        <Text font={9} foregroundStyle="secondaryLabel">
          京豆
        </Text>
        <Text font={18} fontWeight="bold" foregroundStyle="rgba(225,37,27,1)" lineLimit={1} minScaleFactor={0.5}>
          {data.total}
        </Text>
      </VStack>
    )
  }
  // 锁屏矩形（157x72）：昵称 + 京豆总数 + 今日净收入
  if (isRectangular) {
    const today = dayOf(data, todayStr())
    const net = today ? today.income + today.expense : 0
    return (
      <VStack
        padding={{ horizontal: 12, vertical: 8 }}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={4}
      >
        <Text font={13} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
          {data.nickname || '京东京豆'} {data.total} 京豆
        </Text>
        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>
          今日净收入 {net > 0 ? `+${net}` : `${net}`}
        </Text>
      </VStack>
    )
  }
  const today = dayOf(data, todayStr())
  const yesterday = dayOf(data, yesterdayStr())
  // 大号：每段之间各一个 Spacer，空余平均分开
  const body = (
    <VStack
      padding={20}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
      spacing={8}
      alignment="leading"
    >
      <Header data={data} />
      <Spacer />
      <TotalBlock data={data} />
      <Spacer />
      <HStack spacing={8}>
        <DayCell label="今日" day={today} />
        <Spacer />
        <DayCell label="昨日" day={yesterday} />
        <Spacer />
      </HStack>
      <Spacer />
      <WeekBars days={data.days} />
      <Spacer />
      <Footer data={data} />
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：竖排列表，
  // 外层留白左右 12、上下 8，和京东价格那个一样，
  // 文字不贴着卡片边。
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    return (
      <VStack
        padding={{ horizontal: 12, vertical: 8 }}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={2}
        alignment="leading"
      >
        <Header data={data} compact />
        <TotalBlock data={data} compact />
        <HStack spacing={8}>
          <DayCell label="今日" day={today} compact />
          <Spacer />
          <DayCell label="昨日" day={yesterday} compact />
          <Spacer />
        </HStack>
        <Spacer />
        <Footer data={data} compact />
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
        京东京豆
      </Text>
      <Text font={rpt(12)} foregroundStyle="secondaryLabel">
        {message}
      </Text>
    </VStack>
  )
}

// 主流程：先读缓存；到更新点（9-22 点、距上次超过 6 小时）
// 就自己拉一次新数据，拉到了更新缓存，拉不到就显示旧缓存，
// 绝不等、绝不转圈。最后告诉系统下一个更新点再跑一次。
;(async () => {
  const now = new Date()
  const cached = readCached()
  const needFetch =
    !cached ||
    cached.total == null ||
    (isUpdateWindow(now) &&
      (!cached.updatedTs || cached.updatedTs < currentSlot(now).getTime()))
  // 注意：不能用“距上次超过 6 小时”来判断——手动在 App 里点一次刷新，
  // updatedTs 就刷成现在，小组件到下一个更新点一看“才过 4 小时”
  // 就直接跳过，自动更新就永远不跑（价格那个 2026-11-22 15:00
  // 就是这么错过的，这里是同一个问题，一起改掉）。
  if (needFetch) {
    try {
      const cookie = await getCookie()
      if (!cookie) throw new Error('还没拿到 Cookie')
      const data = await fetchBean(cookie)
      if (cached && cached.avatarPath) data.avatarPath = cached.avatarPath
      saveCache(data)
      Widget.present(<WidgetView data={data} />, {
        policy: 'after',
        date: nextSlot(new Date()),
      } as any)
      return
    } catch (e) {
      // 拉失败了就显示旧缓存，不报错、不转圈
      if (cached && cached.total != null) {
        cached.fromCache = true
        Widget.present(<WidgetView data={cached} />, {
          policy: 'after',
          date: nextSlot(new Date()),
        } as any)
        return
      }
      Widget.present(
        <ErrorView message={'拉取失败：' + String(e) + '。打开一次 App 再试，Cookie 和京东价格那个小组件共用。'} />,
      )
      return
    }
  }
  if (cached && cached.total != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      policy: 'after',
      date: nextSlot(new Date()),
    } as any)
    return
  }
  Widget.present(
    <ErrorView message="还没数据。打开一次 App，它会自动拉京豆数据并刷新小组件。" />,
  )
})()
