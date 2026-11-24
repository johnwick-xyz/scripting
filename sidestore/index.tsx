import {
  Button,
  DatePicker,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Notification,
  Path,
  Script,
  Section,
  Text,
  TextField,
  Widget,
  useEffect,
  useState,
} from 'scripting'

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const cachePath = Path.join(root, 'cache.json')

const DAY_MS = 24 * 3600 * 1000

interface CertApp {
  id: string
  name: string
  expiryTs: number | null
}

function defaultApps(): CertApp[] {
  return [
    { id: 'sidestore', name: 'SideStore', expiryTs: null },
    { id: 'livecontainer', name: 'LiveContainer', expiryTs: null },
  ]
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function remainingText(app: CertApp): string {
  if (app.expiryTs == null) return '还没设置'
  const ms = app.expiryTs - Date.now()
  if (ms <= 0) return `已过期 ${Math.floor(-ms / DAY_MS)} 天`
  const days = Math.floor(ms / DAY_MS)
  const hours = Math.floor((ms % DAY_MS) / 3600000)
  if (days > 0) return `还剩 ${days} 天 ${hours} 小时`
  return `还剩 ${hours} 小时`
}

function saveData(validityDays: number, apps: CertApp[]) {
  const data = { validityDays, apps, updatedAt: Date.now() }
  try {
    Storage.set('ss_cert', data, { shared: true })
  } catch (e) {}
  try {
    if (!FileManager.existsSync(root)) FileManager.createDirectorySync(root, true)
    FileManager.writeAsStringSync(cachePath, JSON.stringify(data))
  } catch (e) {}
  Widget.reloadAll()
}

// 到期前 1 天发一条本地通知，免得忘了续期。每次保存都先清掉旧的再重排，
// 这样改了日期也不会收到两条。返回是否全部排上了（没给通知权限会失败）。
async function scheduleReminders(apps: CertApp[]): Promise<boolean> {
  try {
    await Notification.removeAllPendingsOfCurrentScript()
  } catch (e) {}
  const now = Date.now()
  const upcoming = apps.filter((a) => a.expiryTs != null && (a.expiryTs as number) > now)
  if (upcoming.length === 0) return true
  let allOk = true
  for (const app of upcoming) {
    const fireAt = (app.expiryTs as number) - DAY_MS
    const delaySec = Math.max(60, Math.floor((fireAt - now) / 1000))
    try {
      const ok = await Notification.schedule({
        title: '证书快到期了',
        body: `${app.name} 的证书明天到期，记得在 SideStore 里续期，然后回来点一下「刚续期」。`,
        threadIdentifier: 'ss_cert',
        trigger: { timeInterval: delaySec, repeats: false } as any,
      })
      if (!ok) allOk = false
    } catch (e) {
      allOk = false
    }
  }
  return allOk
}

function App() {
  const [loaded, setLoaded] = useState(false)
  const [validityDays, setValidityDays] = useState<number>(7)
  const [apps, setApps] = useState<CertApp[]>(defaultApps())
  const [newName, setNewName] = useState<string>('')
  const [reminderOk, setReminderOk] = useState<boolean | null>(null)

  useEffect(() => {
    let data: any = null
    try {
      const v: any = Storage.get('ss_cert', { shared: true })
      if (v) data = typeof v === 'string' ? JSON.parse(v) : v
    } catch (e) {}
    if (!data && FileManager.existsSync(cachePath)) {
      try {
        data = JSON.parse(FileManager.readAsStringSync(cachePath) || '{}')
      } catch (e) {}
    }
    if (data) {
      if (typeof data.validityDays === 'number') setValidityDays(data.validityDays)
      if (Array.isArray(data.apps) && data.apps.length > 0) setApps(data.apps)
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    saveData(validityDays, apps)
  }, [validityDays, apps, loaded])

  // 日期改完 1.5 秒后再排提醒（防抖：拖日期选择器时不会反复排）。
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => {
      void scheduleReminders(apps).then(setReminderOk)
    }, 1500)
    return () => clearTimeout(t)
  }, [apps, loaded])

  function renew(id: string) {
    const now = Date.now()
    setApps(apps.map((a) => (a.id === id ? { ...a, expiryTs: now + validityDays * DAY_MS } : a)))
  }

  function setExpiry(id: string, ts: number) {
    setApps(apps.map((a) => (a.id === id ? { ...a, expiryTs: ts } : a)))
  }

  function removeApp(id: string) {
    if (apps.length <= 1) return
    setApps(apps.filter((a) => a.id !== id))
  }

  function addApp() {
    const name = newName.trim()
    if (!name) return
    setApps([...apps, { id: 'app_' + Date.now(), name, expiryTs: null }])
    setNewName('')
  }

  return (
    <NavigationStack>
      <List navigationTitle="证书倒计时">
        <Section header={<Text>证书有效期</Text>}>
          <HStack>
            <Text>免费 Apple ID 证书是 7 天，付费开发者账号是 1 年。续期按钮按这个天数往后数。</Text>
          </HStack>
          <HStack>
            <Button
              title={validityDays === 7 ? '● 免费 7 天' : '免费 7 天'}
              action={() => setValidityDays(7)}
            />
            <Button
              title={validityDays === 365 ? '● 付费 1 年' : '付费 1 年'}
              action={() => setValidityDays(365)}
            />
          </HStack>
        </Section>
        {apps.map((app) => (
          <Section header={<Text>{app.name}</Text>}>
            <HStack>
              <Text>{remainingText(app)}</Text>
              <Text foregroundStyle="secondaryLabel">
                {app.expiryTs != null ? `${fmtDate(app.expiryTs)} 到期` : ''}
              </Text>
            </HStack>
            <DatePicker
              title="到期时间"
              displayedComponents={['date', 'hourAndMinute']}
              value={app.expiryTs != null ? app.expiryTs : Date.now() + validityDays * DAY_MS}
              onChanged={(v: number) => setExpiry(app.id, v)}
            />
            {app.expiryTs != null && app.expiryTs <= Date.now() ? (
              <Text foregroundStyle="systemRed">这个日期已经过了，检查一下是不是选错了。</Text>
            ) : null}
            {app.expiryTs != null && app.expiryTs > Date.now() + (validityDays + 1) * DAY_MS ? (
              <Text foregroundStyle="systemRed">
                证书最长 {validityDays} 天，这个日期超出有效期了，检查一下是不是选错了。
              </Text>
            ) : null}
            <HStack>
              <Button title="刚续期" action={() => renew(app.id)} />
              <Button title="删除" action={() => removeApp(app.id)} />
            </HStack>
          </Section>
        ))}
        <Section header={<Text>到期提醒</Text>}>
          <Text foregroundStyle="secondaryLabel">
            {reminderOk === true
              ? '已设置：每个应用到期前 1 天会发通知提醒续期，点通知就回到这个页面。'
              : reminderOk === false
                ? '提醒没设置上：请在 iOS 设置 → Scripting → 通知里允许通知，再回来改一下日期。'
                : '填好到期日后，这里会帮你排一个到期前 1 天的提醒。'}
          </Text>
        </Section>
        <Section header={<Text>添加应用</Text>}>
          <HStack>
            <TextField title="应用名字" value={newName} onChanged={setNewName} />
            <Button title="添加" action={() => addApp()} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            比如再装了一个 StikDebug，或者别的侧载 App，都可以加进来单独倒计时。
          </Text>
        </Section>
        <Section header={<Text>怎么用</Text>}>
          <Text foregroundStyle="secondaryLabel">
            在 SideStore 里点一次刷新续期，就到这里点一下对应应用的「刚续期」，到期时间就从现在起往后数 {validityDays} 天，小组件就开始倒计时。也可以直接用上面的日期选择器，把 SideStore「我的应用」里显示的到期日填进来（点开应用就能看到；或者去设置 → 通用 → VPN 与设备管理 → 描述文件里看到期日）。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            怕忘的话不用操心：填好到期日后，到期前 1 天会自动发一条通知提醒你续期（上面「到期提醒」会显示有没有排上）。填错了也有提示：日期已经过了、或者超出证书最长有效期，都会红字标出来。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            注意：Scripting 读不到 SideStore 自己的数据（iOS 沙盒隔离，SideStore 也没有公开接口给外面查），所以续期后要手动点一下这里，不然倒计时不会自己变。自动读要靠 Scripting 的 VPN API，只有 TestFlight 3.2.2 版才有，App Store 版里没有，内测名额也拿不到，所以先用手动记的。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            小号马蹄圈显示 SideStore / LiveContainer 里先到期的那个；中号两个都填了就并排显示两个马蹄圈（左 SideStore、右 LiveContainer），只填一个时退回单圈 + 右侧列表。
          </Text>
        </Section>
        <Section>
          <Button title="预览小组件" action={() => Widget.preview()} />
          <Button
            title="清空全部"
            action={() => {
              try {
                Storage.remove('ss_cert', { shared: true })
              } catch (e) {}
              if (FileManager.existsSync(cachePath)) {
                FileManager.removeItemSync(cachePath)
              }
              try {
                void Notification.removeAllPendingsOfCurrentScript().catch(() => {})
              } catch (e) {}
              setValidityDays(7)
              setApps(defaultApps())
              setReminderOk(null)
              Widget.reloadAll()
            }}
          />
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
