# 亚朵 App 签到（Loon）

每天 8:00 自动签到一次。亚朵的签到接口没有公开文档，所以这个插件不写死接口，
而是先抓一次你手动签到时的真实请求，之后每天定时重放这个请求。

## 文件

- `Atour.lpx` — Loon 插件：抓取凭证 + 每天 8:00 定时签到
- `AtourGetAuth.js` — 抓取脚本：存 Cookie / Token，并把签到请求（URL+方法+请求头+请求体）整个记下来
- `AtourSign.js` — 定时签到脚本：重放抓到的签到请求，Cookie 会换成最新抓到的
- `README.md` — 本文件

## 安装

1. 把这 3 个文件（`Atour.lpx`、`AtourGetAuth.js`、`AtourSign.js`）传到 GitHub `johnwick-xyz/scripting` 的新文件夹 `atour/` 里。
2. Loon → 插件 → 右上角 + → 从 URL 添加，填：
   `https://raw.githubusercontent.com/johnwick-xyz/scripting/main/atour/Atour.lpx`
3. 确认插件已开启，Loon 保持开启。

## 抓一次签到请求（只做一次）

1. Loon 开着，打开亚朵 App。
2. 进「我的」→ 找到签到入口，手动点一次签到。
3. 等 Loon 通知：
   - 「亚朵 Cookie 已抓取」/「亚朵 Token 已抓取」——凭证存好了
   - 「亚朵签到请求已记录」——签到请求存好了，明天 8:00 开始自动签
4. 如果只收到凭证通知、没有「签到请求已记录」，说明那次签到没走到带 sign / checkin 字样的接口：
   在 Loon → 请求记录里找刚才签到那一下的请求，把 URL 发我，我把匹配规则改一下。

## 每天怎么工作

- 每天 8:00，`AtourSign.js` 把抓到的签到请求重放一次，成功/已签到/失败都会通知一声。
- 凭证过期了会自动用最新抓到的替换；如果 App 很久没打开、凭证失效了，通知会报失败，
  那时再打开 App 手动签到一次，凭证和请求都会重新抓一遍，第二天恢复自动签。

## 如果 App 打不开 / 抓不到

- 打开 App 时页面加载失败：亚朵可能做了证书锁定（跟之前电信 App 一样），Loon 的 MITM 会被挡住。
  先把 Loon 关掉确认 App 本身能正常用；如果关了能用、开了打不开，就告诉我，我再看别的路（比如走小程序）。
- 打开 App 正常、但一直没有抓取通知：App 可能没走 `yaduo.com` 这个域名。
  在 Loon → 请求记录里翻一下亚朵 App 的请求，把域名发我，我把 MITM 和规则改过去。

## 隐私

- Cookie / Token / 签到请求只存在 Loon 本机的 `$persistentStore` 里，不上传、不进 GitHub。
- 传到 GitHub 的只有这 3 个脚本文件，里面没有任何账号信息。
