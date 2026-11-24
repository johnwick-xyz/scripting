// ChageeGetAuth.js
// 霸王茶姬小程序凭证 + 签到参数抓取（Loon http-request 脚本）
// 抓三样东西，存在 Loon 本地：
//  1. qm-user-token 请求头（登录凭证）-> chagee_token
//  2. Cookie（acw_tc / acw_sc__v2 风控 Cookie，有的话一起存）-> chagee_cookie
//  3. 签到请求里的 activityId / appid / storeId / 域名 -> chagee_sign_params
//     （签名带时间戳会过期，定时脚本每天现算签名，只需要这些不变的参数）
// 凭证只在第一次抓到时通知一次；签到参数每次变化都通知。

const TOKEN_KEY = 'chagee_token';
const COOKIE_KEY = 'chagee_cookie';
const PARAMS_KEY = 'chagee_sign_params';

function save(key, value, title, subtitle, notifyAlways) {
  if (!value) return false;
  const old = $persistentStore.read(key);
  if (old === value) return false;
  $persistentStore.write(value, key);
  if (notifyAlways || !old) $notification.post(title, subtitle || '', '');
  return true;
}

function parseForm(body) {
  const out = {};
  (body || '').split('&').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    try { out[decodeURIComponent(pair.slice(0, idx))] = decodeURIComponent(pair.slice(idx + 1)); } catch (e) {}
  });
  return out;
}

const url = $request.url || '';
const headers = $request.headers || {};

// 1. qm-user-token（大小写两种都试）
const token = headers['qm-user-token'] || headers['Qm-User-Token'] || headers['QM-USER-TOKEN'] || '';
if (token) save(TOKEN_KEY, token, '霸王茶姬 Token 已抓取', '每日签到能用了', false);

// 2. Cookie（acw_tc / acw_sc__v2 风控 Cookie 也在里面）
const cookie = headers['Cookie'] || headers['cookie'] || '';
if (cookie && /acw_|qm-user-token/i.test(cookie)) {
  save(COOKIE_KEY, cookie, '霸王茶姬 Cookie 已抓取', '', false);
} else if (cookie) {
  save(COOKIE_KEY, cookie, '', '', false);
}

// 3. 签到请求：记下域名 + activityId / appid / storeId
if (/\/web\/cmk-center\/sign\/takePartInSign/.test(url)) {
  const m = url.match(/^https?:\/\/([^\/]+)/);
  const host = m ? m[1] : '';
  const body = parseForm($request.body || '');
  const params = {
    host: host,
    activityId: body.activityId || '',
    appid: body.appid || '',
    storeId: body.storeId ? parseInt(body.storeId, 10) : 0
  };
  if (params.activityId || params.host) {
    save(PARAMS_KEY, JSON.stringify(params), '霸王茶姬签到请求已记录', '明天 8:00 自动签到', true);
  }
}

$done({});
