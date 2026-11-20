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

// 中国联通 Scripting 小组件（全国接口，不是湖北专属）
// 接口：联通手机营业厅 App 自身调的
//   GET https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven?version=iphone_c@8.0200&desmobiel=&showType=0
//   Header: Cookie
// 返回 code=Y，data.dataList 里 type=fee / flow / voice / point
// Cookie 在 App 里填（index.tsx），或 Loon 抓后由 BoxJs 提供，见 README
// 圆环写法参考 Honye 的湖北联通 widget.tsx

const API_URL =
  'https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven?version=iphone_c@8.0200&desmobiel=&showType=0'
const BOXJS_URL = 'https://boxjs.com/query/data/@ChinaUnicom.10010v4.cookie'
// john 实际用的是 githubdulong 的 ChinaUnicom_Multi.js（anker v2.6.16 多账户版），
// 它的 BoxJs key 是 '@YaYa_10010.cookie'（dompling 抓 Cookie 脚本的 APIKey），
// 走 http://boxjs.com/query/data/@YaYa_10010.cookie，
// 根本不是 @ChinaUnicom.10010v4.cookie，所以之前查不到。
// 三个 key 都查：YaYa 优先（john 现有的），再查 anker 的，再查 Loon 的 unicom_cookie。
const BOXJS_URLS = [
  'http://boxjs.com/query/data/@YaYa_10010.cookie',
  BOXJS_URL,
  'http://boxjs.com/query/data/@ChinaUnicom.10010v4.cookie',
  'http://boxjs.com/query/data/unicom_cookie',
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
  point: { number: string; title: string } | null
  flowUsedGb?: number | null
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

// 自适应：只按宽高比换排布，不按尺寸现算圆环。
// 上一版按 displaySize 现算圆环尺寸，结果圆环直接消失了
// （只剩小圆点和数字），所以圆环尺寸回到经过验证的 rpt 写法。
// 中号是矮宽的（宽 > 高 x 1.4），一排 4 个；其他尺寸 2x2。
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

// 样式改成 john 截图那种列表式（2026-11-20 16:46）：
//   顶行：联通 logo + 中国联通 + 绿点，右上角刷新图标
//   话费余额：大号红色数字 + 元
//   剩余流量 / 剩余通话：每行左边标签、右边数值，
//     下面一条绿色进度条，条的右端是百分比
//   底行：可用积分（橙色数字）+ 已用流量
// 进度条用 Capsule 画：灰底条 + 绿色前景条，宽度按
// Widget.displaySize 的宽现算（纯数字，不是 JSX 数组，
// 之前圆环消失是 JSX 数组的问题，不是现算宽度的问题）。
// 已用流量 = 剩余流量 x 已用% / 剩余%，从 remainPct 算。
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
  const labelFont = compact ? 12 : 13
  const pctFont = compact ? 11 : 12
  const barH = compact ? 6 : 7
  return (
    <VStack spacing={compact ? 3 : 4}>
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
        font={compact ? 12 : 14}
        fontWeight="bold"
        foregroundStyle="white"
        padding={compact ? 5 : 6}
        background={{ shape: 'circle', style: 'rgba(230,0,39,1)' }}
      >
        联
      </Text>
      <Text font={compact ? 14 : 16} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
        中国联通
      </Text>
      <Text font={10} foregroundStyle="rgba(34,197,94,1)">
        ●
      </Text>
      <Spacer />
      <Image
        systemName="arrow.clockwise"
        font={12}
        foregroundStyle="secondaryLabel"
        padding={6}
        background={{ shape: 'circle', style: 'rgba(0,0,0,0.06)' }}
      />
    </HStack>
  )
}

function Balance({ fee, big }: { fee: { number: string; unit: string }; big: number }) {
  return (
    <VStack spacing={2} alignment="leading">
      <Text font={13} foregroundStyle="secondaryLabel">
        话费余额
      </Text>
      <HStack spacing={4}>
        <Text font={big} fontWeight="bold" foregroundStyle="rgba(230,0,39,1)" lineLimit={1} minScaleFactor={0.5}>
          {fee.number}
        </Text>
        <Text font={14} foregroundStyle="secondaryLabel">
          {fee.unit || '元'}
        </Text>
      </HStack>
    </VStack>
  )
}

function Footer({ point, usedFlow }: { point: { number: string } | null; usedFlow: string | null }) {
  return (
    <HStack spacing={4}>
      <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>
        可用积分
      </Text>
      <Text font={14} fontWeight="bold" foregroundStyle="rgba(248,101,39,1)" lineLimit={1}>
        {point ? point.number : '—'}
      </Text>
      <Spacer />
      <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>
        已用流量
      </Text>
      <Text font={14} fontWeight="bold" foregroundStyle="label" lineLimit={1} minScaleFactor={0.5}>
        {usedFlow || '—'}
      </Text>
    </HStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const { fee, flow, voice, point } = data
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isMedium = family.includes('Medium') || family === 'medium'
  const isLarge = family.includes('Large') || family === 'large'
  const isSmall = family.includes('Small') || family === 'small'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')
  const isExtraLarge = family.includes('ExtraLarge')
  // 锁屏圆形（72x72）：只显示剩余流量百分比一个环
  if (isCircular) {
    const pct = flow.remainPct != null ? Math.round(flow.remainPct) : 0
    return (
      <ProgressGauge
        title="流量"
        value={`${pct}%`}
        icon="antenna.radiowaves.left.and.right"
        color={{ r: 59, g: 201, b: 236 }}
        progress={flow.remainPct != null ? flow.remainPct / 100 : 0}
        s={36}
      />
    )
  }
  // 锁屏矩形（157x72）：只显示话费和流量两行字
  if (isRectangular) {
    return (
      <VStack
        padding={rpt(10)}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={rpt(4)}
      >
        <Text font={rpt(12)} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
          {fee.title} {fee.number}
          {fee.unit}
        </Text>
        <Text font={rpt(12)} foregroundStyle="secondaryLabel" lineLimit={1}>
          {flow.title} {flow.number}
          {flow.unit}
        </Text>
      </VStack>
    )
  }
  // 已用流量：优先用 OCS 直接给的已用值；没有时用 剩余 x 已用% / 剩余% 反推
  const remainNum = parseFloat(flow.number)
  const usedFlow =
    typeof data.flowUsedGb === 'number' && data.flowUsedGb > 0
      ? `${data.flowUsedGb.toFixed(2)}${flow.unit || 'GB'}`
      : flow.remainPct != null && flow.remainPct > 0 && flow.remainPct < 100 && !isNaN(remainNum)
        ? `${((remainNum * (100 - flow.remainPct)) / flow.remainPct).toFixed(2)}${flow.unit || 'GB'}`
        : null
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
  // 大号：内容要在 345pt 里均匀铺满，不能只在顶部堆一坨、
  // 中间空一大块再到底行。把一个 Spacer 换成每段之间
  // 各一个 Spacer，空余平均分开；同时字号 / 条高放大。
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
      <Footer point={point} usedFlow={usedFlow} />
      <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
        {data.fromCache ? '缓存 ' : ''}
        {data.updatedAt} 更新
      </Text>
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：高都只有 155pt，
  // 不能再用两栏 / 截断，改成和截图一样的竖排列表，
  // 只是字号和间距收紧：头 12pt、余额 24pt、条高 6pt。
  // 顺序和大号完全一致：头、话费、流量条、通话条、底行。
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    return (
      <VStack
        padding={8}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={4}
        alignment="leading"
      >
        <Header compact />
        <Balance fee={fee} big={20} />
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
        <Footer point={point} usedFlow={usedFlow} />
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
        中国联通
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
  // 2. BoxJs（Loon 抓到的 Cookie），两个 key 都查
  for (const url of BOXJS_URLS) {
    const v = await getBoxJsCookie(url)
    if (v) return v
  }
  return ''
}

async function getLimits(): Promise<{ flow: number; voice: number }> {
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      return {
        flow: parseFloat(pref.flowLimit) || 0,
        voice: parseFloat(pref.voiceLimit) || 0,
      }
    }
  } catch (e) {}
  return { flow: 0, voice: 0 }
}

// 百分比的来源（按 anker v2.6.16 的逻辑，L989-1003）：
//   接口的 persent 有值时：剩余% = 100 - persent
//   persent 缺失/为 0 时：用用户填的套餐总量算，剩余% = 剩余 / 总量 x 100
//   都没有时：remainPct = null，进度条不画绿条、显示 —，
//     绝不再默认 100%（john 真机上流量和通话都显示 100% 就是
//     因为 persent 缺失，之前代码默认成了 100）。
function remainPctFrom(persent: any, remainNum: number, limit: number): number | null {
  const used = persent != null ? Number(persent) : NaN
  if (!isNaN(used) && used > 0) return Math.max(0, Math.min(100, 100 - used))
  if (limit > 0 && !isNaN(remainNum) && remainNum >= 0)
    return Math.max(0, Math.min(100, (remainNum / limit) * 100))
  return null
}

// 余量明细接口（联通官方 App 用的核心接口，来源：
// Shaobo-Pocket-Carrier 的 unicom.py，fetch_all_data 第 3.5 步）：
//   POST https://mxx.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune
//   同一个 Cookie 就能用（.10010.com 域下）。
// 返回字段：
//   canUseFlowAll / canuseFlowAllUnit：剩余流量（GB/MB）
//   allUserFlow：已用流量（MB）
//   canUseValueAll / canuseVoiceAllUnit：剩余通话（分钟）
//   voiceHeadUsed：已用通话（分钟）
//   voiceSumresource：通话套餐总量（分钟）
// 总量 = 剩余 + 已用（流量）；通话总量优先用 voiceSumresource，
// 不可靠时用 剩余 + 已用。这样百分比和已用流量都能直接从
// 联通数据算出来，不用手动填套餐总量。
async function fetchOcs(cookie: string): Promise<{
  flowRemainGb: number
  flowUsedGb: number
  voiceRemain: number
  voiceUsed: number
  voiceTotal: number
} | null> {
  try {
    const res = await fetch(
      'https://mxx.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune',
      {
        method: 'POST',
        headers: {
          Origin: 'https://imgxx.client.10010.com',
          Referer: 'https://imgxx.client.10010.com/yuliangchaxunsf/index.html',
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) unicom{version:iphone_c@13.0100};ltst;OSVersion/26.1',
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookie,
        },
        body: 'duanlianjieabc=&channelCode=&serviceType=&saleChannel=&externalSources=&contactCode=&ticket=&ticketPhone=&ticketChannel=&mobile1=&language=chinese',
      },
    )
    const j: any = await res.json()
    if (!j || typeof j !== 'object') return null
    let flowRemainGb = parseFloat(j.canUseFlowAll)
    if (isNaN(flowRemainGb)) return null
    const flowUnit = String(j.canuseFlowAllUnit || 'GB').toUpperCase()
    if (flowUnit === 'MB') flowRemainGb = flowRemainGb / 1024
    const flowUsedGb = (parseFloat(j.allUserFlow) || 0) / 1024
    const voiceRemain = parseFloat(j.canUseValueAll)
    const voiceUsed = parseFloat(j.voiceHeadUsed) || 0
    const voiceSum = parseFloat(j.voiceSumresource) || 0
    const voiceTotal =
      voiceSum > voiceUsed && voiceSum > (isNaN(voiceRemain) ? 0 : voiceRemain)
        ? voiceSum
        : (isNaN(voiceRemain) ? 0 : voiceRemain) + voiceUsed
    return {
      flowRemainGb,
      flowUsedGb,
      voiceRemain: isNaN(voiceRemain) ? 0 : voiceRemain,
      voiceUsed,
      voiceTotal,
    }
  } catch (e) {
    return null
  }
}

async function fetchData(cookie: string): Promise<WidgetData> {
  const res = await fetch(API_URL, {
    method: 'GET',
    headers: { cookie },
  }).then((r) => r.json())
  if (!res || res.code !== 'Y') throw new Error('Cookie 可能过期，重新打开联通 App 抓一次')
  const out: WidgetData = {
    fee: { number: '0', unit: '元', title: '话费剩余' },
    flow: { number: '—', unit: '', title: '剩余流量', remainPct: null },
    voice: { number: '—', unit: '分钟', title: '语音剩余', remainPct: null },
    point: null,
    updatedAt: (() => {
      const d = new Date()
      const p = (n: number) => (n < 10 ? '0' + n : '' + n)
      return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
    })(),
    fromCache: false,
    error: '',
  }
  const list = (res.data && res.data.dataList) || []
  // 先拿 OCS 明细（总量直接从联通读），失败就用下面的 persent/手动填
  const ocs = await fetchOcs(cookie)
  for (const item of list) {
    if (item.type === 'fee') {
      out.fee = {
        number: String(item.number),
        unit: item.unit || '元',
        title: item.remainTitle || '话费剩余',
      }
    }
    if (item.type === 'flow') {
      const limits = await getLimits()
      let remainPct: number | null = null
      if (ocs && ocs.flowRemainGb + ocs.flowUsedGb > 0) {
        remainPct = Math.max(
          0,
          Math.min(100, (ocs.flowRemainGb / (ocs.flowRemainGb + ocs.flowUsedGb)) * 100),
        )
      } else {
        remainPct = remainPctFrom(item.persent, parseFloat(item.number), limits.flow)
      }
      out.flow = {
        number: String(item.number),
        unit: item.unit || '',
        title: (item.remainTitle || '剩余流量').replace(/通用/g, ''),
        remainPct,
      }
      if (ocs && ocs.flowUsedGb > 0) out.flowUsedGb = ocs.flowUsedGb
    }
    if (item.type === 'voice') {
      const limits = await getLimits()
      let remainPct: number | null = null
      if (ocs && ocs.voiceTotal > 0) {
        remainPct = Math.max(0, Math.min(100, (ocs.voiceRemain / ocs.voiceTotal) * 100))
      } else {
        remainPct = remainPctFrom(item.persent, parseFloat(item.number), limits.voice)
      }
      out.voice = {
        number: String(item.number),
        unit: item.unit || '分钟',
        title: item.remainTitle || '语音剩余',
        remainPct,
      }
    }
    if (item.type === 'point') {
      out.point = { number: String(item.number), title: item.remainTitle || '剩余积分' }
    }
  }
  return out
}

;(async () => {
  try {
    const cookie = await getCookie()
    if (!cookie) {
      Widget.present(
        <ErrorView message="还没拿到 Cookie。先在 App 里填 Cookie，或用 Loon 抓一次联通 App 的 Cookie。" />,
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
