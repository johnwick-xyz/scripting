// Native, user-initiated Remote Pairing. It only creates a trust record; it never changes profiles or apps.
//
// 13 mini / 没有灵动岛的机型注意：配对码原来只显示在灵动岛实时活动里，
// 刘海屏手机切到设置里就看不到码，120 秒一到就超时失败。
// 所以这里多了一个 onPin 回调：码一生成就立刻交给调用方，调用方
// （设置页）直接在应用界面里大字显示，灵动岛只当作备选。
import { PairStore } from "../rpp/pairstore"
import { publishPairableHost, seesOwnPairableHost } from "../rpp/bonjour"
import { PairSetupHost, SocketPeer } from "../rpp/pairsetup"
import { createPairingSurface } from "../../live_activity"

export interface PairResult { name: string; udid: string }
export type Log = (message: string) => void

function deadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([work, timeout]).finally(() => { if (timer !== null) clearTimeout(timer) })
}

export async function nativePair(log: Log, onPin?: (pin: string) => void): Promise<PairResult> {
  const store = new PairStore()
  const identity = await store.identity()
  const signingKey = await store.signingKey(identity)
  const server = require("node:net").createServer()
  const surface = createPairingSurface()
  let published: Awaited<ReturnType<typeof publishPairableHost>> | null = null
  let socket: any = null
  let held = false
  let paired = false
  let name = ""
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen({ host: "0.0.0.0", port: 0 }, resolve)
    })
    const port = Number(server.address()?.port)
    if (!Number.isInteger(port) || port < 1) throw new Error("配对 TCP listener 未取得有效端口")
    const pin = Math.floor(100000 + Math.random() * 900000).toString()
    // 码一生成就交给调用方在应用内显示（13 mini 没有灵动岛，全靠这个）。
    // 灵动岛实时活动下面还会再起一份，有灵动岛的机型两边都能看到。
    try { onPin?.(pin) } catch {}
    const keeper: any = (globalThis as any).BackgroundKeeper
    if (keeper?.keepAlive) {
      try { held = Boolean(await keeper.keepAlive()); log(held ? "已开启后台保活，请前往系统设置配对" : "后台保活未开启，切换设置后配对可能中断") } catch {}
    }
    published = await publishPairableHost({
      info: { name: "RefreshSideStore", identifier: identity.identifier, model: "Mac17,7", altIrk: identity.altIrk },
      port, includePeerToPeer: true,
    })
    if (!await seesOwnPairableHost(identity.identifier, 2000)) log("Bonjour 自检没发现自己的广播：设置 → 开发者模式 → 配对设备里也不会出现 RefreshSideStore。先检查 设置 → 隐私与安全性 → 本地网络 里 Scripting 的开关是否打开、Wi-Fi 是否开着，仍继续等待 120 秒。")
    const activityError = await surface.start(pin)
    if (activityError) log(activityError)
    log(`配对码：${pin}。前往 设置 → 隐私与安全性 → 开发者模式 → 配对设备，选择 RefreshSideStore。`)
    const incoming = new Promise<any>((resolve, reject) => {
      server.once("connection", resolve)
      server.once("error", reject)
      server.once("close", () => reject(new Error("配对监听已关闭")))
    })
    socket = await deadline(incoming, 120000, "等待 iPhone 连接超时（120 秒）")
    await surface.prompt(pin)
    const host = new PairSetupHost({
      identity, signingKey, pin,
      deviceInfo: { name: "RefreshSideStore", model: "Mac17,7", udid: "" },
      onPin: code => { log(`设备请求输入配对码：${code}`); try { onPin?.(code) } catch {} },
      verifyDeviceSignature: true,
    })
    const outcome = await deadline(host.run(new SocketPeer(socket)), 90000, "配对验证超时（90 秒）")
    store.save(outcome.file)
    Storage.set("rpp.expiry.device.udid", outcome.device.udid)
    name = outcome.device.name || "iPhone"
    Storage.set("rpp.expiry.device.name", name)
    paired = true
    return { name, udid: outcome.device.udid }
  } finally {
    try { socket?.destroy() } catch {}
    try { published?.stop() } catch {}
    try { server.close() } catch {}
    await surface.finish(paired, name)
    if (held) try { await (globalThis as any).BackgroundKeeper?.stopKeepAlive() } catch {}
  }
}
