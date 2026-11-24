// ChageeSign.js
// 霸王茶姬小程序每日自动签到（Loon cron 脚本，每天 8:00）
// 注意：签到请求的 signature 带时间戳，十几分钟就过期，所以不能像亚朵/传祺那样原样重放，
// 每天签到时必须用新时间戳重新算签名。这里按公开的算法现场算：
//   query = activityId={id}&sellerId={storeId}&timestamp={ts}&userId={uid}&key={activityId反转}
//   signature = MD5(query) 大写
// 凭证（qm-user-token、userId、签到参数）由 ChageeGetAuth.js / ChageeGetUserId.js 抓取后存在本地。

const TOKEN_KEY = 'chagee_token';
const USERID_KEY = 'chagee_userid';
const COOKIE_KEY = 'chagee_cookie';
const PARAMS_KEY = 'chagee_sign_params';

const DEFAULT_ACTIVITY = '947079313798000641';
const DEFAULT_APPID = 'wxafec6f8422cb357b';
const DEFAULT_STORE = 49006;
const HOSTS = ['webapi2.qmai.cn', 'webapi.qmai.cn', 'miniapp.qmai.cn'];
const UA = 'Mozilla/5.0 (Linux; Android 14; 2201122C Build/UKQ1.230917.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20231202 MMWEBID/2247 MicroMessenger/8.0.47.2560(0x28002F30) WeChat/arm64 Weixin NetType/5G Language/zh_CN ABI/arm64 MiniProgramEnv/android';

// ---- MD5（纯 JS 实现，K 常量按标准由 sin 算出）----
function md5(input) {
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(x, y) {
    const l = (x & 0xffff) + (y & 0xffff);
    const m = (x >> 16) + (y >> 16) + (l >> 16);
    return (m << 16) | (l & 0xffff);
  }
  function ff(a, b, c, d, x, s, t) { return add(rl(add(add(a, (b & c) | (~b & d)), add(x, t)), s), b); }
  function gg(a, b, c, d, x, s, t) { return add(rl(add(add(a, (b & d) | (c & ~d)), add(x, t)), s), b); }
  function hh(a, b, c, d, x, s, t) { return add(rl(add(add(a, b ^ c ^ d), add(x, t)), s), b); }
  function ii(a, b, c, d, x, s, t) { return add(rl(add(add(a, c ^ (b | ~d)), add(x, t)), s), b); }
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K.push(Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  // UTF-8 编码 + 填充
  const bytes = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) { bytes.push((c >> 6) | 192, (c & 63) | 128); }
    else { bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < bytes.length; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) M.push(bytes[off + i * 4] | (bytes[off + i * 4 + 1] << 8) | (bytes[off + i * 4 + 2] << 16) | (bytes[off + i * 4 + 3] << 24));
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F;
      if (i < 16) { F = ff(A, B, C, D, M[i], S[i], K[i]); }
      else if (i < 32) { F = gg(A, B, C, D, M[(5 * i + 1) % 16], S[i], K[i]); }
      else if (i < 48) { F = hh(A, B, C, D, M[(3 * i + 5) % 16], S[i], K[i]); }
      else { F = ii(A, B, C, D, M[(7 * i) % 16], S[i], K[i]); }
      // F 已含 +B（标准轮函数返回值即新 B），轮转：A=D, B=F, C=B, D=C
      const tmp = D; D = C; C = B; B = F; A = tmp;
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  function hex(n) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      const b = (n >> (i * 8)) & 0xff;
      s += ('0' + b.toString(16)).slice(-2);
    }
    return s;
  }
  return (hex(a0) + hex(b0) + hex(c0) + hex(d0)).toUpperCase();
}

function doneNotify(title, subtitle, body) {
  $notification.post(title, subtitle || '', body || '');
  $done();
}

function findUserId(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const d = obj.data || obj;
  if (d.userId) return String(d.userId);
  if (d.user_id) return String(d.user_id);
  if (Array.isArray(d) && d[0] && d[0].userId) return String(d[0].userId);
  if (Array.isArray(d.list) && d.list[0] && d.list[0].userId) return String(d.list[0].userId);
  return '';
}

function buildSignature(activityId, storeId, timestamp, userId) {
  const reversed = activityId.split('').reverse().join('');
  const q = 'activityId=' + activityId + '&sellerId=' + storeId + '&timestamp=' + timestamp + '&userId=' + userId + '&key=' + reversed;
  return md5(q);
}

function postForm(url, headers, body, cb) {
  $httpClient.post({ url: url, headers: headers, body: body }, function (err, resp, data) {
    cb(err, resp, data || '');
  });
}

function getJson(url, headers, cb) {
  $httpClient.get({ url: url, headers: headers }, function (err, resp, data) {
    if (err) return cb(err);
    try { cb(null, JSON.parse(data || '')); } catch (e) { cb(new Error('非JSON')); }
  });
}

const token = $persistentStore.read(TOKEN_KEY);
if (!token) {
  doneNotify('霸王茶姬签到', '还没抓到凭证', '先打开微信霸王茶姬小程序，点一次签到，抓到 qm-user-token 后明天 8:00 自动签');
  return;
}

let params = {};
try { params = JSON.parse($persistentStore.read(PARAMS_KEY) || '{}'); } catch (e) { params = {}; }
const activityId = params.activityId || DEFAULT_ACTIVITY;
const appid = params.appid || DEFAULT_APPID;
const storeId = params.storeId || DEFAULT_STORE;

const hosts = [];
if (params.host) hosts.push(params.host);
HOSTS.forEach(function (h) { if (hosts.indexOf(h) === -1) hosts.push(h); });

const cookie = $persistentStore.read(COOKIE_KEY) || '';
const baseHeaders = { 'qm-user-token': token, 'qm-from': 'wechat', 'User-Agent': UA };
if (cookie) baseHeaders['Cookie'] = cookie;

// 1. 先校验登录，顺便补 userId
let userId = $persistentStore.read(USERID_KEY) || '';
function checkLogin(host, cb) {
  getJson('https://' + host + '/web/catering/crm/personal-info', baseHeaders, function (err, j) {
    if (err) return cb(false, '');
    if (j && j.message === 'ok') return cb(true, findUserId(j));
    cb(false, findUserId(j));
  });
}

function tryHosts(i, cb) {
  if (i >= hosts.length) return cb(false);
  checkLogin(hosts[i], function (ok, uid) {
    if (uid) { userId = uid; $persistentStore.write(uid, USERID_KEY); }
    if (ok) return cb(true, hosts[i]);
    tryHosts(i + 1, cb);
  });
}

tryHosts(0, function (loginOk, host) {
  if (!loginOk) {
    doneNotify('霸王茶姬签到失败', '登录已过期', '重新打开微信霸王茶姬小程序点一次签到，凭证更新后明天恢复');
    return;
  }
  if (!userId) {
    doneNotify('霸王茶姬签到失败', '没拿到 userId', '打开小程序点一下「取茶」或订单页，再手动签到一次，让插件抓到 userId');
    return;
  }

  // 2. 逐个 host 尝试签到（每个 host 都用新时间戳重新算签名）
  function attempt(i) {
    if (i >= hosts.length) {
      doneNotify('霸王茶姬签到失败', '三个域名都试过了', '把通知里的失败信息发我，我再看是不是接口又改了');
      return;
    }
    const h = hosts[i];
    const timestamp = String(Date.now());
    const signature = buildSignature(activityId, storeId, timestamp, userId);
    const body = 'activityId=' + encodeURIComponent(activityId) +
      '&appid=' + encodeURIComponent(appid) +
      '&timestamp=' + encodeURIComponent(timestamp) +
      '&signature=' + encodeURIComponent(signature) +
      '&storeId=' + encodeURIComponent(String(storeId));
    const headers = Object.assign({}, baseHeaders, { 'Content-Type': 'application/x-www-form-urlencoded' });
    postForm('https://' + h + '/web/cmk-center/sign/takePartInSign', headers, body, function (err, resp, data) {
      if (err) { attempt(i + 1); return; }
      let j = null;
      try { j = JSON.parse(data); } catch (e) { /* 非 JSON，可能是风控页 */ }
      if (!j) { attempt(i + 1); return; }
      const msg = String(j.message || '');
      if (msg === 'ok') {
        let reward = '';
        try {
          const r = j.data && j.data.rewardDetailList && j.data.rewardDetailList[0];
          if (r) reward = r.rewardName + ' x' + r.sendNum;
        } catch (e) {}
        doneNotify('霸王茶姬签到成功', reward, '域名：' + h);
        return;
      }
      if (/已签到/.test(msg)) { doneNotify('霸王茶姬签到', '今日已签到', '域名：' + h); return; }
      // 业务失败（业务繁忙/签名不对等），换下一个域名再试
      if (i + 1 < hosts.length) { attempt(i + 1); return; }
      doneNotify('霸王茶姬签到失败', msg || ('HTTP ' + (resp && resp.status)), '域名：' + h + '，把这条发我');
    });
  }
  attempt(hosts.indexOf(host) === -1 ? 0 : hosts.indexOf(host));
});
