# Magpie Scripting 小组件

Magpie 网关今日用量：请求数、Token、费用、用的最多的模型。

## 文件

- `script.json` — 项目清单（名字 Magpie，图标 server.rack）
- `widget.tsx` — 小组件本体（四种尺寸 + 锁屏两种）
- `index.tsx` — App 内设置页（服务器地址、网关 Key、周期、手动刷新）
- `utils.tsx` — rpt 尺寸换算、时间、Token、费用格式化

## 接口（Magpie 自己的网关 API）

`GET {服务器地址}/v1/magpie/usage?period=today|week|month|all`，带
`Authorization: Bearer <网关 Key>`。回来是 Usage 页的汇总 JSON：顶层
就是 Totals——`calls`（请求数）、`errors`、`input`、`output`、
`cache_read`、`cache_write`、`cost`（美元），还有 `models[]`（`name`、
`sub` 供应商名、`calls`、`input`、`output`、`cost`）、`agents[]`、
`sessions[]`、`sessionCount`、`series[]`（时间轴，每点有 `calls`）。
出处：Magpie 源码 `internal/gateway/usage_api.go`、
`internal/usage/usage.go`（`Summary`、`Totals`、`Group`）。

## 服务器那边要先做两件事（不然手机连上也是 403）

1. Web UI → Settings → Network and sharing → Share on local network 打开；
2. 建一个只读网关 Key：Web UI → Gateway → Gateway keys 里建，或在服务器上
   `docker exec magpie magpie gateway-key add widget --read-only`。

注意：这个 Key 不是 `MAGPIE_WEB_KEY`（那是进网页用的），是 `sk-magpie-…`
开头的网关 Key；只读 Key 就够读用量。手机要和服务器在同一个局域网
（同一 Wi-Fi），或服务器有公网地址。

## 显示

- 小号 / 中号：Magpie + 在线状态、今日请求数（大字）、Token、费用、用的最多的模型、更新时间
- 大号：三格统计（请求 / Token / 费用）+ 最近 12 个点请求数柱状图 + 最多 4 个模型（带占比条）+ 最活跃 agent
- 锁屏圆形：Token 数；锁屏矩形：请求数 + 费用

小组件每 15 分钟刷新一次，缓存超过 10 分钟才重新拉；拉不到显示缓存，
绝不转圈。服务器地址和网关 Key 只存在手机本地（preference.json +
共享 Storage），不会上传 GitHub。
