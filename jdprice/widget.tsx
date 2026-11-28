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

import {
  DEFAULT_IMAGE_URL,
  DEFAULT_SLOTS,
  fetchPrice,
  getCookie,
  getSku,
  getAppRoot,
  getPrefPath,
  isUpdateWindow,
  nextSlot,
  currentSlot,
  parseSlots,
  readCached,
  saveCache,
  withTimeout,
  strictNum,
  extractWarePrice,
  WidgetData,
  PriceEntry,
} from './utils'

// ==================== 常量 ====================

const DISPLAY_DELAY_MINUTES = 5

// ==================== 视图组件 ====================

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

function changeInfo(data: WidgetData): {
  text: string
  short: string
  up: boolean
  down: boolean
} {
  if (data.price == null || data.prevPrice == null) {
    return { text: '首次记录', short: '首次记录', up: false, down: false }
  }
  const diff = data.price - data.prevPrice
  if (Math.abs(diff) < 0.005) return { text: '没变', short: '没变', up: false, down: false }
  const pct = (diff / data.prevPrice) * 100
  const sign = diff > 0 ? '+' : ''
  const delta = `${diff > 0 ? '▲' : '▼'} ${sign}${diff.toFixed(2)}`
  return {
    text: `${delta} (${sign}${pct.toFixed(1)}%)`,
    // 小图那格只有 73pt 宽（155-24留白-50图-8间距），
    // 全文 "▲ +20.00 (+4.2%)" 94pt 放不下会被截成 "▲ +20.00…"，
    // 小图只显示涨跌额，不带百分比（49.5pt，放得下）。
    short: delta,
    up: diff > 0,
    down: diff < 0,
  }
}

function PriceBlock({
  data,
  big,
  compact,
  tiny,
}: {
  data: WidgetData
  big: number
  compact?: boolean
  tiny?: boolean
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
          {data.price != null ? data.price.toFixed(2) : '—'}
        </Text>
      </HStack>
      <Text
        font={compact ? 11 : 13}
        fontWeight="semibold"
        foregroundStyle={chColor as any}
        lineLimit={1}
        minScaleFactor={0.7}
      >
        {tiny ? ch.short : ch.text}
      </Text>
    </VStack>
  )
}

function PriceRow({
  data,
  big,
  imgSize,
  compact,
  tiny,
}: {
  data: WidgetData
  big: number
  imgSize: number
  compact?: boolean
  tiny?: boolean
}) {
  const img = data.imagePath ? (
    <Image filePath={data.imagePath} resizable frame={{ width: imgSize, height: imgSize }} />
  ) : (
    <Image
      imageUrl={data.imageUrl || DEFAULT_IMAGE_URL}
      resizable
      frame={{ width: imgSize, height: imgSize }}
    />
  )
  return (
    <HStack spacing={8}>
      <PriceBlock data={data} big={big} compact={compact} tiny={tiny} />
      <Spacer />
      {img}
    </HStack>
  )
}

function Footer({
  data,
  compact,
  tiny,
}: {
  data: WidgetData
  compact?: boolean
  tiny?: boolean
}) {
  const f = compact ? 11 : 13
  let time = data.updatedAt
  let tryAt = data.lastTryAt || ''
  if (tiny && data.updatedTs) {
    const u = new Date(data.updatedTs)
    const n = new Date()
    const pad = (x: number) => (x < 10 ? '0' + x : '' + x)
    if (
      u.getFullYear() === n.getFullYear() &&
      u.getMonth() === n.getMonth() &&
      u.getDate() === n.getDate()
    ) {
      time = `${pad(u.getHours())}:${pad(u.getMinutes())}`
    }
    if (tryAt) tryAt = tryAt.split(' ')[1] || tryAt
  }
  return (
    <Text
      font={f}
      foregroundStyle="secondaryLabel"
      lineLimit={1}
      minScaleFactor={tiny ? 0.55 : 0.7}
    >
      最低 {data.low != null ? data.low.toFixed(2) : '—'} · 最高{' '}
      {data.high != null ? data.high.toFixed(2) : '—'} · {time}
      {data.lastTryTs != null &&
      data.updatedTs != null &&
      data.lastTryTs > data.updatedTs &&
      tryAt
        ? ` · ${tryAt} 更新失败`
        : ''}
    </Text>
  )
}

function PrevPrices({ history }: { history: PriceEntry[] }) {
  const prev = (history || []).slice(0, -1).slice(-3).reverse()
  if (prev.length === 0) {
    return (
      <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
        暂无更早记录，刷新几次后显示前三次价格
      </Text>
    )
  }
  const row = (x: PriceEntry | undefined) => {
    if (!x) return null
    return (
      <HStack spacing={4}>
        <Text font={10} fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          ¥{x.p.toFixed(2)}
        </Text>
        <Spacer />
        <Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>
          {new Date(x.t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </HStack>
    )
  }
  return (
    <VStack spacing={1} alignment="leading">
      {row(prev[0])}
      {row(prev[1])}
      {row(prev[2])}
    </VStack>
  )
}

function HistoryBars({ history }: { history: PriceEntry[] }) {
  const items = history.slice(-10)
  if (items.length < 2) {
    return (
      <Text font={12} foregroundStyle="secondaryLabel">
        历史还不够，打开 App 刷新几次就有走势图了
      </Text>
    )
  }
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
          {min.toFixed(2)}
        </Text>
        <Spacer />
        <Text font={11} foregroundStyle="secondaryLabel">
          {max.toFixed(2)}
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
          {data.price != null ? data.price.toFixed(2) : '—'}
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
          {data.name} ¥{data.price != null ? data.price.toFixed(2) : '—'}
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
      <PriceRow data={data} big={44} imgSize={88} />
      <PrevPrices history={data.history} />
      <Spacer />
      <HistoryBars history={data.history} />
      <Spacer />
      <Footer data={data} />
    </VStack>
  )

  // 中号（329x155）和小号（155x155）：竖排列表。
  if (isMedium || isSmall || (!family && W < 200) || (!family && W > H * 1.4)) {
    const tiny = isSmall || (!family && W < 200)
    return (
      <VStack
        padding={{ horizontal: 12, vertical: 8 }}
        frame={Widget.displaySize}
        modifiers={modifiers().widgetBackground('systemBackground')}
        spacing={1}
        alignment="leading"
      >
        <Header name={data.name} compact />
        <PriceRow data={data} big={24} imgSize={50} compact tiny={tiny} />
        <PrevPrices history={data.history} />
        <Spacer />
        <Footer data={data} compact tiny={tiny} />
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

// ==================== 主流程（IIFE） ====================

;(async () => {
  const now = new Date()
  const slots = (() => {
    try {
      const v: any = Storage.get('jd_refresh_slots', { shared: true })
      if (v != null && String(v).trim()) return parseSlots(v)
    } catch (e) {}
    try {
      const root = getAppRoot()
      const prefPath = getPrefPath()
      if (FileManager.existsSync(prefPath)) {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.slots != null && String(pref.slots).trim()) return parseSlots(pref.slots)
      }
    } catch (e) {}
    return DEFAULT_SLOTS.slice()
  })()

  const cached = readCached()
  const slot = currentSlot(now, slots)
  const slotMs = slot.getTime()
  const dispMs = slotMs + DISPLAY_DELAY_MINUTES * 60 * 1000
  const cacheFresh =
    cached &&
    cached.price != null &&
    cached.updatedTs != null &&
    cached.updatedTs >= slotMs
  const needFetch =
    !cached ||
    cached.price == null ||
    (isUpdateWindow(now, slots) && !cacheFresh)

  // 拉价阶段：还在整点 + 5 分钟之前、且缓存是旧的——去拉价，
  // 拉完下次跑在整点 + 5 分钟（取数）。
  // 取数阶段：已过整点 + 5 分钟，或缓存已是这个点的——
  // 只读缓存显示，下次跑在下一个整点。
  const isFetchPhase = needFetch && now.getTime() < dispMs
  const nextReload = isFetchPhase ? new Date(dispMs) : nextSlot(now, slots)

  // 先立刻显示缓存，保证小组件绝不空白。
  // 到点自动跑时如果拉价 hang 住（后台 setTimeout 不准、
  // AbortSignal 断不开 fetch），后面的 present 跑不到，
  // 小组件就直接不显示。先 present 一次缓存顶上，
  // 拉到了再 present 一次新价，拉不到也已经有内容了。
  if (cached && cached.price != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    // 缓存还新鲜就不用再拉了，直接返回
    if (!isFetchPhase) return
  }

  if (isFetchPhase && cached) {
    // 有缓存时先拉，拉不到就用缓存顶上
    try {
      const p = await withTimeout(
        (async () => {
          const cookie = await getCookie()
          return fetchPrice(cached.sku, cookie)
        })(),
        20000,
      )
      const d = new Date()
      const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
      const history: PriceEntry[] = Array.isArray(cached.history) ? cached.history.slice() : []
      const prevPrice = history.length > 0 ? history[history.length - 1].p : null
      const last = history.length > 0 ? history[history.length - 1] : null
      if (!last || last.p !== p || now.getTime() - last.t > 15 * 60 * 1000) {
        history.push({ t: now.getTime(), p })
      }
      const kept = history.slice(-30)
      const prices = kept.map((x) => x.p)
      const data: WidgetData = {
        ...cached,
        price: p,
        prevPrice,
        low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        history: kept,
        updatedAt: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        updatedTs: now.getTime(),
        lastTryTs: undefined,
        lastTryAt: undefined,
        fromCache: false,
        error: '',
      }
      saveCache(data)
      Widget.present(<WidgetView data={data} />, {
        reloadPolicy: {
          policy: 'after',
          date: nextReload,
        },
      })
      return
    } catch (e) {
      // 拉失败了就显示旧缓存，不报错、不转圈，
      // 但把“这次尝试过、没拉到”记下来，底行会显示
      // “15:00 更新失败”，下次就知道小组件到底跑没跑。
      try {
        const d = new Date()
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
        cached.lastTryTs = now.getTime()
        cached.lastTryAt = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        saveCache(cached)
      } catch (e2) {}
    }
  }

  if (cached && cached.price != null) {
    cached.fromCache = true
    Widget.present(<WidgetView data={cached} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    return
  }

  // 完全没有缓存（第一次用）：直接拉一次，拉不到就提示打开 App
  try {
    const sku = await getSku()
    const p = await withTimeout(
      (async () => {
        const cookie = await getCookie()
        return fetchPrice(sku, cookie)
      })(),
      20000,
    )
    const d = new Date()
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    const data: WidgetData = {
      name: '西昊豆包椅L1',
      sku,
      price: p,
      prevPrice: null,
      low: p,
      high: p,
      history: [{ t: now.getTime(), p }],
      updatedAt: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      updatedTs: now.getTime(),
      fromCache: false,
      error: '',
    }
    saveCache(data)
    Widget.present(<WidgetView data={data} />, {
      reloadPolicy: {
        policy: 'after',
        date: nextReload,
      },
    })
    return
  } catch (e) {}

  Widget.present(
    <ErrorView message="还没价格。打开一次 App，它会自动拉新价并刷新小组件。" />,
  )
})().catch(() => {
  // 兜底：入口任何地方抛错都不能让小组件空白。
  // 到点自动跑的那次最容易在外面抛错（前面只包了拉价那一段），
  // 一旦 Widget.present 没跑到，小组件就直接不显示。
  // 这里尽量显示缓存，实在没有就显示提示。
  try {
    const cached = readCached()
    if (cached && cached.price != null) {
      cached.fromCache = true
      Widget.present(<WidgetView data={cached} />, {
        reloadPolicy: {
          policy: 'after',
          date: nextSlot(new Date(), parseSlots('9,15,21')),
        },
      })
      return
    }
  } catch (e2) {}
  try {
    Widget.present(
      <ErrorView message="还没价格。打开一次 App，它会自动拉新价并刷新小组件。" />,
    )
  } catch (e3) {}
})
