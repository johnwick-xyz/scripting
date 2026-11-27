// NaixueSign.js
// 奈雪点单小程序每日自动签到（Loon cron 脚本，每天 9:00）
// 重放 NaixueGetAuth.js 抓到的签到请求（POST），请求头里的 Cookie 会换成最新抓到的。
// 没抓到过签到请求时，只通知一声，不报错退出。

const SIGN_REQ_KEY = 'naixue_sign_req';
const COOKIE_KEY = 'naixue_cookie';
const TOKEN_KEY = 'naixue_token';

function doneNotify(title, subtitle, body) {
  $notification.post(title, subtitle || '', body || '');
  $done();
}

const raw = $persistentStore.read(SIGN_REQ_KEY);
if (!raw) {
  doneNotify('奈雪签到', '还没抓到签到请求', '先在奈雪点单小程序里手动签到一次，抓到请求后明天 9:00 自动签');
  return;
}

let req;
try {
  req = JSON.parse(raw);
} catch (e) {
  doneNotify('奈雪签到失败', '存的签到请求解析失败', '重新在小程序里手动签到一次，让抓取脚本重新记录');
  return;
}

// 请求头：去掉逐跳头（Host / Content-Length / Connection 由系统自己填）；
// Cookie 用最新抓到的替换，Token 没有才补
const skip = ['host', 'content-length', 'connection', 'accept-encoding'];
const headers = {};
const srcHeaders = req.headers || {};
Object.keys(srcHeaders).forEach((k) => {
  if (skip.indexOf(k.toLowerCase()) !== -1) return;
  headers[k] = srcHeaders[k];
});
const latestCookie = $persistentStore.read(COOKIE_KEY);
if (latestCookie) headers['Cookie'] = latestCookie;
const token = $persistentStore.read(TOKEN_KEY);
if (token && !headers['Authorization'] && !headers['authorization']) headers['Authorization'] = token;

const opts = { url: req.url, headers: headers };
if (req.body) opts.body = req.body;
const method = (req.method || 'GET').toUpperCase();
const fn = method === 'POST' ? $httpClient.post : $httpClient.get;

fn(opts, (err, resp, data) => {
  if (err) { doneNotify('奈雪签到失败', '请求失败', String(err)); return; }
  const status = resp && resp.status;
  const text = data || '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON */ }

  if (parsed) {
    const flat = JSON.stringify(parsed);
    const msg = String(parsed.msg || parsed.message || (parsed.data && parsed.data.msg) || '');
    if (/已签到|already/i.test(flat)) { doneNotify('奈雪签到', '今日已签到', msg); return; }
    const code = parsed.code;
    const ok = code === 0 || code === 200 || code === '0' || code === '200' || parsed.success === true;
    if (ok) { doneNotify('奈雪签到成功', '', msg); return; }
    doneNotify('奈雪签到失败', 'HTTP ' + status, msg || flat.slice(0, 120));
    return;
  }

  // 非 JSON 响应：按状态码判断
  if (status === 200) { doneNotify('奈雪签到成功', '', text.length > 120 ? text.slice(0, 120) : text); return; }
  doneNotify('奈雪签到失败', 'HTTP ' + status, text.length > 120 ? text.slice(0, 120) : text);
});
