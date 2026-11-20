// Loon 抓联通 Cookie（配合 UnicomWidget.js 用）
// 拦截联通 App 的请求，把请求头里的 Cookie 存到 $persistentStore
// Widget 会从 BoxJs 读这个 Cookie，不用在 Widget 里填账号密码
// 安装：把这个文件放到 GitHub / Gitee 拿到 raw 地址，填到 Unicom.loonplugin 里

const KEY = 'unicom_cookie';
// 顺手也写一份 anker / BoxJs 用的 key，和 githubdulong 版用的 YaYa key，
// 三个小组件、三种读法都能读到
const KEY_BOXJS = '@ChinaUnicom.10010v4.cookie';
const KEY_YAYA = '@YaYa_10010.cookie';

if (typeof $request !== 'undefined' && $request.headers) {
  const cookie = $request.headers.Cookie || $request.headers.cookie;
  if (cookie && cookie.indexOf('JSESSIONID') > -1) {
    const old = $persistentStore.read(KEY);
    if (old !== cookie) {
      $persistentStore.write(cookie, KEY);
      $persistentStore.write(cookie, KEY_BOXJS);
      $persistentStore.write(cookie, KEY_YAYA);
      $notification.post('联通 Cookie 已抓取', '', '小组件下次刷新就能用了');
    }
  }
}
$done({});
