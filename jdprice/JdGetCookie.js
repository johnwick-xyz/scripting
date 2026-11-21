// Loon 抓京东 Cookie（配合 Scripting 的京东价格监控小组件用）
// 拦截京东 App 调 p.3.cn / item.m.jd.com 的请求，把请求头里的
// Cookie 存到 $persistentStore，小组件会从 BoxJs 读这个 Cookie，
// 不用在小组件里填账号密码。
// 用法：把这个文件传到 GitHub，拿到 raw 地址，填到
// Jd.lpx 的 script-path 里；Loon 里启用插件后，
// 打开京东 App 刷一次商品页，就会收到抓取成功的通知。

const KEY = 'jd_cookie'
const KEY_BOXJS = '@JD.cookie'

if (typeof $request !== 'undefined' && $request.headers) {
  const cookie = $request.headers.Cookie || $request.headers.cookie
  // 京东登录后的 Cookie 里一般有 pin= 或 thor=，只存这种，
  // 避免把没登录的空 Cookie 存进去
  if (
    cookie &&
    cookie.length > 20 &&
    (cookie.indexOf('pin=') > -1 || cookie.indexOf('thor=') > -1)
  ) {
    const old = $persistentStore.read(KEY)
    if (old !== cookie) {
      $persistentStore.write(cookie, KEY)
      $persistentStore.write(cookie, KEY_BOXJS)
      $notification.post('京东 Cookie 已抓取', '', '小组件下次刷新就能用了')
    }
  }
}
$done({})
