# 霸王茶姬小程序签到（Loon）

每天 8:00 自动签到一次。霸王茶姬的签到有签名校验，签名带时间戳，十几分钟就过期，
所以这个插件**不是原样重放**抓到的请求，而是每天用新时间戳现场算一个新签名再签到。

签名算法（2024 年公开的分析，已验证签名值能对上）：
`query = activityId=…&sellerId=…&timestamp=…&userId=…&key=activityId反转`，
`signature = MD5(query)` 大写。接口：`POST https://webapi2.qmai.cn/web/cmk-center/sign/takePartInSign`，
请求头带 `qm-user-token`。

## 文件

- `Chagee.lpx` — Loon 插件：抓取凭证 + 每天 8:00 定时签到
- `ChageeGetAuth.js` — 抓取脚本：存 `qm-user-token`、Cookie（风控 Cookie 也在里面）、签到参数（域名/activityId/appid/storeId）
- `ChageeGetUserId.js` — 抓取脚本：从签到/个人信息/订单接口的返回里找 userId
- `ChageeSign.js` — 定时签到脚本：先校验登录，再用新时间戳 + 新签名签到，三个域名轮着试（webapi2 → webapi → miniapp）
- `README.md` — 本文件

## 安装

1. 把这 4 个脚本文件（`Chagee.lpx`、`ChageeGetAuth.js`、`ChageeGetUserId.js`、`ChageeSign.js`）传到 GitHub `johnwick-xyz/scripting` 的新文件夹 `chagee/` 里。
2. Loon → 插件 → 右上角 + → 从 URL 添加，填：
   `https://raw.githubusercontent.com/johnwick-xyz/scripting/main/chagee/Chagee.lpx`
3. 确认插件已开启，Loon 保持开启。Loon 的 MITM 证书要装好并信任，否则抓不到小程序的请求。

## 抓一次凭证（只做一次）

1. Loon 开着，打开微信 → 霸王茶姬小程序。
2. 进「我的」→ 签到，手动点一次签到；再点一下「取茶」或订单页（帮插件抓到 userId）。
3. 等 Loon 通知：
   - 「霸王茶姬 Token 已抓取」——登录凭证存好了
   - 「霸王茶姬 userId 已抓取」——签名要用的 userId 存好了
   - 「霸王茶姬签到请求已记录」——签到参数（域名/activityId/storeId）存好了
   三个都收到，明天 8:00 开始自动签；成功、已签到、失败都会通知一声。

## 每天怎么工作

- 每天 8:00，`ChageeSign.js` 先调个人信息接口校验登录（过期了会通知你重新进小程序签一次），
  再用新时间戳现场算签名去签到；一个域名不行就换下一个试。
- 凭证过期了重新进小程序手动签一次，Token 和参数都会重新抓一遍，第二天恢复自动签。

## 如果抓不到 / 签不到

- 小程序打不开或一直白屏：Loon 的 MITM 可能被挡住了。先把 Loon 关掉确认小程序本身能用；如果关了能用、开了打不开，就告诉我。
- 一直没有抓取通知：进 Loon → 请求记录，看小程序的请求走的是哪个域名，把域名发我，我把 MITM 和规则改过去。
- 定时签到报「业务繁忙」或返回非 JSON：大概率是霸王茶姬又改了接口或风控升级（2024 年 11 月就加过阿里风控验证）。把通知里的失败信息发我，我再看。
- 注意：这个接口 2024 年以来改过好几次（域名 webapi → webapi2 → miniapp），插件按抓到的实际域名走，改域名不用改脚本；但如果签名算法本身变了，就得重新分析。

## 隐私

- Token / userId / Cookie 只存在 Loon 本机的 `$persistentStore` 里，不上传、不进 GitHub。
- 传到 GitHub 的只有这几个脚本文件，里面没有任何账号信息。
