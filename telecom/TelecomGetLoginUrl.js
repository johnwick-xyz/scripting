// Loon 抓中国电信登录地址（配合 Scripting 的中国电信小组件用）
// 拦截 e.dlife.cn 登录跳转 loginMiddle，把登录地址（去掉 &sign 之后的部分）
// 存到 $persistentStore，小组件每次刷新用它换一个新的 Cookie，不用再抓 Cookie，
// 也不怕 Cookie 过期。
// 用法：装好 Telecom.lpx 后，打开 https://e.dlife.cn/index.do 登录一次，
// 跳转经过 loginMiddle 时就会收到“电信登录地址已获取”的通知。
// 办法来自 GitHub 上 anker 的 ChinaTelecom 脚本和 dompling 的 10000/index.js：
// anker 的小组件就是拿这个登录地址去换 Set-Cookie 的，不直接存 Cookie。

const KEY = 'telecom_login_url'
const KEY_BOXJS = '@ChinaTelecom.10000.loginUrl'

if (typeof $request !== 'undefined' && $request.url) {
  const url = $request.url
  if (url.indexOf('https://e.dlife.cn/user/loginMiddle') !== -1) {
    const m = url.match(/(http.+)&sign/)
    const loginUrl = m ? m[1] : url
    const old = $persistentStore.read(KEY)
    if (old !== loginUrl) {
      $persistentStore.write(loginUrl, KEY)
      $persistentStore.write(loginUrl, KEY_BOXJS)
      $notification.post('电信登录地址已获取', '', '小组件下次刷新就能用了')
    }
  }
}
$done({})
