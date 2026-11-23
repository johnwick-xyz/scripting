import {
  Capsule,
  Circle,
  Color,
  EnvironmentValuesReader,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
  fetch,
  modifiers,
} from 'scripting'
import { rpt } from './utils'

// 中国电信 Scripting 小组件，样式照联通那个列表式做的
// 数据接口（电信营业厅 App 自身调的 e.dlife.cn，参考 anker 的
// ChinaTelecom_2024.js v2.3.1 的取数逻辑）：
//   GET https://e.dlife.cn/user/package_detail.do   Header: Cookie
//     返回 voiceAmount / voiceBalance（通话总量 / 剩余，分钟），
//     items[] 里 offerType != 19 的子项：unitTypeId==3 是流量，
//     unitTypeId==1 是通话；ratableAmount 总量、balanceAmount 剩余、
//     usageAmount 已用，单位都是 KB；balanceAmount 为
//     '999999999999' 是不限量标记，不计入总量。
//   GET https://e.dlife.cn/user/balance.do   Header: Cookie
//     返回 totalBalanceAvailable，单位是分，除以 100 是元。
// 总量接口直接给了剩余和总量，百分比 = 剩余 / 总量 x 100，
// 不用手动填套餐总量，也不会像联通那样缺 persent 默认 100%。
// Cookie 在 App 里填（index.tsx），或 Loon 抓后由 BoxJs 提供。

const DETAIL_URL = 'https://e.dlife.cn/user/package_detail.do'
const BALANCE_URL = 'https://e.dlife.cn/user/balance.do'
// Loon 抓 Cookie 写的两个 key，都查
const BOXJS_URLS = [
  'http://boxjs.com/query/data/@ChinaTelecom.10000.cookie',
  'http://boxjs.com/query/data/telecom_cookie',
]

async function getBoxJsCookie(url: string): Promise<string> {
  try {
    const res = await fetch(url).then((r) => r.json())
    const v = res && (res.val || res.data || res.value)
    if (typeof v === 'string' && v.trim()) return cleanCookie(v)
    if (typeof res === 'string' && res.trim()) return cleanCookie(res)
  } catch (e) {}
  return ''
}

interface WidgetData {
  fee: { number: string; unit: string; title: string }
  flow: { number: string; unit: string; title: string; remainPct: number | null }
  voice: { number: string; unit: string; title: string; remainPct: number | null }
  usedFlow: string | null
  updatedAt: string
  fromCache: boolean
  error: string
}

function cleanCookie(str: string) {
  return String(str || '')
    .split(';')
    .map((s) =>
      s.trim().replace(/(^Domain\s*?=\s*?.+?$|^Path\s*?=\s*?.+?\s*?(,\s*|$))/gi, ''),
    )
    .filter(Boolean)
    .join('; ')
}

// KB 换算：KB / 1024 = MB，小于 1024MB 显示 MB，否则显示 GB
function formatFlowKb(kb: number): { amount: string; unit: string } {
  const mb = kb / 1024
  if (mb < 1024) return { amount: mb.toFixed(2), unit: 'MB' }
  return { amount: (mb / 1024).toFixed(2), unit: 'GB' }
}

function ProgressGauge({
  title,
  value,
  icon,
  color,
  progress,
  s = 36,
}: {
  title: string
  value: string | number
  icon: string
  color: { r: number; g: number; b: number }
  progress: number
  s?: number
}) {
  const trimTo = 0.15 + 0.7 * Math.max(0, Math.min(1, progress))
  const iconColor: Color = `rgba(${color.r},${color.g},${color.b},1)`
  const colorStart: Color = `rgba(${color.r},${color.g},${color.b},0.4)`
  const bgColor: Color = `rgba(${color.r},${color.g},${color.b},0.1)`
  const bgStart: Color = `rgba(${color.r},${color.g},${color.b},0.2)`
  return (
    <EnvironmentValuesReader keys={['widgetRenderingMode']}>
      {({ widgetRenderingMode }) => (
        <ZStack>
          <Circle
            frame={{ width: rpt(s), height: rpt(s) }}
            trim={{ from: 0.15, to: 0.85 }}
            rotationEffect={90}
            stroke={{
              shapeStyle: bgColor,
              strokeStyle: { lineWidth: rpt(s * 0.1), lineCap: 'round' },
            }}
          />
          <Circle
            frame={{ width: rpt(s), height: rpt(s) }}
            trim={{ from: 0.15, to: trimTo }}
            rotationEffect={90}
            stroke={{
              shapeStyle: {
                colors: [colorStart, iconColor],
                startPoint: 'leading',
                endPoint: 'trailing',
              },
              strokeStyle: { lineWidth: rpt(s * 0.1), lineCap: 'round' },
            }}
          />
          <VStack
            frame={{ width: rpt(s * 0.95), height: rpt(s * 0.95) }}
            spacing={0}
            background={{
              shape: 'circle',
              style: {
                colors: [bgStart, 'clear'],
                startPoint: 'top',
                endPoint: 'bottom',
              },
            }}
          >
            <Spacer />
            <Text font={rpt(s * 0.22)} foregroundStyle="secondaryLabel" fontWeight="medium">
              {title}
            </Text>
            <Text
              font={rpt(s * 0.28)}
              fontDesign="rounded"
              fontWeight="bold"
              foregroundStyle="label"
              lineLimit={1}
              minScaleFactor={0.5}
            >
              {value}
            </Text>
            <Image
              systemName={icon}
              padding={rpt(2)}
              background={{
                shape: 'circle',
                style:
                  widgetRenderingMode === 'accented' ? 'rgba(0,0,0,0.5)' : iconColor,
              }}
              foregroundStyle="white"
              font={rpt(s * 0.24)}
            />
          </VStack>
        </ZStack>
      )}
    </EnvironmentValuesReader>
  )
}

// 列表式（和联通版一样）：
//   顶行：蓝色“电”+ 中国电信 + 绿点，右上角刷新图标（装饰，不可点）
//   话费余额：大号蓝色数字 + 元
//   剩余流量 / 剩余通话：左边标签、右边数值，下面一条绿色进度条，右端是百分比
//   底行：已用流量 + 更新时间（电信这个接口不给积分，所以底行没有积分）
function BarRow({
  label,
  value,
  pct,
  barW,
  compact,
}: {
  label: string
  value: string
  pct: number | null
  barW: number
  compact?: boolean
}) {
  const p = pct != null ? Math.max(0, Math.min(100, pct)) : 0
  const pctW = compact ? 32 : 38
  const barWidth = Math.max(40, barW - pctW - 8)
  const labelFont = compact ? 11 : 13
  const pctFont = compact ? 10 : 12
  const barH = compact ? 5 : 7
  return (
    <VStack spacing={compact ? 2 : 4}>
      <HStack>
        <Text font={labelFont} foregroundStyle="secondaryLabel">
          {label}
        </Text>
        <Spacer />
        <Text font={labelFont} fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          {value}
        </Text>
      </HStack>
      <HStack spacing={8}>
        <ZStack alignment="leading">
          <Capsule frame={{ width: barWidth, height: barH }} fill="rgba(0,0,0,0.08)" />
          {pct != null && (
            <Capsule
              frame={{ width: Math.max(barH, (barWidth * p) / 100), height: barH }}
              fill="rgba(34,197,94,1)"
            />
          )}
        </ZStack>
        <Text
          font={pctFont}
          foregroundStyle="secondaryLabel"
          lineLimit={1}
          frame={{ width: pctW }}
        >
          {pct != null ? `${Math.round(p)}%` : '—'}
        </Text>
      </HStack>
    </VStack>
  )
}

function Header({ compact }: { compact?: boolean }) {
  return (
    <HStack spacing={8}>
      <Text
        font={compact ? 11 : 14}
        fontWeight="bold"
        foregroundStyle="white"
        padding={compact ? 3 : 6}
        background={{ shape: 'circle', style: 'rgba(12,84,217,1)' }}
      >
        电
      </Text>
      <Text font={compact ? 12 : 16} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
        中国电信
      </Text>
      <Text font={10} foregroundStyle="rgba(34,197,94,1)">
        ●
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

function Balance({
  fee,
  big,
  compact,
}: {
  fee: { number: string; unit: string }
  big: number
  compact?: boolean
}) {
  return (
    <VStack spacing={2} alignment="leading">
      <Text font={compact ? 11 : 13} foregroundStyle="secondaryLabel">
        话费余额
      </Text>
      <HStack spacing={4}>
        <Text font={big} fontWeight="bold" foregroundStyle="rgba(12,84,217,1)" lineLimit={1} minScaleFactor={0.5}>
          {fee.number}
        </Text>
        <Text font={compact ? 12 : 14} foregroundStyle="secondaryLabel">
          {fee.unit || '元'}
        </Text>
      </HStack>
    </VStack>
  )
}

function Footer({
  usedFlow,
  updatedAt,
  compact,
}: {
  usedFlow: string | null
  updatedAt: string
  compact?: boolean
}) {
  const f = compact ? 11 : 13
  const n = compact ? 12 : 14
  return (
    <HStack spacing={4}>
      <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1}>
        {compact ? '已用' : '已用流量'}
      </Text>
      <Text font={n} fontWeight="bold" foregroundStyle="label" lineLimit={1} minScaleFactor={0.5}>
        {usedFlow || '—'}
      </Text>
      <Spacer />
      <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1}>
        {updatedAt} 更新
      </Text>
    </HStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const { fee, flow, voice } = data
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isMedium = family.includes('Medium') || family === 'medium'
  const isSmall = family.includes('Small') || family === 'small'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')
  // 锁屏圆形（72x72）：只显示剩余流量百分比一个环。
  // rpt 是按最短边 155pt 换算的，直接传 s=36 在 72pt 盒子
  // 里只有约 17pt 大；要占满盒子（直径约 60pt）得传 s=128。
  if (isCircular) {
    const pct = flow.remainPct != null ? Math.round(flow.remainPct) : 0
    return (
      <ProgressGauge
        title="流量"
        value={`${pct}%`}
        icon="antenna.radiowaves.left.and.right"
        color={{ r: 12, g: 84, b: 217 }}
        progress={flow.remainPct != null ? flow.remainPct / 100 : 0}
        s={128}
      />
    )
  }
  // 锁屏矩形（157x72）：只显示话费和流量两行字，固定字号 13/12，
  // 不能用 rpt，rpt(12) 在 72pt 高的盒子里只有约 5.6pt。
  if (isRectangular) {
    return (
      <VStack
        padding={8}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={4}
      >
        <Text font={13} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
          {fee.title} {fee.number}
          {fee.unit}
        </Text>
        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>
          {flow.title} {flow.number}
          {flow.unit}
        </Text>
      </VStack>
    )
  }
  const flowBar = (
    <BarRow
      label="剩余流量"
      value={`${flow.number}${flow.unit}`}
      pct={flow.remainPct}
      barW={W - 36}
    />
  )
  const voiceBar = (
    <BarRow
      label="剩余通话"
      value={`${voice.number}${voice.unit}`}
      pct={voice.remainPct}
      barW={W - 36}
    />
  )
  // 大号：每段之间各一个 Spacer，空余平均分开；字号 / 条高放大
  const body = (
    <VStack
      padding={20}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
      spacing={8}
      alignment="leading"
    >
      <Header />
      <Spacer />
      <Balance fee={fee} big={44} />
      <Spacer />
      {flowBar}
      <Spacer />
      {voiceBar}
      <Spacer />
      <Footer usedFlow={data.usedFlow} updatedAt={data.updatedAt} />
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：高都只有 155pt，
  // 竖排列表，字号和间距收紧：头 11pt、余额 18pt、条高 5pt、
  // 边距左右 12、上下 8、间距 2，底行短标签。
  // 跟联通、京东一样：四周留白加大，文字不再贴着卡片边。
  // 顺序和大号完全一致：头、话费、流量条、通话条、底行。
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    return (
      <VStack
        padding={{ horizontal: 12, vertical: 8 }}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={2}
        alignment="leading"
      >
        <Header compact />
        <Balance fee={fee} big={18} compact />
        <BarRow
          label="剩余流量"
          value={`${flow.number}${flow.unit}`}
          pct={flow.remainPct}
          barW={W - 24}
          compact
        />
        <BarRow
          label="剩余通话"
          value={`${voice.number}${voice.unit}`}
          pct={voice.remainPct}
          barW={W - 24}
          compact
        />
        <Spacer />
        <Footer usedFlow={data.usedFlow} updatedAt={data.updatedAt} compact />
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
        中国电信
      </Text>
      <Text font={rpt(12)} foregroundStyle="secondaryLabel">
        {message}
      </Text>
    </VStack>
  )
}

async function getCookie(): Promise<string> {
  // 1. App 里填的 Cookie（preference.json）
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      if (pref.cookie) return cleanCookie(pref.cookie)
    }
  } catch (e) {}
  // 2. BoxJs（Loon 抓到的 Cookie）
  for (const url of BOXJS_URLS) {
    const v = await getBoxJsCookie(url)
    if (v) return v
  }
  return ''
}

async function fetchData(cookie: string): Promise<WidgetData> {
  const updatedAt = (() => {
    const d = new Date()
    const p = (n: number) => (n < 10 ? '0' + n : '' + n)
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  })()
  const out: WidgetData = {
    fee: { number: '0', unit: '元', title: '话费剩余' },
    flow: { number: '—', unit: '', title: '剩余流量', remainPct: null },
    voice: { number: '—', unit: '分钟', title: '语音剩余', remainPct: null },
    usedFlow: null,
    updatedAt,
    fromCache: false,
    error: '',
  }

  // 套餐明细：流量、通话
  const detail: any = await fetch(DETAIL_URL, {
    method: 'GET',
    headers: { Cookie: cookie },
  }).then((r) => r.json())
  if (!detail || typeof detail !== 'object') {
    throw new Error('套餐接口没返回数据，Cookie 可能过期，重新抓一次')
  }
  let totalFlowKb = 0
  let balanceFlowKb = 0
  let usedFlowKb = 0
  let isUnlimitedFlow = false
  let totalVoice = 0
  let balanceVoice = 0
  const hasVoiceTop = detail.voiceAmount != null && detail.voiceBalance != null
  if (hasVoiceTop) {
    totalVoice = parseInt(detail.voiceAmount) || 0
    balanceVoice = parseInt(detail.voiceBalance) || 0
  }
  const groups: any[] = Array.isArray(detail.items) ? detail.items : []
  for (const group of groups) {
    if (group.offerType === 19) continue
    const subItems: any[] = Array.isArray(group.items) ? group.items : []
    for (const item of subItems) {
      if (item.unitTypeId == 3) {
        let ratable = parseFloat(item.ratableAmount) || 0
        let balance = parseFloat(item.balanceAmount) || 0
        const usage = parseFloat(item.usageAmount) || 0
        // 不限量标记：不计入总量和剩余
        if (String(item.balanceAmount) === '999999999999') {
          ratable = 0
          balance = 0
        }
        totalFlowKb += ratable
        balanceFlowKb += balance
        usedFlowKb += usage
        if (group.offerType == 21 && String(item.ratableAmount) === '0') {
          isUnlimitedFlow = true
        }
      } else if (!hasVoiceTop && item.unitTypeId == 1) {
        totalVoice += parseInt(item.ratableAmount) || 0
        balanceVoice += parseInt(item.balanceAmount) || 0
      }
    }
  }
  if (isUnlimitedFlow) {
    const used = formatFlowKb(usedFlowKb)
    out.flow = { number: used.amount, unit: used.unit, title: '已用流量', remainPct: null }
  } else if (totalFlowKb > 0) {
    const remain = formatFlowKb(balanceFlowKb)
    out.flow = {
      number: remain.amount,
      unit: remain.unit,
      title: '剩余流量',
      remainPct: Math.max(0, Math.min(100, (balanceFlowKb / totalFlowKb) * 100)),
    }
  }
  if (totalVoice > 0) {
    out.voice = {
      number: String(balanceVoice),
      unit: '分钟',
      title: '语音剩余',
      remainPct: Math.max(0, Math.min(100, (balanceVoice / totalVoice) * 100)),
    }
  }
  if (usedFlowKb > 0) {
    const used = formatFlowKb(usedFlowKb)
    out.usedFlow = `${used.amount}${used.unit}`
  }

  // 话费余额：totalBalanceAvailable 单位是分
  try {
    const bal: any = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { Cookie: cookie },
    }).then((r) => r.json())
    if (bal && bal.totalBalanceAvailable != null) {
      out.fee = {
        number: (Number(bal.totalBalanceAvailable) / 100).toFixed(2),
        unit: '元',
        title: '话费剩余',
      }
    }
  } catch (e) {}
  return out
}

;(async () => {
  try {
    const cookie = await getCookie()
    if (!cookie) {
      Widget.present(
        <ErrorView message="还没拿到 Cookie。先在 App 里填 Cookie，或用 Loon 抓一次中国电信 App 的 Cookie。" />,
      )
      return
    }
    const data = await fetchData(cookie)
    // 存一份缓存，拉取失败时下次还能显示
    try {
      const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
      if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
      FileManager.writeAsStringSync(Path.join(root, 'cache.json'), JSON.stringify(data))
    } catch (e) {}
    Widget.present(<WidgetView data={data} />)
  } catch (e) {
    // 失败时读缓存
    try {
      const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
      const cachePath = Path.join(root, 'cache.json')
      if (FileManager.existsSync(cachePath)) {
        const cached = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
        cached.fromCache = true
        cached.error = String(e)
        Widget.present(<WidgetView data={cached} />)
        return
      }
    } catch (e2) {}
    Widget.present(<ErrorView message={'拉取失败：' + String(e)} />)
  }
})()
