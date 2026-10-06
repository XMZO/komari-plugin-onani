# Onani Toolbox

一个可扩展的 Komari 插件工具箱：节点主机名采集与缓存，以及旧版 Agent 任务回传兼容。

## 管理页面

插件在 Komari 后台挂载「Onani 工具箱」页面，整页恰好一屏高，只有节点列表在内部滚动，节点再多也不会把页面拉长；节点很少时列表卡片随内容收缩，不留大片空白。

- 顶部显示缓存周期、自动检查间隔和主机名覆盖率，右侧是按需检查更新的按钮
- 状态筛选条同时是统计：全部 / 正常 / 失败 / 未采集 / 已过期 / 离线，带计数和滑动指示器，可用方向键切换
- 搜索节点名、主机名、UUID 或两位地区代码（如 `hk`），多个关键词须全部匹配；按 `/` 聚焦搜索框，`Esc` 清空。输入法组字期间不筛选
- 活动条实时显示刷新进度，结束后保留「上次刷新」汇总；有失败时可一键筛出失败节点
- 失败原因直接显示在对应行。点击行打开详情抽屉，查看主机名、采集与到期时间、Agent 版本、系统，以及失败阶段、任务 ID、RPC 错误码、退出码和 Agent 原始输出，并可复制完整排查信息；不使用逐行折叠栏
- 点击主机名即可复制；单节点强制刷新在行内和详情中都可用，离线节点和采集关闭时按钮不可用并说明原因
- 宽屏为表格，手机竖屏为卡片、详情变为底部抽屉；手机横屏等矮屏允许页面滚动，列表最多占一屏
- 明暗主题和强调色实时跟随 Komari 后台（同源 iframe 只读取后台的 `.dark` 类与 Radix 强调色），读不到时跟随系统
- 列表按节点 UUID 增量更新，只重绘变化的行并短暂高亮；筛选和搜索时行平滑重排，计数滚动变化。系统开启「减少动态效果」时所有动画关闭
- 加载失败、插件未运行（例如升级后等待批准权限）和登录失效分别给出可操作的提示，失败后每 10 秒自动重试
- 页面每 15 秒读取一次状态，刷新进行中改为每 1.5 秒；标签页隐藏时暂停

搜索与筛选只处理页面已经加载的数据，不会因为输入关键词或切换筛选条件而向 Agent 请求主机名。

## 主机名采集

- 仅对 Komari 判定为在线的节点执行固定命令 `hostname`
- OpenWrt/ImmortalWrt 等精简 BusyBox 系统不带 `hostname` 时（shell 返回退出码 127），在同一作业内自动对这些节点改用 `uname -n`，取到的是同一个内核主机名；Windows 节点不受影响
- 默认缓存 30 天，缓存有效期内不会重复执行命令
- 自动扫描每 6 小时；扫描只检查状态，只有缺失或过期项才会下发命令
- 失败节点至少退避 24 小时，避免反复请求不支持远程控制的 Agent
- 支持刷新缺失/过期项、强制刷新全部在线节点，以及逐节点强制刷新
- 单节点刷新按 UUID 独立锁定，最多并发 4 个作业；超出后 FIFO 排队，同一节点自动去重
- 批量刷新仍合并为一个 Komari 远程任务，避免 70+ 节点产生大量独立任务
- Agent 返回等待上限为 20 秒，单个作业从进入队列起有 30 秒绝对截止时间
- 配置、节点状态、命令下发和结果查询分别设有 5–7 秒短超时；任何路径结束都会释放节点锁和队列槽位
- 错误详情写入持久化缓存和插件日志；超时明确表示尚未收到结果，不会擅自判定 Agent 禁用了远控
- 刷新任务运行在 Komari 插件后端；浏览器请求使用 `keepalive`，任务被接受后关闭管理页面不会中断
- 缓存保存在 Komari 的插件独立持久化目录，插件升级不会清除

## 旧版 Agent 任务回传兼容

Komari 1.5 移除 v1 协议时一并删除了 `POST /api/clients/task/result`，执行结果只能通过 v2 JSON-RPC `agent.taskResult` 提交。[komari-zig-agent](https://github.com/luodaoyi/komari-zig-agent)（至少到 v0.1.52）的状态上报和 Ping 已经使用 v2，但命令结果仍固定提交到旧接口并收到 404。表现为节点在线、命令已经下发，却始终等不到结果：主机名采集和 Komari 自带的远程执行都会超时。

插件注册一个只匹配 `POST /api/clients/task/result` 的请求钩子，在路由前把旧版请求体 `{task_id, result, exit_code, finished_at}` 改写为发往 `/api/clients/v2/rpc` 的 `agent.taskResult` 调用。原始查询参数和请求头保持不变，Token 仍由 Komari 自己鉴权，节点只能写入自己的任务结果。字段与默认值与被删除的 v1 接口一致；`finished_at` 只有能规范为 RFC3339 时才转发，否则由服务器记录当前时间。

钩子在鉴权前运行，因此插件把请求体上限设为 8 MiB：更大的请求由 Komari 直接拒绝（413），格式不对的请求原样放行，依旧返回 404，并且每分钟最多记录一条插件日志。已经改用 v2 回传的 Agent 不会再请求旧路径，钩子也就不会触发。该功能无须配置，插件停用后自动失效。

## 安全边界

插件只声明 `allowSystemRPC`（主机名功能）和 `allowHooks`（转换旧版 Agent 任务回传）。请求钩子只匹配 `POST /api/clients/task/result` 这一条路径，不拦截其他请求、响应或 WebSocket，也不读取或保存 Token。它不会申请：

- `allowRoutes`（对外提供 HTTP 接口）
- `allowExec`（在 Komari 服务器上运行程序）
- `allowAllFileAccess`（访问插件目录以外的文件）
- `allowListen` 或 HTML 全局注入

远程命令是源码中的固定字面量 `hostname`，以及仅在其不存在时使用的 `uname -n`；节点 UUID 只作为 RPC 参数传递，不能拼接或替换命令。Agent 禁用远程控制时会记录失败并进入退避，不会绕过 Agent 设置。

管理页面和插件 RPC 仅供管理员使用，不向公开主页暴露数据。页面有严格的 CSP（只允许同源脚本、样式和请求），所有节点数据以纯文本渲染，不显示也不读取节点 Token；浏览器存储只用于更新后的一次性提示。

## 从 0.2.x 升级

- 0.3.0 移除了不再使用的背景图片代理（含 WebP 转码程序、`/api/plugins/onani/background` 接口和相关设置）。如果主题的背景地址仍指向该接口，请改回原图片地址。
- 权限声明因此减少了 `allowRoutes` 和 `allowExec`。Komari 会把任何权限变化视为需要重新批准：升级后到「插件管理」启用 Onani 并批准一次即可。
- 插件启动时会自动删除旧版留在持久化目录中的 `background-cache/`（最多 256 MiB）；主机名缓存和其他设置保持不变。

## 自有更新源

更新功能使用 Komari 的自定义插件市场源和原生安装器。第一次点击“检查更新”时会自动添加 `Onani Updates` 并继续检查；该操作不会自动安装更新。之后也只在用户点击时访问：

```text
https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json
```

更新清单指向不可变的版本化 Release ZIP，并包含该 ZIP 的 SHA-256。Komari 下载和校验完成后会删除旧插件代码目录、安装新版本并恢复原启用状态；下载临时文件由 Komari 删除，插件不会保存安装包。配置和 `plugin-data/onani/hostname-cache.json` 位于独立持久化目录，因此升级时保留且始终只覆盖同一个缓存文件。

安装成功后，当前页面会用固定 URL 强制重新获取 `index.css`、`theme.js`、`model.js` 和 `index.js`，再刷新 iframe。这样不会靠不断增加带版本号的静态资源 URL 规避浏览器缓存，也不会在插件数据目录积累旧前端文件。若新版权限声明发生变化，Komari 会停用插件并要求管理员重新批准，不会静默扩大权限。

## 项目结构

```text
src/plugin.ts                    插件入口，装载功能模块并清理已退役功能的数据
src/features/hostname/           主机名功能及可独立测试的纯逻辑
src/features/agent-compat/       旧版 Agent 任务回传到 v2 JSON-RPC 的请求改写
src/shared/json-store.ts         可供未来功能复用的受限 JSON 存储
src/shared/retired-storage.ts    删除已退役功能留在持久化目录中的数据
pages/index.html                 管理页面结构与图标
pages/theme.js                   首帧前同步 Komari 后台的明暗主题与强调色
pages/model.js                   页面纯逻辑（行模型、筛选、进度、时间格式），可在 Node 中测试
pages/index.js                   页面交互、轮询、自更新与动画
pages/index.css                  页面样式与响应式布局
tests/ui/                        浏览器端到端测试及模拟 Komari 的测试环境
scripts/release-assets.ts        清理旧构建并生成带 SHA-256 的更新清单
.github/workflows/release.yml    标签发布与 Release 资产上传
komari-plugin.json               插件清单、权限和托管配置
```

未来功能应继续放在独立的 `src/features/<feature>/` 下，并保持权限按需申请，避免把功能耦合进主机名模块。

## 开发与打包

要求 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm verify
pnpm run pack
pnpm run release:metadata
```

`pnpm verify` 依次运行类型检查、单元测试（含页面纯逻辑与静态安全检查）、插件清单检查和构建。

可选检查：

- `pnpm run test:ui`：在真实浏览器中驱动管理页面，覆盖筛选与搜索、单节点和批量刷新、确认框、详情抽屉与复制、自更新与重载、加载失败与恢复、主题跟随、手机与矮屏布局、减少动态效果、恶意节点名和数百节点的性能。浏览器取自本机 Playwright 缓存（`playwright-core` 1.58 对应的 Chromium、Firefox、WebKit），可用 `ONANI_UI_BROWSERS=chromium` 只跑部分内核；缺失的内核会被跳过。
- `pnpm run verify:runtime ../komari`：需要 Go，在指定 Komari 源码的测试运行时验证真实插件加载、主机名采集的 Agent 错误、空输出、RPC 错误、超时、恢复及 BusyBox 缺少 `hostname` 时改用 `uname -n`，旧版 Agent 任务回传经真实 v2 接口写入数据库、错误 Token 被拒绝和非法请求体原样返回 404，以及旧背景缓存被清理而主机名缓存保留。该检查只使用内存数据库及临时插件目录，不接触线上安装。

`pnpm run pack` 会先安全清空项目内的 `dist/`，再生成当前版本 ZIP，因此本地不会持续堆积旧包；`pnpm run release:metadata` 随后生成 `onani-update.json`。推送与 manifest 版本一致的 `v*` 标签后，Release 工作流会验证、重新构建并上传这两个资产，重复执行会覆盖同名资产而不会制造副本。

不要省略 `run`：`pnpm pack` 是 pnpm 自带的 npm tarball 命令。开发服务器连接信息请放入被 Git 忽略的 `komari.local.json`，不要提交 API Key。
