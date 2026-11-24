// TrumpchiSign.js
// 广汽传祺每日自动签到（Loon cron 脚本，每天 9:00–9:45 之间随机签一次）
// Loon 的 cron 不支持随机时间，所以插件在 9:00–9:45 每 5 分钟触发一次，
// 脚本在当天第一次跑时抽一个目标时间（9:00 + 0~45 分钟），到了那个时间
// 才真正签到；一天最多签一次，失败了在 9:45 之前每个触发点都会重试。
// 重放 TrumpchiGetAuth.js 抓到的签到请求（POST），请求头里的 Cookie 会换成最新抓到的。
// 没抓到过签到请求时，只通知一声，不报错退出。

const SIGN_REQ_KEY = 'trumpchi_sign_req';
const COOKIE_KEY = 'trumpchi_cookie';
const TOKEN_KEY = 'trumpchi_token';
const SIGN_DATE_KEY = 'trumpchi_sign_date';
const TARGET_KEY = 'trumpchi_sign_target';

function doneNotify(title, subtitle, body) {
  $notification.post(title, subtitle || '', body || '');
  $done();
}

function todayStr(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

const now = new Date();
const today = todayStr(now);

// 今天已经签过就直接退出，不打扰
if ($persistentStore.read(SIGN_DATE_KEY) === today) {
  $done();
  return;
}

// 当天第一次跑时抽一个目标时间：9:00 + 0~45 分钟，之后每次跑都按这个时间判断
let target = 0;
try {
  const saved = JSON.parse($persistentStore.read(TARGET_KEY) || 'null');
  if (saved && saved.date === today && saved.ts) target = saved.ts;
} catch (e) {}
if (!target) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0, 0).getTime();
  target = base + Math.floor(Math.random() * 45 * 60 * 1000);
  $persistentStore.write(JSON.stringify({ date: today, ts: target }), TARGET_KEY);
}

// 还没到抽中的时间就退出，等下一个 5 分钟的触发点
if (now.getTime() < target) {
  $done();
  return;
}

function markSigned() {
  $persistentStore.write(today, SIGN_DATE_KEY);
}

// 失败了先不报，等下一个触发点重试；9:45 是最后一个触发点，再失败才通知
function failNotify(title, subtitle, body) {
  if (now.getHours() === 9 && now.getMinutes() >= 45) {
    doneNotify(title, subtitle, body);
  } else {
    $done();
  }
}

const raw = $persistentStore.read(SIGN_REQ_KEY);
if (!raw) {
  doneNotify('传祺签到', '还没抓到签到请求', '先在传祺 App 里手动签到一次，抓到请求后明天 9:00–9:45 之间随机签');
  return;
}

let req;
try {
  req = JSON.parse(raw);
} catch (e) {
  doneNotify('传祺签到失败', '存的签到请求解析失败', '重新在 App 里手动签到一次，让抓取脚本重新记录');
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
  if (err) { failNotify('传祺签到失败', '请求失败', String(err)); return; }
  const status = resp && resp.status;
  const text = data || '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON */ }

  if (parsed) {
    const flat = JSON.stringify(parsed);
    const msg = String(parsed.msg || parsed.message || (parsed.data && parsed.data.msg) || '');
    if (/已签到|already/i.test(flat)) { markSigned(); doneNotify('传祺签到', '今日已签到', msg); return; }
    const code = parsed.code;
    const ok = code === 0 || code === 200 || code === '0' || code === '200' || parsed.success === true;
    if (ok) { markSigned(); doneNotify('传祺签到成功', '', msg); return; }
    failNotify('传祺签到失败', 'HTTP ' + status, msg || flat.slice(0, 120));
    return;
  }

  // 非 JSON 响应：按状态码判断
  if (status === 200) { markSigned(); doneNotify('传祺签到成功', '', text.length > 120 ? text.slice(0, 120) : text); return; }
  failNotify('传祺签到失败', 'HTTP ' + status, text.length > 120 ? text.slice(0, 120) : text);
});
