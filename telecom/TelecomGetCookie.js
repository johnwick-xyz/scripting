// Loon 抓中国电信 Cookie（配合 Scripting 的中国电信小组件用）
// 拦截中国电信 App 调 e.dlife.cn 的请求，把请求头里的 Cookie
// 存到 $persistentStore，小组件会从 BoxJs 读这个 Cookie，
// 不用在小组件里填账号密码。
// 用法：把这个文件传到 GitHub，拿到 raw 地址，填到
// Telecom.lpx 的 script-path 里；Loon 里启用插件后，
// 打开中国电信 App 刷一次首页或套餐页，就会收到抓取成功的通知。

const KEY = 'telecom_cookie'
const KEY_BOXJS = '@ChinaTelecom.10000.cookie'

if (typeof $request !== 'undefined' && $request.headers) {
  // 登录跳转 loginMiddle 由 TelecomGetLoginUrl.js 处理，这里跳过，
  // 免得登录前的 Cookie 盖掉已抓到的好 Cookie
  if ($request.url && $request.url.indexOf('/user/loginMiddle') !== -1) {
    $done({})
  } else {
    const cookie = $request.headers.Cookie || $request.headers.cookie
    if (cookie && cookie.length > 20) {
      const old = $persistentStore.read(KEY)
      if (old !== cookie) {
        $persistentStore.write(cookie, KEY)
        $persistentStore.write(cookie, KEY_BOXJS)
        $notification.post('电信 Cookie 已抓取', '', '小组件下次刷新就能用了')
      }
    }
    $done({})
  }
} else {
  $done({})
}
