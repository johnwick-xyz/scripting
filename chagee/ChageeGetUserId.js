// ChageeGetUserId.js
// 霸王茶姬 userId 抓取（Loon http-response 脚本）
// 从签到 / 个人信息 / 订单列表接口的返回里找 userId，存在 Loon 本地给定时签到算签名用。
// 只在第一次抓到时通知一次。

const USERID_KEY = 'chagee_userid';

function findUserId(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const d = obj.data || obj;
  if (d.userId) return String(d.userId);
  if (d.user_id) return String(d.user_id);
  if (Array.isArray(d) && d[0] && d[0].userId) return String(d[0].userId);
  if (Array.isArray(d.list) && d.list[0] && d.list[0].userId) return String(d.list[0].userId);
  return '';
}

const body = ($response && $response.body) || '';
let uid = '';
try {
  uid = findUserId(JSON.parse(body));
} catch (e) { /* 非 JSON */ }
if (!uid) {
  const m = body.match(/"userId"\s*:\s*"?(\d+)"?/);
  if (m) uid = m[1];
}

if (uid) {
  const old = $persistentStore.read(USERID_KEY);
  if (old !== uid) {
    $persistentStore.write(uid, USERID_KEY);
    if (!old) $notification.post('霸王茶姬 userId 已抓取', '签到参数齐了', '');
  }
}

$done({});
