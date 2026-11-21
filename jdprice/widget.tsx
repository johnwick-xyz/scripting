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

// 京东价格监控 Scripting 小组件
// 商品：西昊豆包椅L1，SKU 100244780555（可换，见 index.tsx）
// 不设目标价，只看实时价和涨跌。
//
// 取价接口（京东公开的价格接口，不用登录）：
//   GET https://p.3.cn/prices/mgets?skuIds=J_<SKU>&type=1
//   备用：https://pm.3.cn/prices/mgets?skuIds=J_<SKU>&type=1
//   返回 [{"id":"J_100244780555","p":"449.00","m":"499.00","op":"499.00"}]
//   p 是当前价，m / op 是原价 / 市场价。
// 注意：这个接口在我的电脑和云浏览器上两次都连接被重置，
//   没法在这边验证；小组件是在你手机上直接拉的，手机网络
//   和这边不一样，所以必须在真机上试一次才算数。
//   如果 p.3.cn 在手机上也不通，小组件会显示上次缓存的价格，
//   并提示“拉取失败”。
//
// 涨跌：每次刷新把价格记进本地 price_history.json（最多 30 条），
//   涨跌 = 当前价 - 上一次记录的价。最低 / 最高也是从这份本地
//   历史里算的，不是京东官方的历史价。
// 刷新频率由 iOS 决定，一般 15-30 分钟一次，不是秒级实时。

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
  fromCache: boolean
  error: string
}

const PRICE_URLS = (sku: string) => [
  `https://p.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
  `https://pm.3.cn/prices/mgets?skuIds=J_${sku}&type=1`,
]

function getSettings(): { sku: string; name: string } {
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const prefPath = Path.join(root, 'preference.json')
    if (FileManager.existsSync(prefPath)) {
      const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
      return {
        sku: String(pref.sku || '100244780555'),
        name: pref.name || '西昊豆包椅L1',
      }
    }
  } catch (e) {}
  return { sku: '100244780555', name: '西昊豆包椅L1' }
}

function loadHistory(): PriceEntry[] {
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    const path = Path.join(root, 'price_history.json')
    if (FileManager.existsSync(path)) {
      const list = JSON.parse(FileManager.readAsStringSync(path) || '[]')
      if (Array.isArray(list)) return list.filter((x) => x && typeof x.p === 'number')
    }
  } catch (e) {}
  return []
}

function saveHistory(list: PriceEntry[]) {
  try {
    const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
    if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
    FileManager.writeAsStringSync(
      Path.join(root, 'price_history.json'),
      JSON.stringify(list.slice(-30)),
    )
  } catch (e) {}
}

// 带超时的拉取：p.3.cn 在某些网络上会一直不返回，
// 之前没加超时，小组件就一直打圈圈，永远到不了
// Widget.present。每个地址最多等 8 秒，超时就换备用地址，
// 两个都超时就直接报错 / 显示缓存，不再一直转。
async function fetchJsonWithTimeout(url: string, options: any, ms = 8000): Promise<any> {
  return Promise.race([
    fetch(url, options).then((r) => r.json()),
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('取价超时（8秒没返回）')), ms),
    ),
  ])
}

async function fetchPrice(sku: string): Promise<number> {
  for (const url of PRICE_URLS(sku)) {
    try {
      const res: any = await fetchJsonWithTimeout(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          Referer: `https://item.jd.com/${sku}.html`,
        },
      })
      const list = Array.isArray(res) ? res : []
      for (const item of list) {
        if (String(item.id || '').replace(/^J_/, '') === String(sku) && item.p) {
          const p = parseFloat(item.p)
          if (!isNaN(p) && p > 0) return p
        }
      }
    } catch (e) {}
  }
  throw new Error('取价接口没返回价格，可能是网络或接口被拦了')
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
  if (items.length < 2) return <Text font={12} foregroundStyle="secondaryLabel">历史还不够，刷新几次就有走势图了</Text>
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
      {data.fromCache && (
        <Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>
          缓存价格，取价失败时显示
        </Text>
      )}
    </VStack>
  )
  // 中号（329x155）和小号（155x155）：高都只有 155pt，
  // 竖排列表，字号和间距收紧：头 11pt、价格 26pt、
  // 边距 6、间距 2，底行短标签。
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

;(async () => {
  const { sku, name } = getSettings()
  const updatedAt = (() => {
    const d = new Date()
    const p = (n: number) => (n < 10 ? '0' + n : '' + n)
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  })()
  try {
    const history = loadHistory()
    const prevPrice = history.length > 0 ? history[history.length - 1].p : null
    const price = await fetchPrice(sku)
    // 记一条历史：价格变了，或者上条记录超过 15 分钟，才记
    const now = Date.now()
    const last = history.length > 0 ? history[history.length - 1] : null
    if (!last || last.p !== price || now - last.t > 15 * 60 * 1000) {
      history.push({ t: now, p: price })
    }
    const kept = history.slice(-30)
    saveHistory(kept)
    const prices = kept.map((x) => x.p)
    const data: WidgetData = {
      name,
      sku,
      price,
      prevPrice,
      low: prices.length ? Math.min(...prices) : null,
      high: prices.length ? Math.max(...prices) : null,
      history: kept,
      updatedAt,
      fromCache: false,
      error: '',
    }
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
    Widget.present(
      <ErrorView message={'拉取失败：' + String(e) + '。先看一下手机能不能打开 p.3.cn 这个取价地址。'} />,
    )
  }
})()
