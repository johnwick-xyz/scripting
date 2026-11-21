import {
  Capsule,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  modifiers,
} from 'scripting'
import { rpt } from './utils'

// 京东价格监控 Scripting 小组件（改版：小组件本身不联网）
// 测试证明了：不联网的测试小组件能正常出来，
// 卡住的是小组件里拉 p.3.cn / BoxJs 那几步网络——
// 在小组件里，fetch 一旦没反应，超时也靠不住，
// 就一直打圈圈，永远到不了 Widget.present。
// 所以改成：取价只在 App 里做（index.tsx），
// App 拉到价就存进 cache.json / price_history.json，
// 小组件只读本地缓存，秒出，绝不转圈。
// 代价：小组件显示的是上次 App 打开时拉到的价，
// 不是每次刷新都重新拉。想看最新价就打开一次 App，
// 它会自动拉新价并刷新小组件。

interface PriceEntry {
  t: number
  p: number
}

interface WidgetData {
  name: string
  sku: string
  price: number | null
  prevPrice: number | null
  low: number | null
  high: number | null
  history: PriceEntry[]
  updatedAt: string
  updatedTs?: number
  fromCache: boolean
  error: string
}

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

function fmt(n: number): string {
  return n.toFixed(2)
}

function changeInfo(data: WidgetData): { text: string; up: boolean; down: boolean } {
  if (data.price == null || data.prevPrice == null) {
    return { text: '首次记录', up: false, down: false }
  }
  const diff = data.price - data.prevPrice
  if (Math.abs(diff) < 0.005) return { text: '没变', up: false, down: false }
  const pct = (diff / data.prevPrice) * 100
  const sign = diff > 0 ? '+' : ''
  return {
    text: `${diff > 0 ? '▲' : '▼'} ${sign}${fmt(diff)} (${sign}${pct.toFixed(1)}%)`,
    up: diff > 0,
    down: diff < 0,
  }
}

function Header({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <HStack spacing={compact ? 6 : 8}>
      <Text
        font={compact ? 11 : 14}
        fontWeight="bold"
        foregroundStyle="white"
        padding={compact ? 3 : 6}
        background={{ shape: 'circle', style: 'rgba(225,37,27,1)' }}
      >
        京
      </Text>
      <Text
        font={compact ? 12 : 16}
        fontWeight="bold"
        foregroundStyle="label"
        lineLimit={compact ? 1 : 2}
      >
        {name}
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

function PriceBlock({
  data,
  big,
  compact,
}: {
  data: WidgetData
  big: number
  compact?: boolean
}) {
  const ch = changeInfo(data)
  const chColor = ch.up
    ? 'rgba(225,37,27,1)'
    : ch.down
      ? 'rgba(34,197,94,1)'
      : 'secondaryLabel'
  return (
    <VStack spacing={2} alignment="leading">
      <Text font={compact ? 11 : 13} foregroundStyle="secondaryLabel">
        实时价
      </Text>
      <HStack spacing={4}>
        <Text font={compact ? 14 : 18} fontWeight="bold" foregroundStyle="rgba(225,37,27,1)">
          ¥
        </Text>
        <Text
          font={big}
          fontWeight="bold"
          foregroundStyle="rgba(225,37,27,1)"
          lineLimit={1}
          minScaleFactor={0.5}
        >
          {data.price != null ? fmt(data.price) : '—'}
        </Text>
      </HStack>
      <Text
        font={compact ? 11 : 13}
        fontWeight="semibold"
        foregroundStyle={chColor as any}
        lineLimit={1}
      >
        {ch.text}
      </Text>
    </VStack>
  )
}

function Footer({
  data,
  compact,
}: {
  data: WidgetData
  compact?: boolean
}) {
  const f = compact ? 11 : 13
  return (
    <HStack spacing={4}>
      <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1}>
        最低 {data.low != null ? fmt(data.low) : '—'}
      </Text>
      <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1}>
        最高 {data.high != null ? fmt(data.high) : '—'}
      </Text>
      <Spacer />
      <Text font={f} foregroundStyle="secondaryLabel" lineLimit={1}>
        {data.updatedAt} 更新
      </Text>
    </HStack>
  )
}

function HistoryBars({ history }: { history: PriceEntry[] }) {
  const items = history.slice(-10)
  if (items.length < 2) return <Text font={12} foregroundStyle="secondaryLabel">历史还不够，打开 App 刷新几次就有走势图了</Text>
  const prices = items.map((x) => x.p)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min > 0 ? max - min : 1
  return (
    <VStack spacing={6} alignment="leading">
      <Text font={13} foregroundStyle="secondaryLabel">
        最近走势（共 {history.length} 条记录）
      </Text>
      <HStack spacing={6}>
        {items.map((x, i) => {
          const h = 8 + ((x.p - min) / span) * 72
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
      <HStack>
        <Text font={11} foregroundStyle="secondaryLabel">
          {fmt(min)}
        </Text>
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {fmt(max)}
        </Text>
      </HStack>
    </VStack>
  )
}

function WidgetView({ data }: { data: WidgetData }) {
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const isMedium = family.includes('Medium') || family === 'medium'
  const isSmall = family.includes('Small') || family === 'small'
  const isCircular = family.includes('Circular')
  const isRectangular = family.includes('Rectangular')
  // 锁屏圆形（72x72）：只显示当前价，固定字号，不用 rpt
  if (isCircular) {
    return (
      <VStack
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={0}
      >
        <Text font={10} foregroundStyle="secondaryLabel">
          ¥
        </Text>
        <Text font={20} fontWeight="bold" foregroundStyle="rgba(225,37,27,1)" lineLimit={1} minScaleFactor={0.6}>
          {data.price != null ? fmt(data.price) : '—'}
        </Text>
      </VStack>
    )
  }
  // 锁屏矩形（157x72）：商品简称 + 价格 + 涨跌，固定字号 13/12
  if (isRectangular) {
    const ch = changeInfo(data)
    return (
      <VStack
        padding={8}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={4}
      >
        <Text font={13} fontWeight="bold" foregroundStyle="label" lineLimit={1}>
          {data.name} ¥{data.price != null ? fmt(data.price) : '—'}
        </Text>
        <Text font={12} foregroundStyle="secondaryLabel" lineLimit={1}>
          {ch.text}
        </Text>
      </VStack>
    )
  }
  // 大号：每段之间各一个 Spacer，空余平均分开
  const body = (
    <VStack
      padding={20}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
      spacing={8}
      alignment="leading"
    >
      <Header name={data.name} />
      <Spacer />
      <PriceBlock data={data} big={44} />
      <Spacer />
      <HistoryBars history={data.history} />
      <Spacer />
      <Footer data={data} />
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：高都只有 155pt，竖排列表
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    return (
      <VStack
        padding={6}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={2}
        alignment="leading"
      >
        <Header name={data.name} compact />
        <PriceBlock data={data} big={26} compact />
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
        京东价格监控
      </Text>
      <Text font={rpt(12)} foregroundStyle="secondaryLabel">
        {message}
      </Text>
    </VStack>
  )
}

// 小组件只读本地缓存，不联网、不读 BoxJs，秒出。
// 注意：App 和小组件是两次分开的执行，不能靠文件传数据——
// 上一版就是栽在这儿：App 写的 cache.json，小组件读不到。
// 官方文档的办法是全局 Storage，shared: true 才是跨界面共享的域，
// 所以 App 写 Storage，小组件先读 Storage，文件只当备用。
function readCached(): any | null {
  try {
    const v: any = Storage.get('jd_price_cache', { shared: true })
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

// 告诉系统下次在下一个更新点（9:00 / 15:00 / 21:00）
// 再重新跑一次小组件。
;(async () => {
  const cached = readCached()
  if (cached && cached.price != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      policy: 'after',
      date: nextSlot(new Date()),
    } as any)
    return
  }
  Widget.present(
    <ErrorView message="还没价格。打开一次 App，它会自动拉新价并刷新小组件。预览里看到这条的话，点右上角“重新载入”再看一次。" />,
  )
})()
