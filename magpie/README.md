# Magpie Scripting 小组件

Magpie 网关今日用量 + 账号额度卡（2026-11-26 新版，按 john 截图的样子排；
统计从 30 日改成当天，2026-11-26）。

## 文件

- `script.json` — 项目清单（名字 Magpie，图标 server.rack）
- `widget.tsx` — 小组件本体（四种尺寸 + 锁屏两种）
- `index.tsx` — App 内设置页（服务器地址、网关 Key、手动刷新、账号额度一览）
- `utils.tsx` — rpt 尺寸换算、时间、Token、费用格式化（含网页口径 `fmtCostWeb`）

## 接口（Magpie 自己的网关 API，四个接口并行拉）

都带 `Authorization: Bearer <网关 Key>`（只读 Key 就够，
`internal/gateway/readonly.go` 里三个路由都放行了）：

- `GET {base}/v1` → `{name, version: "v0.1.4801", models: 19, ...}`，
  顶栏的版本和模型数从这里来。
- `GET {base}/v1/magpie/usage?period=today` → Usage 页的汇总 JSON：
  顶层就是 Totals——`calls`、`errors`、`input`、`output`、`cache_read`、
  `cache_write`、`cost`（美元）、`timed`、`ttft_ms`、`decode_ms/out/n`、
  `floor_ms/out/n`、`rates` 直方图，还有 `models[]`（`name`、`sub`、
  再加 Totals 全套）、`accounts[]`（每个账号今日用量）、
  `sessionCount`。今天 0 点起算，`series` 按小时。出处：Magpie 源码
  `internal/gateway/usage_api.go`、`internal/usage/usage.go`
  （`Summary`、`Totals`、`Group`）、`internal/usage/ledger.go`
  （周期值是 `today` / `7d` / `30d` / `all`，不是
  `today` / `week` / `month` / `all`——传 `period=month` 会被
  当成未知值静默回落到 30d）。
- `GET {base}/v1/magpie/usage?period=7d` → 只取顶层 `Totals.calls`，
  当页脚的“7 日 N 次”；拉不到就不显示那半句。
- `GET {base}/v1/magpie/quotas/cards` → `[]SubscriptionQuota`，一张卡
  一个账号：`name`、`plan`、`windows[]`（`name`、`used` 已用占比 0–1、
  `resetsAt`、`amount` / `limit` / `unit`、`runsOut` / `runsOutAt`、
  `balance`、`display`、`text`、`unlimited`）、`balance`、
  `balanceParts[]`（`label` + `text`）。出处：Magpie 源码
  `internal/provider/subscription_usage.go`（`SubscriptionQuota`、
  `QuotaWindow`）、`internal/provider/balance.go`（`BalancePart`）。
  网页上这些卡的画法在 `internal/gui/assets/app.js`（`renderQuotas` /
  `quotaWindows` / `quotaText` / `quotaCount` / `runsOutText` /
  `joinBalanceParts`）。

用量是主数据，拉不到整个刷新失败（显示缓存 + 报错）；`/v1`、额度卡
或 7 日用量拉不到不连累别的（只丢版本/模型数、额度卡或页脚那半句）。

## 服务器那边要先做两件事（不然手机连上也是 403）

1. Web UI → Settings → Network and sharing → Share on local network 打开；
2. 建一个只读网关 Key：Web UI → Gateway → Gateway keys 里建，或在服务器上
   `docker exec magpie magpie gateway-key add widget --read-only`。

注意：这个 Key 不是 `MAGPIE_WEB_KEY`（那是进网页用的），是 `sk-magpie-…`
开头的网关 Key；只读 Key 就够读用量和额度。手机要和服务器在同一个局域网
（同一 Wi-Fi），或服务器有公网地址。远程也可以用 WorkBuddy 的地址 + 3430 端口。

## 显示（统计周期固定今日）

- 大号：顶栏（Magpie + 版本 · 模型数 + 刷新图标）+ 两张额度卡 +
  今日统计（调用 / 成功率 / 费用 / 输出速度）+ 首字 · 总 Token（缓存）+
  热门模型（今日）前 4 + 页脚（N/N 账号在线 · 7 日 N 次 | 更新于）
- 中号：30 日统计行（数字 18 号）+ 明细行 + 热门模型前 3（12 号行）+
  页脚（无顶栏和额度卡；间距收到 4、上下留白收到 5 才放得下）
- 小号：顶栏（logo + Magpie）+ 2×2 统计（单行：小标签 + 数字 12 号）+
  热门模型前 3（精简行：名字 + Token，不带名次和调用次数，131 宽放不下）+
  更新时间（155×155 四样都放很紧，统计改成单行小格才放得下）
- 锁屏圆形：Token 数；锁屏矩形：请求数 + 费用

顶栏的 logo 是紫色圆底 + 白色 M（截图里那只紫色小鸟画不出来，用 M 代替）；
右上角的 ↻ 只是装饰（小组件点按只能打开 App，做不到单独刷新）。

## 额度卡的画法（按网页额度卡简化）

- 条是“剩余”百分比 = `100 - used × 100`（CodeArts 那个 98.5% 就是这么来的：
  286/18,600 用了 1.5%，剩 98.5%），绿色；整数显示整数（90%），不整一位小数。
- 右上角：窗口有 `amount/limit` 就显示“已用 / 总量”（286 / 18,600，千分位），
  没有就显示重置日期（12/19 重置 (24d)，天数是到重置那天的整天数）。
- 橙色 pill 是 `runsOut`（“100 · 11/26 过期”：100 个点数 11/26 过期），
  只在快过期的那一项上显示。
- 明细行优先用 `balanceParts`（“基础积分包 余 500/500 ·
  赠送积分包 余 17,814/18,100”，label + text 用 · 连），没有就用这个账号
  今日在 `usage.accounts` 里的用量（“今日 56 次 · 2.7M tok · $2.93”）。
- 一张卡有多个窗口时取重置最晚的那个当主窗口（Codex 的 5h 窗口不画，
  只画 12/19 重置的那个）；大号只显示前两张卡（按接口返回顺序）。

## 口径（和网页 Usage 页一致）

- Token 数（排行和右边的数字）：`input + output + cache_read + cache_write`；占比 = 该模型 Token / 全部模型 Token 之和。
- 总 Token：`input + output + cache_read + cache_write`；括号里的“缓存”是 `cache_read`。
- 成功率：`(calls - errors) / calls`，一位小数；100% 显示绿色，不到 100% 显示橙色。
- 输出速度：计时回复的中值（`rates` 直方图的 bin 中值，bin 400 是 1，每档 1.02 倍；只有一条时按 `decode_out/decode_ms` 实测算）。
- 首字：`ttft_ms / timed` 的平均，<1 秒显示毫秒，否则秒（6.4s 这样）。
- 7 日次数：`period=7d` 那次的顶层 `Totals.calls`；拉不到就不显示。
- 模型名只留最后一段，不带供应商前缀
  （`nvidia/nemotron-3.5-super-vl:free` 显示成 `nemotron-3.5-super-vl:free`）。
- 费用：`$2.61` 这样两位小数；模型明细已经不用了，老的 `fmtCostWeb`
  （≥$1 两位、<$1 三位）还留在 `utils.tsx` 里备用。

## 更新与缓存

小组件每天 9–22 点每小时整点自动更新一次；拉不到显示缓存，
绝不转圈。服务器地址和网关 Key 只存在手机本地（preference.json +
共享 Storage），不会上传 GitHub。

注意：App（`index.tsx`）和小组件（`widget.tsx`）共用同一份缓存
（共享 Storage `magpie_usage`），两边的取数结构必须保持一致——
App 刷新一次就会把缓存重写一遍，如果 App 那份里没有模型列表或额度卡，
小组件读到的就是空的。改取数逻辑时两个文件要一起改。
缓存带版本号 `v=3`，老缓存（v2、30 日口径）直接作废重拉。
