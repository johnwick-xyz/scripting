// Loon 抓京东 Cookie（配合 Scripting 的京东价格监控、京东京豆小组件用）
// 拦截京东 App 的请求，把请求头里的 Cookie 存到 $persistentStore，
// 小组件会从 BoxJs 读这个 Cookie，不用在小组件里填账号密码。
// 用法：把这个文件传到 GitHub，拿到 raw 地址，填到
// Jd.lpx 的 script-path 里；Loon 里启用插件后，
// 打开京东 App 刷一次商品页，就会收到抓取成功的通知。
//
// 注意：通知只在 Cookie 变了的时候才弹一次，没变就不弹，
// 没提示不等于插件没工作。
//
// 拦哪些地址（见 Jd.lpx）：
//   p.3.cn / item.m.jd.com —— 查价的请求（原来就有的）
//   bean.m.jd.com —— 京豆明细页（京豆明细接口只认这个域发过去的 Cookie）
//   me-api.jd.com —— 京豆总数接口
//   api.m.jd.com/client.action —— 京东 App 的主接口，
//     京豆明细页新版可能走这里而不是 bean.m.jd.com，
//     所以也拦上，App 里随便刷刷就能抓到。

const KEY = 'jd_cookie'
const KEY_BOXJS = '@JD.cookie'

function ptKey(cookie) {
  const m = cookie.match(/(?:^|;\s*)pt_key=([^;]+)/)
  return m ? m[1] : ''
}

if (typeof $request !== 'undefined' && $request.headers) {
  const cookie = $request.headers.Cookie || $request.headers.cookie
  // 京东登录后的 Cookie 里一般有 pin= 或 thor=，只存这种，
  // 避免把没登录的空 Cookie 存进去
  if (
    cookie &&
    cookie.length > 20 &&
    (cookie.indexOf('pin=') > -1 || cookie.indexOf('thor=') > -1)
  ) {
    const old = $persistentStore.read(KEY) || ''
    // 别拿不完整的 Cookie 把好的盖掉：
    // 只有下面几种情况才存——
    //   没存过；换号/重新登录了（pt_key 变了）；
    //   新的更长（更完整）；旧的没有 thor=、新的有。
    const shouldSave =
      !old ||
      ptKey(cookie) !== ptKey(old) ||
      cookie.length > old.length ||
      (cookie.indexOf('thor=') > -1 && old.indexOf('thor=') === -1)
    if (shouldSave && old !== cookie) {
      $persistentStore.write(cookie, KEY)
      $persistentStore.write(cookie, KEY_BOXJS)
      $notification.post('京东 Cookie 已抓取', '', '小组件下次刷新就能用了')
    }
  }
}
$done({})
