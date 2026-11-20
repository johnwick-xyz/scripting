import {
  Circle,
  Color,
  HStack,
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

// 自适应：按 Widget.family 分尺寸，不再按 displaySize 宽高比现算圆环。
// 上一版按 displaySize 现算圆环尺寸，结果圆环直接消失了
// （只剩小圆点和数字），所以圆环尺寸回到经过验证的 rpt 写法。
// 尺寸显示策略（Apple HIG iPhone pt）：
//   小号 155x155：只放一个最大的剩余流量圆环（核心指标）
//   中号 329x155：横排 话费/流量/语音 三个精简圆环
//   大号 329x345：2x2 四个圆环全显示，字号更大
// rpt 是按最短边算的（utils.tsx：rpt(n)=n*min(W,H)/155）：
//   小 / 中最短边都是 155~170，rpt 值≈原值；
//   大最短边是 329~364，rpt 值≈原值 x 2.1~2.3。
function ProgressGauge({
  title,
  value,
  badge,
  color,
  progress,
  s = 36,
}: {
  title: string
  value: string | number
  badge?: string
  color: { r: number; g: number; b: number }
  progress: number
  s?: number
}) {
  // 目标样式：缺口在正下方、约 60°（每端 30° = 0.083 圈）。
  // Circle 的 trim 起点在 3 点方向顺时针，rotationEffect=90 后缺口落到正下方。
  const GAP = 0.083 // 缺口半宽（圈数）：0.083*360≈30°，两端共 60°
  const FULL = 1 - 2 * GAP // 可画弧长 0.834
  const trimTo = GAP + FULL * Math.max(0, Math.min(1, progress))
  const ringColor: Color = `rgba(${color.r},${color.g},${color.b},1)`
  const colorStart: Color = `rgba(${color.r},${color.g},${color.b},0.55)`
  // 底环用彩色浅色（看得见），不是灰色、也不是近乎透明
  const bgColor: Color = `rgba(${color.r},${color.g},${color.b},0.18)`
  const bgStart: Color = `rgba(${color.r},${color.g},${color.b},0.28)`
  return (
    <ZStack>
      {/* 底环：与目标进度环同样的 60° 缺口，只是颜色浅 */}
      <Circle
        frame={{ width: rpt(s), height: rpt(s) }}
        trim={{ from: GAP, to: 1 - GAP }}
        rotationEffect={90}
        stroke={{
          shapeStyle: {
            colors: [bgColor, bgStart, bgColor],
            startPoint: 'leading',
            endPoint: 'trailing',
          },
          strokeStyle: { lineWidth: rpt(s * 0.085), lineCap: 'butt' },
        }}
      />
      {/* 进度环：从缺口左端顺时针画到 trimTo；渐变两端深、中段亮 */}
      <Circle
        frame={{ width: rpt(s), height: rpt(s) }}
        trim={{ from: GAP, to: trimTo }}
        rotationEffect={90}
        stroke={{
          shapeStyle: {
            colors: [colorStart, ringColor, colorStart],
            startPoint: 'leading',
            endPoint: 'trailing',
          },
          strokeStyle: { lineWidth: rpt(s * 0.085), lineCap: 'round' },
        }}
      />
      {/* 目标样式：环内三行——标题 / 数值 / 分类小圆标（费·流·话·积）。
          全部收在环内空白区：环线宽 s*0.08，环内可用直径约 s*0.84，
          文字框给 s*0.66 留余量；长数值靠 lineLimit=1 + minScaleFactor
          自动缩小到框内，绝不叠到圆环线上。 */}
      <VStack
        frame={{ width: rpt(s * 0.66), height: rpt(s * 0.66) }}
        alignment="center"
        spacing={rpt(0.5)}
        background={{
          shape: 'circle',
          style: {
            colors: [bgStart, 'clear'],
            startPoint: 'top',
            endPoint: 'bottom',
          },
        }}
      >
        <Text
          font={rpt(s * 0.14)}
          foregroundStyle="secondaryLabel"
          fontWeight="medium"
          lineLimit={1}
          minScaleFactor={0.4}
        >
          {title}
        </Text>
        <Text
          font={rpt(s * 0.19)}
          fontDesign="rounded"
          fontWeight="bold"
          foregroundStyle="label"
          lineLimit={1}
          minScaleFactor={0.3}
        >
          {value}
        </Text>
        {badge ? (
          <Text
            font={rpt(s * 0.11)}
            fontWeight="bold"
            foregroundStyle="white"
            padding={rpt(2)}
            background={{ shape: 'circle', style: ringColor }}
          >
            {badge}
          </Text>
        ) : null}
      </VStack>
    </ZStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const { fee, flow, voice, point } = data
  // 规格确认自 Scripting 官方文档 Honye/scripting-scripts
  // documentation/widget_api/en.md：
  //   Widget.family = "systemSmall" | "systemMedium" | "systemLarge"
  //     | "accessoryRectangular" | "accessoryCircular"
  //     （另有 iPad 的 systemExtraLarge）
  //   Widget.displaySize = {width, height}（单位 pt，随机型变，
  //     文档里没有固定数字）
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isSmall = family.includes('Small') || family === 'small'
  const isMedium = family.includes('Medium') || family === 'medium'
  const isLarge = family.includes('Large') || family === 'large'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')

  // 锁屏圆形（72x72）：只显示剩余流量百分比一个环
  if (isCircular) {
    const pct = flow.remainPct != null ? Math.round(flow.remainPct) : 0
    return (
      <ProgressGauge
        title="流量"
        value={`${pct}%`}
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

  // 各 gauge 实例（按尺寸复用）
  const feeGauge = (s: number) => (
    <ProgressGauge
      title={fee.title}
      value={`${fee.number}${fee.unit}`}
      badge="费"
      color={{ r: 248, g: 101, b: 39 }}
      progress={1}
      s={s}
    />
  )
  const flowGauge = (s: number) => (
    <ProgressGauge
      title={flow.title}
      value={`${flow.number}${flow.unit}`}
      badge="流"
      color={{ r: 59, g: 201, b: 236 }}
      progress={flow.remainPct != null ? flow.remainPct / 100 : 0}
      s={s}
    />
  )
  const voiceGauge = (s: number) => (
    <ProgressGauge
      title={voice.title}
      value={`${voice.number}${voice.unit}`}
      badge="话"
      color={{ r: 162, g: 207, b: 57 }}
      progress={voice.remainPct != null ? voice.remainPct / 100 : 0}
      s={s}
    />
  )
  const pointGauge = (s: number) => (
    <ProgressGauge
      title={point ? point.title : '可用积分'}
      value={point ? point.number : '—'}
      badge="积"
      color={{ r: 168, g: 130, b: 255 }}
      progress={1}
      s={s}
    />
  )

  // ---------- 主屏幕三号尺寸分化显示 ----------
  // 目标样式：小号/大号都是四环 2x2，中号横排三项；每环带汉字分类小圆标。
  let content
  if (isSmall) {
    // 小号：四环 2x2，环稍小以塞进 155pt
    content = (
      <VStack spacing={rpt(6)} alignment="center">
        <HStack spacing={rpt(8)} alignment="center">
          {feeGauge(40)}
          {flowGauge(40)}
        </HStack>
        <HStack spacing={rpt(8)} alignment="center">
          {voiceGauge(40)}
          {pointGauge(40)}
        </HStack>
      </VStack>
    )
  } else if (isMedium) {
    // 中号：横排 话费 / 流量 / 语音 三个精简圆环
    content = (
      <HStack spacing={rpt(10)} alignment="center">
        {feeGauge(42)}
        {flowGauge(42)}
        {voiceGauge(42)}
      </HStack>
    )
  } else {
    // 大号：2x2 四个圆环全显示，字号更大
    content = (
      <VStack spacing={rpt(16)} alignment="center">
        <HStack spacing={rpt(26)} alignment="center">
          {feeGauge(56)}
          {flowGauge(56)}
        </HStack>
        <HStack spacing={rpt(26)} alignment="center">
          {voiceGauge(56)}
          {pointGauge(56)}
        </HStack>
      </VStack>
    )
  }

  return (
    <VStack
      padding={rpt(16)}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
      spacing={rpt(10)}
    >
      <Spacer />
      {content}
      <Spacer />
      {/* 底行放中间：左右各加一个 Spacer 才能真正居中，
          光写 alignment="center" 在 Scripting 里只管竖直方向，不管水平 */}
      <HStack spacing={rpt(6)}>
        <Spacer />
        <Text
          foregroundStyle="rgba(230,0,39,1)"
          font={rpt(10)}
          fontWeight="bold"
          lineLimit={1}
        >
          中国联通
        </Text>
        <Text foregroundStyle="secondaryLabel" font={rpt(10)} lineLimit={1}>
          ·
        </Text>
        <Text foregroundStyle="secondaryLabel" font={rpt(10)} lineLimit={1} minScaleFactor={0.5}>
          {data.fromCache ? '缓存 ' : ''}
          {data.updatedAt} 更新
        </Text>
        <Spacer />
      </HStack>
    </VStack>
  )
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
  for (const item of list) {
    if (item.type === 'fee') {
      out.fee = {
        number: String(item.number),
        unit: item.unit || '元',
        title: item.remainTitle || '话费剩余',
      }
    }
    if (item.type === 'flow') {
      const used = item.persent != null ? Number(item.persent) : null
      out.flow = {
        number: String(item.number),
        unit: item.unit || '',
        title: (item.remainTitle || '剩余流量').replace(/通用/g, ''),
        remainPct: used != null ? Math.max(0, Math.min(100, 100 - used)) : null,
      }
    }
    if (item.type === 'voice') {
      const used = item.persent != null ? Number(item.persent) : null
      out.voice = {
        number: String(item.number),
        unit: item.unit || '分钟',
        title: item.remainTitle || '语音剩余',
        remainPct: used != null ? Math.max(0, Math.min(100, 100 - used)) : null,
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
