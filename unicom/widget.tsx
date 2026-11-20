import {
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
// Loon 抓 Cookie 用的 key 是 'unicom_cookie'，和上面 anker 用的
// @ChinaUnicom.10010v4.cookie 不是同一个 key，必须两个都查，
// 否则 Loon 弹“已抓取”，小组件却报没拿到数据。
// 顺序：先查原版 @… key（兼容已存那边的用户），再查 unicom_cookie。
// BoxJs 是本机服务，通常走 http，所以 unicom_cookie 那条用 http。
const BOXJS_URLS = [
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

function ProgressGauge({
  title,
  value,
  icon,
  color,
  progress,
}: {
  title: string
  value: string | number
  icon: string
  color: { r: number; g: number; b: number }
  progress: number
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
            frame={{ width: rpt(58), height: rpt(58) }}
            trim={{ from: 0.15, to: 0.85 }}
            rotationEffect={90}
            stroke={{
              shapeStyle: bgColor,
              strokeStyle: { lineWidth: rpt(4), lineCap: 'round' },
            }}
          />
          <Circle
            trim={{ from: 0.15, to: trimTo }}
            rotationEffect={90}
            stroke={{
              shapeStyle: {
                colors: [colorStart, iconColor],
                startPoint: 'leading',
                endPoint: 'trailing',
              },
              strokeStyle: { lineWidth: rpt(4), lineCap: 'round' },
            }}
          />
          <VStack
            frame={{ width: rpt(50), height: rpt(50) }}
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
            <Text font={rpt(8)} foregroundStyle="secondaryLabel" fontWeight="medium">
              {title}
            </Text>
            <Text
              font={rpt(12)}
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
              font={rpt(12)}
            />
          </VStack>
        </ZStack>
      )}
    </EnvironmentValuesReader>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const { fee, flow, voice, point } = data
  return (
    <VStack
      padding={rpt(14)}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
    >
      <HStack alignment="top">
        <VStack alignment="leading">
          <Text foregroundStyle="secondaryLabel" fontWeight="medium" font={rpt(12)}>
            {fee.title}
          </Text>
          <Text
            font={rpt(24)}
            fontDesign="rounded"
            fontWeight="bold"
            foregroundStyle="label"
            lineLimit={1}
            minScaleFactor={0.5}
          >
            {fee.number}
            <Text font={rpt(12)} foregroundStyle="secondaryLabel">
              {' ' + fee.unit}
            </Text>
          </Text>
        </VStack>
        <Spacer />
        <Text foregroundStyle="secondaryLabel" font={rpt(11)}>
          {data.fromCache ? '缓存 ' : ''}
          {data.updatedAt}
        </Text>
      </HStack>
      <HStack spacing={rpt(15)}>
        <ProgressGauge
          title={flow.title}
          value={`${flow.number}${flow.unit}`}
          icon="antenna.radiowaves.left.and.right"
          color={{ r: 59, g: 201, b: 236 }}
          progress={flow.remainPct != null ? flow.remainPct / 100 : 0}
        />
        <ProgressGauge
          title={voice.title}
          value={`${voice.number}${voice.unit}`}
          icon="phone"
          color={{ r: 162, g: 207, b: 57 }}
          progress={voice.remainPct != null ? voice.remainPct / 100 : 0}
        />
      </HStack>
      <Text foregroundStyle="secondaryLabel" font={rpt(11)}>
        {point ? `${point.title}：${point.number}` : data.error ? data.error : '中国联通'}
      </Text>
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
    updatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
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
