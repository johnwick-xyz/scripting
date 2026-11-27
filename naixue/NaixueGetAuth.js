// NaixueGetAuth.js
// 奈雪点单小程序凭证 + 签到请求抓取（Loon http-request 脚本）
// 配合 Naixue.lpx 使用。参考樱花佬 Sliverkiss 的 naixue.js：
//   域名 tm-web.pin-dao.cn，打开小程序 → 我的 → 签到页面，抓 Cookie（ck）。
// 抓两样东西：
//  1. 认证信息：请求头里的 Cookie / Authorization / token 类字段，存下来给每日签到用
//  2. 签到请求本身：URL 带 sign / checkin 字样的 POST 请求，把 URL+方法+请求头+请求体整个存下来，
//     定时脚本（NaixueSign.js）直接重放这个请求，不用知道接口细节
// 凭证只在第一次抓到时通知一次；签到请求每次变化都通知（手动签到一次就确认抓到了）

const COOKIE_KEY = 'naixue_cookie';
const TOKEN_KEY = 'naixue_token';
const SIGN_REQ_KEY = 'naixue_sign_req';   // POST 签到请求（定时重放用）
const SIGN_INFO_KEY = 'naixue_sign_info'; // GET 签到状态请求（仅记录，不重放）

function save(key, value, title, subtitle, notifyAlways) {
  if (!value) return false;
  const old = $persistentStore.read(key);
  if (old === value) return false;
  $persistentStore.write(value, key);
  if (notifyAlways || !old) $notification.post(title, subtitle || '', '');
  return true;
}

const url = $request.url || '';
const headers = $request.headers || {};
const method = ($request.method || 'GET').toUpperCase();

// 1. Cookie（Sliverkiss 说的 ck；打开「我的 / 签到页」时 base-userinfo 会带上它）
const cookie = headers['Cookie'] || headers['cookie'];
if (cookie) save(COOKIE_KEY, cookie, '奈雪 Cookie 已抓取', '每日签到能用了', false);

// 2. Token 类请求头
const token =
  headers['Authorization'] || headers['authorization'] ||
  headers['token'] || headers['Token'] ||
  headers['appToken'] || headers['apptoken'] ||
  headers['accessToken'] || headers['access-token'] || '';
if (token) save(TOKEN_KEY, token, '奈雪 Token 已抓取', '每日签到能用了', false);

// 3. 签到请求：URL 含 sign / checkin / check-in
if (/sign|check[-_]?in/i.test(url)) {
  const req = { url: url, method: method, headers: headers, body: $request.body || '' };
  const raw = JSON.stringify(req);
  if (method === 'POST') {
    save(SIGN_REQ_KEY, raw, '奈雪签到请求已记录', '明天 9:00 自动签到', true);
  } else {
    save(SIGN_INFO_KEY, raw, '奈雪签到状态请求已记录', '', true);
  }
}

$done({});
