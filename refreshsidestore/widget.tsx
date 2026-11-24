import { Text, VStack, Widget, modifiers } from 'scripting'
import { soonestDuo, type AppRecord } from './model'
import { WidgetView, type ManualSettings, type ManualState } from './view'
import { DEFAULT_BACKGROUNDS } from './appearance'

// SideStore / LiveContainer 证书到期倒计时（手动版，二合一马蹄圈）
//
// 自动读到期时间走不通：读真实证书要靠 RPP + Scripting 的 VPN API
// 建 RSD 隧道，而 VPN API 只有 Scripting TestFlight 3.2.2 版才有，
// App Store 最新版里没有，内测名额又拿不到。所以这里是手动记的：
//   在 SideStore 里点一次刷新续期，就到这个小组件的 App 里点一下
//   对应应用的「刚续期」，它就从现在起往后数 7 天（免费证书）或
//   365 天（付费证书），小组件就开始倒计时。也可以直接用日期选择
//   器，把 SideStore「我的应用」里显示的到期日填进来。
// 以后要是拿到了 TestFlight 3.2.2，换 RefreshSideStore 那个版本，
// 就能自动读了，配对记录已经做完了，不用重新配对。
//
// 显示：中号两个马蹄圈并排（左 SideStore、右 LiveContainer）；
// 小号只显示先到期的那个；只填了一个时，中号退回单圈 + 右侧列表。
//
// 数据存在 Storage 共享域 'ss_cert' 里（App 和小组件共用）：
//   { validityDays: 7, apps: [{ id, name, expiryTs }], updatedAt }
//   expiryTs 是到期那一刻的毫秒时间戳；没设过就是 null。
// 小组件每小时让系统跑一次（reloadPolicy after 下一个整点），
// 天数才能跟着变。

interface CertApp {
  id: string
  name: string
  expiryTs: number | null
}

interface CertData {
  validityDays: number
  apps: CertApp[]
  updatedAt?: number
}

function readData(): CertData | null {
  try {
    const v: any = Storage.get('ss_cert', { shared: true })
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

function nextHour(now: Date): Date {
  const d = new Date(now)
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return d
}

function ErrorView({ message }: { message: string }) {
  return (
    <VStack
      padding={14}
      frame={Widget.displaySize}
      modifiers={modifiers().widgetBackground('systemBackground')}
    >
      <Text font={14} fontWeight="bold" foregroundStyle="label">
        证书倒计时
      </Text>
      <Text font={12} foregroundStyle="secondaryLabel">
        {message}
      </Text>
    </VStack>
  )
}

// 主流程：只读缓存，不联网、不拉数据。
// 每小时让系统跑一次（reloadPolicy after 下一个整点），
// 天数才能跟着变。
;(async () => {
  const family = String((Widget as any).family || '')
  const { width: W, height: H } = Widget.displaySize
  const medium = family.includes('Medium') || family === 'medium' || (!family && W > H * 1.4)
  const now = Date.now()
  const data = readData()
  const apps: AppRecord[] = (data?.apps || [])
    .filter((a) => a.expiryTs != null)
    .map((a) => ({ name: a.name, bundleIdentifier: a.id, expiresAt: a.expiryTs as number }))
  if (apps.length > 0) {
    const first = soonestDuo(apps) ?? apps[0]
    const state: ManualState = {
      snapshot: { app: first, readAt: data?.updatedAt ?? now },
      apps,
      estimated: false,
    }
    const settings: ManualSettings = {
      totalDays: data?.validityDays || 7,
      lightBackground: DEFAULT_BACKGROUNDS.light,
      darkBackground: DEFAULT_BACKGROUNDS.dark,
    }
    Widget.present(<WidgetView state={state} settings={settings} now={now} medium={medium} />, {
      policy: 'after',
      date: nextHour(new Date()),
    } as any)
    return
  }
  Widget.present(
    <ErrorView message="还没设置到期时间。打开一次 App，点一下「刚续期」，小组件就开始倒计时。" />,
  )
})()
