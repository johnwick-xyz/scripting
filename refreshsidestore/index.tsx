import { Button, Color, ColorPicker, HStack, Image, Navigation, NavigationStack, Picker, ReorderableForEach, Script, Section, List, Text, TextField, VStack, useObservable, useState, Widget } from "scripting"
import { shortDate, type AppRecord, type AppSort } from "./model"
import { DEFAULT_BACKGROUNDS, normalizeBackground } from "./appearance"
import { getSettings, readWidgetState, saveRppApps, saveSettings, Settings, WidgetState } from "./runtime"
import { hasRppPairing, importRppPairingRecord, pairRppDevice, readExpiryViaRpp, rppHost, rppPort, saveRppHost, saveRppPort } from "./rpp-expiry"

function SettingsView({ initialState }: { initialState: WidgetState }) {
  const [settings, setSettings] = useState(getSettings)
  const [state, setState] = useState(initialState)
  function updateSettings(next: Settings) {
    saveSettings(next)
    setSettings(next)
    Widget.reloadAll()
  }

  async function setBackground(key: "lightBackground" | "darkBackground", value: Color) {
    try {
      const color = normalizeBackground(value)
      if (!color) throw new Error("无法读取所选颜色，请重新选择")
      updateSettings({ ...getSettings(), [key]: color })
    } catch (error) {
      await Dialog.alert({ title: "背景颜色", message: error instanceof Error ? error.message : "颜色保存失败" })
    }
  }

  const [busy, setBusy] = useState(false)
  // 正在配对时显示的六位码。13 mini 没有灵动岛，码直接显示在应用里，
  // 不用再去锁屏 / 灵动岛上找。
  const [pairPin, setPairPin] = useState('')
  // 配对过程的状态日志。原来传的是空回调，关键信息（广播发没发出去、
  // 后台保活开了没、等了多久）全丢了；现在显示出来，配对失败时才
  // 知道卡在哪一步。
  const [pairLog, setPairLog] = useState<string[]>([])
  const [host, setHost] = useState(rppHost)
  const [port, setPort] = useState(rppPort)
  const dragActive = useObservable<any>(null)

  function setAppSort(sort: AppSort) {
    const next = { ...settings, appSort: sort }
    updateSettings(next)
    void readWidgetState(next).then(setState)
  }

  function moveApp(indices: number[], newOffset: number) {
    const apps = [...(state.apps ?? [])]
    const from = indices[0]
    if (from === undefined || from < 0 || from >= apps.length) return
    const [moved] = apps.splice(from, 1)
    const destination = Math.max(0, Math.min(newOffset > from ? newOffset - 1 : newOffset, apps.length))
    apps.splice(destination, 0, moved)
    const next = { ...settings, appSort: "manual" as const, appOrder: apps.map(app => app.bundleIdentifier) }
    updateSettings(next)
    setState({ ...state, apps, snapshot: apps.length > 0 ? { app: apps[0], readAt: state.snapshot?.readAt ?? Date.now(), source: "RPP / Misagent" } : undefined })
  }

  async function perform(task: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await task() } catch (error) {
      await Dialog.alert({ title: "SideStore 小组件", message: error instanceof Error ? error.message : "操作失败" })
    } finally { setBusy(false) }
  }

  async function importPairing(fromClipboard: boolean) {
    await perform(async () => {
      let content: string | Uint8Array
      if (fromClipboard) {
        const text = await Pasteboard.getString()
        if (!text?.trim()) throw new Error("剪贴板为空。请先复制配对记录的 XML 或 JSON 内容。")
        content = text
      } else {
        const paths = await DocumentPicker.pickFiles({ types: ["public.data", "public.item"], allowsMultipleSelection: false })
        if (!paths?.length) return
        const raw: any = FileManager.readAsBytesSync(paths[0])
        content = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer)
      }
      const result = await importRppPairingRecord(content)
      setState(await readWidgetState(settings))
      await Dialog.alert({ title: "导入成功", message: `已导入 ${result.name} 的配对记录，现在可以读取实际到期时间。` })
    })
  }

  return <NavigationStack>
    <List navigationTitle="SideStore 小组件" navigationBarTitleDisplayMode="inline">
      <Section>
        <Button title="预览小号组件" systemImage="square" disabled={busy} action={() => perform(async () => { await Widget.preview({ family: "systemSmall" }) })} />
        <Button title="预览中号组件" systemImage="rectangle" disabled={busy} action={() => perform(async () => { await Widget.preview({ family: "systemMedium" }) })} />
      </Section>

      <Section header={<Text>基础信息</Text>} footer={<Text>小号马蹄圈显示 SideStore / LiveContainer 里先到期的那个；中号两个都装了就并排显示两个马蹄圈（左 SideStore、右 LiveContainer），只装一个时退回单圈 + 右侧列表。</Text>}>
        <Text font="headline">{state.snapshot?.app.name ?? "暂无扫描结果"}</Text>
        <Text foregroundStyle="secondaryLabel">{state.snapshot ? `到期 ${shortDate(state.snapshot.app.expiresAt)}` : "完成扫描后显示实际到期时间"}</Text>
        {state.snapshot ? <Text font="caption" foregroundStyle="secondaryLabel">上次扫描 {shortDate(state.snapshot.readAt)}</Text> : null}
        {state.error ? <Text font="caption" foregroundStyle="systemOrange">{state.error}</Text> : null}
        <Button title={busy ? "正在扫描…" : "扫描自签"} systemImage="antenna.radiowaves.left.and.right" disabled={busy} action={() => perform(async () => {
          const result = await readExpiryViaRpp(host, Number(port), () => {})
          saveRppApps(result.apps)
          setState(await readWidgetState(getSettings()))
          Widget.reloadAll()
          setPort(String(result.port))
          await Dialog.alert({ title: "扫描完成", message: `读取 ${result.profilesRead} 份描述文件；系统确认 ${result.installedApps} 个 App。\n已筛选出 ${result.apps.length} 个短期个人开发自签 App。\n使用端口：${result.port}` })
        })} />
        <Picker title="列表排序" value={settings.appSort} pickerStyle="segmented" onChanged={(value: unknown) => setAppSort(value === "manual" ? "manual" : value === "name" ? "name" : "expiry")}>
          <Text tag="manual">手动</Text>
          <Text tag="expiry">即将到期</Text>
          <Text tag="name">名称</Text>
        </Picker>
        <Text font="caption" foregroundStyle="secondaryLabel">选择“手动”后可拖动右侧手柄调整顺序；第一项即马蹄圈显示对象。</Text>
        <ReorderableForEach
          active={dragActive}
          data={(state.apps ?? []).map(app => ({ id: app.bundleIdentifier, app }))}
          onMove={moveApp}
          builder={({ id, app }: { id: string, app: AppRecord }, index) => <HStack key={id} spacing={8}>
            <Image systemName={index === 0 ? "gauge.with.dots.needle.67percent" : "app.fill"} foregroundStyle={index === 0 ? "systemGreen" : "secondaryLabel"} />
            <Text font="subheadline" lineLimit={1}>{app.name}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{app.bundleIdentifier}</Text>
            <Text font="caption" foregroundStyle={app.expiresAt <= Date.now() ? "systemRed" : "secondaryLabel"}>{shortDate(app.expiresAt)}</Text>
            <Image systemName="line.3.horizontal" foregroundStyle="tertiaryLabel" />
          </HStack>}
        />
      </Section>

      <Section header={<Text>底部背景渐变</Text>}>
        <ColorPicker title="明亮模式渐变色" value={settings.lightBackground} supportsOpacity={false}
          onChanged={value => setBackground("lightBackground", value)} />
        <ColorPicker title="暗黑模式渐变色" value={settings.darkBackground} supportsOpacity={false}
          onChanged={value => setBackground("darkBackground", value)} />
        <Button title="恢复默认渐变" disabled={busy} action={() => perform(async () => {
          updateSettings({ ...getSettings(), lightBackground: DEFAULT_BACKGROUNDS.light, darkBackground: DEFAULT_BACKGROUNDS.dark })
        })} />
      </Section>

      <Section header={<Text>① 隧道连接</Text>} footer={<Text>RemotePairing 端口优先尝试下方填写的值；也会通过 Bonjour 发现，并自动回退尝试 62554 和 49152。</Text>}>
        <TextField title="设备反射 IP" value={host} prompt="10.7.0.1" onChanged={(value: string) => { setHost(value); saveRppHost(value) }} />
        <TextField title="RemotePairing 端口" value={port} prompt="62554" onChanged={(value: string) => { setPort(value); saveRppPort(value) }} />
      </Section>

      {pairPin !== '' ? (
        <Section header={<Text>配对码（120 秒内有效，记下来去设置里输入）</Text>}>
          <VStack spacing={6}>
            <Text font={{ name: "Menlo", size: 44 }} fontWeight="bold" foregroundStyle="systemBlue">{pairPin}</Text>
            <Text foregroundStyle="secondaryLabel">去 设置 → 隐私与安全性 → 开发者模式 → 配对设备，选 RefreshSideStore，输入上面这六位数字。不用灵动岛，码就显示在这里。</Text>
          </VStack>
        </Section>
      ) : null}

      {pairLog.length > 0 ? (
        <Section header={<Text>配对状态</Text>}>
          {pairLog.map((line) => (
            <Text foregroundStyle="secondaryLabel">{line}</Text>
          ))}
        </Section>
      ) : null}

      <Section header={<Text>② 设备配对</Text>} footer={<Text>新配对：点击“设备配对”，配对码会直接大字显示在这个页面上（不用灵动岛，13 mini 也能用）；然后去 iOS「设置 → 隐私与安全性 → 开发者模式 → 配对设备」，选择 RefreshSideStore，输入这六位数字。已有配对记录可从文件或剪贴板导入，无需再次配对。{'\n'}如果设置里看不到 RefreshSideStore，先检查这三样：① 手机 Wi-Fi 要开着；② 设置 → 隐私与安全性 → 本地网络 里找到 Scripting，把开关打开（没开 Bonjour 发不出去；列表里没有 Scripting，说明它还没请求过权限，点一次配对、看到系统弹窗时点允许）；③ 点完配对等 5-10 秒再去设置里找，广播要几秒才出现。也可以先断开 VPN（LocalDevVPN / Loon）再配对，配对成功后再连。</Text>}>
        <HStack spacing={7}>
          <Image systemName={hasRppPairing() ? "checkmark.shield.fill" : "exclamationmark.shield.fill"}
            foregroundStyle={hasRppPairing() ? "systemGreen" : "systemRed"} />
          <Text foregroundStyle={hasRppPairing() ? "systemGreen" : "systemRed"} fontWeight="semibold">
            {hasRppPairing() ? "已有可用配对记录" : "尚未配对"}
          </Text>
        </HStack>
        <Button title={busy ? "正在配对…" : "设备配对（验证码显示在应用内）"} systemImage="iphone.gen3" disabled={busy} action={() => perform(async () => {
          try {
            setPairLog([])
            const paired = await pairRppDevice((msg) => setPairLog((prev) => [...prev.slice(-5), msg]), (pin) => setPairPin(pin))
            await Dialog.alert({ title: "配对成功", message: `已配对 ${paired.name}，现在可以读取实际到期时间。` })
            setState(await readWidgetState(settings))
          } finally {
            setPairPin('')
          }
        })} />
        <Button title="从文件导入配对记录" systemImage="doc.badge.plus" disabled={busy} action={() => { void importPairing(false) }} />
        <Button title="从剪贴板导入配对记录" systemImage="doc.on.clipboard" disabled={busy} action={() => { void importPairing(true) }} />
      </Section>

    </List>
  </NavigationStack>
}

async function run() {
  try {
    const settings = getSettings()
    const action = Script.queryParameters.action
    if (action === "sidestore" || action === "livecontainer") {
      const url = action === "sidestore" ? settings.sideStoreURL : settings.liveContainerURL
      if (!await Safari.openURL(url)) await Dialog.alert({ title: "打开失败", message: "请检查客户端 URL 设置" })
      Script.exit()
      return
    }
    // 权限被拒也不影响打开设置页，配对 / 扫描时再处理；原来这里一失败就整个退出了。
    try {
      await Script.requestAccess(["fileSystem", "vpn", "localDevVPN"])
    } catch {}
    await Navigation.present({ element: <SettingsView initialState={await readWidgetState(settings)} /> })
  } catch (error) {
    // 启动失败时把原因弹出来，而不是悄悄退回列表。
    const detail = error instanceof Error ? (error.stack || error.message) : String(error)
    await Dialog.alert({ title: "启动失败", message: detail.slice(0, 500) })
  } finally {
    Script.exit()
  }
}
run()
