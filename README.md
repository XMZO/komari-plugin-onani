# Onani Toolbox

一个可扩展的 Komari 插件工具箱，提供节点主机名采集与缓存、旧版 Agent 任务回传兼容，以及可选的同域背景图片代理。

## 旧版 Agent 任务回传兼容

Komari 1.5 移除 v1 协议时一并删除了 `POST /api/clients/task/result`，执行结果只能通过 v2 JSON-RPC `agent.taskResult` 提交。[komari-zig-agent](https://github.com/luodaoyi/komari-zig-agent)（至少到 v0.1.52）的状态上报和 Ping 已经使用 v2，但命令结果仍固定提交到旧接口并收到 404。表现为节点在线、命令已经下发，却始终等不到结果：主机名采集和 Komari 自带的远程执行都会超时。

插件注册一个只匹配 `POST /api/clients/task/result` 的请求钩子，在路由前把旧版请求体 `{task_id, result, exit_code, finished_at}` 改写为发往 `/api/clients/v2/rpc` 的 `agent.taskResult` 调用。原始查询参数和请求头保持不变，Token 仍由 Komari 自己鉴权，节点只能写入自己的任务结果。字段与默认值与被删除的 v1 接口一致；`finished_at` 只有能规范为 RFC3339 时才转发，否则由服务器记录当前时间。

钩子在鉴权前运行，因此超过 8 MiB 或格式不对的请求会原样放行，依旧由 Komari 返回 404，并且每分钟最多记录一条插件日志。已经改用 v2 回传的 Agent 不会再请求旧路径，钩子也就不会触发。该功能无须配置，插件停用后自动失效。新增的 `allowHooks` 权限需要在升级时由 Komari 管理员重新批准。

## 背景代理与原图下载

在「Onani 工具箱 → 背景图片」或 Komari 插件配置中启用「背景代理」，将主题的背景地址设为 `/api/plugins/onani/background`。原来的随机图片源填写在插件配置中，默认 `https://t.alcy.cc/ycy/`；支持公网 HTTPS 图片源和跨域重定向，不限定图片域名。每次请求及跳转都会检查地址，拒绝内网、回环、保留地址和非 HTTPS 链接。

「WebP 原尺寸背景，下载原图」为独立开关，默认关闭。开启后，在服务器端保持原始像素宽高，以质量 78 生成 WebP，访客加载原尺寸 WebP 背景；Naive **2.0.38+** 的下载按钮才请求缓存中的原文件。压缩质量可调整，不进行缩放。图片源自身是 WebP 时，下载的原图仍是原始 WebP，不会转换为 JPEG。GIF、APNG、动画 WebP 与带 EXIF 的 JPEG/WebP 保留原样，避免丢失动画或改变方向；转换失败或体积不降时直接使用原图。

每张预览携带 `X-Onani-Original`，指向 `/api/plugins/onani/background/<内容及转换参数的 SHA-256>/original`。原图逐字节保存，预览和原图不会重新访问随机接口。Naive 2.0.39+ 通过 `/selection` 取得固定图片地址，让浏览器直接显示并缓存背景；点击下载时先用 HEAD 检查是否可用，再交给浏览器下载原图，不在主题中等待完整文件缓冲。Naive 2.0.38 仍兼容二进制背景接口。过期返回 **410**，不会重新随机选图。旧主题可以显示代理图片，但开启 WebP 后旧主题的下载按钮只能保存预览，必须配合升级主题。

两项功能默认关闭；关闭代理时源站的背景与原图接口都返回 404。插件启动后预先准备最多 3 张背景；访问时从最多 8 张已处理图片中选择，尽量避免连续重复，并最多每 30 秒后台补充一张。图片池按源地址及转换配置隔离并持久化，重启可复用；首次启用、修改图片源或缓存全部失效时，第一张仍需等待获取和转换。

原图与预览保存在插件持久化目录 `background-cache/`，最多有效 24 小时；新图片加载时清理过期项，并将缓存限制在 256 MiB / 128 张以内，空间不足会提前淘汰最旧项。并发准备请求合并为一个任务；单张上限 16 MiB / 2400 万像素，任务最多 30 秒。

随机接口与 `/selection` 选图接口返回 `Cache-Control: private, no-store, max-age=0`；固定的 `/<id>/preview` 和 `/<id>/original` 返回最多 5 分钟的 `public` 缓存头，供浏览器和 CDN 复用。CloudFront 使用遵循源站缓存头且 minimum TTL 为 0 的策略；不要为整个背景目录设置 `CachingDisabled`，否则固定图片也无法使用 CDN 缓存。关闭代理后新请求停止，CDN 中已有固定图片最多仍可命中 5 分钟。不需要为背景接口增加跨域响应头。图片流量经过 Komari 服务器，WebP 背景减少服务器到访客的流量，源站原图仍须完整获取。

插件包自带无 CGo/系统 libwebp 依赖的图片处理程序（Linux amd64/arm64、Windows amd64、macOS amd64/arm64），无须额外容器。新增的 `allowRoutes` 和 `allowExec` 权限需在升级时由 Komari 管理员批准；执行权限仅用于固定程序与参数数组，不执行 shell 或访问节点 Agent。

## 当前功能

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
- 通过 Komari 插件系统挂载一个后台“Onani 工具箱”页面，功能按选项卡组织
- 主机名选项卡支持按节点名、系统主机名或 UUID 搜索，并可按在线状态、采集状态筛选
- 节点表格采用固定高度连续滚动和吸顶表头，不用分页也不会让 70+ 节点拖长整个页面
- 管理页面按节点 UUID 增量更新，只替换真正变化的行；连续搜索输入会合并到浏览器下一帧
- 采集进度使用不占页面布局的浮层提示，列表更新不会再导致整页跳动
- 刷新完成后保留汇总；失败行直接显示原因，可展开和复制失败阶段、时间、任务 ID、RPC 错误码、Agent 退出码及输出
- 错误详情写入持久化缓存和插件日志；超时明确表示尚未收到结果，不会擅自判定 Agent 禁用了远控
- 刷新任务运行在 Komari 插件后端；浏览器请求使用 `keepalive`，任务被接受后关闭管理页面不会中断
- 缓存保存在 Komari 的插件独立持久化目录，插件升级不会清除
- 管理页面可按需检查并安装本项目的最新 GitHub Release，不依赖 Komari 官方插件市场收录
- 管理页面和插件 RPC 仅供管理员使用，不向公开主页暴露数据

搜索与筛选只处理管理页面已经加载的数据，不会因为输入关键词或切换筛选条件而向 Agent 请求主机名。

## 安全边界

插件声明 `allowSystemRPC` 处理主机名功能、`allowRoutes` 提供背景接口、`allowHooks` 转换旧版 Agent 任务回传、`allowExec` 运行随包附带的图片处理程序。背景接口不会暴露主机名及管理员 RPC。请求钩子只匹配 `POST /api/clients/task/result` 这一条路径，不拦截其他请求、响应或 WebSocket，也不读取或保存 Token。它不会申请：

- `allowAllFileAccess`（访问插件目录以外的文件）
- `allowListen` 或 HTML 全局注入

远程命令是源码中的固定字面量 `hostname`，以及仅在其不存在时使用的 `uname -n`；节点 UUID 只作为 RPC 参数传递，不能拼接或替换命令。Agent 禁用远程控制时会记录失败并进入退避，不会绕过 Agent 设置。

## 自有更新源

更新功能使用 Komari 的自定义插件市场源和原生安装器。第一次点击“检查更新”时会自动添加 `Onani Updates` 并继续检查；该操作不会自动安装更新。之后也只在用户点击时访问：

```text
https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json
```

更新清单指向不可变的版本化 Release ZIP，并包含该 ZIP 的 SHA-256。Komari 下载和校验完成后会删除旧插件代码目录、安装新版本并恢复原启用状态；下载临时文件由 Komari 删除，插件不会保存安装包。配置和 `plugin-data/onani/hostname-cache.json` 位于独立持久化目录，因此升级时保留且始终只覆盖同一个缓存文件。

安装成功后，当前页面会用固定 URL 强制重新获取 `index.js`、`background.js` 和 `index.css`，再刷新 iframe。这样不会靠不断增加带版本号的静态资源 URL 规避浏览器缓存，也不会在插件数据目录积累旧前端文件。若新版权限声明发生变化，Komari 会停用插件并要求管理员重新批准，不会静默扩大权限。

## 项目结构

```text
src/plugin.ts                    插件入口，只负责装载功能模块
src/features/hostname/           主机名功能及可独立测试的纯逻辑
src/features/background/         背景代理路由、开关与固定原图下载
src/features/agent-compat/       旧版 Agent 任务回传到 v2 JSON-RPC 的请求改写
helper/                         原图获取、WebP 转码、缓存和测试（Go）
bin/                            构建生成的跨平台处理程序与依赖许可证
src/shared/json-store.ts         可供未来功能复用的受限 JSON 存储
pages/                           管理员页面
scripts/release-assets.ts        清理旧构建并生成带 SHA-256 的更新清单
.github/workflows/release.yml    标签发布与 Release 资产上传
komari-plugin.json               插件清单、权限和托管配置
```

未来功能应继续放在独立的 `src/features/<feature>/` 下，并保持权限按需申请，避免把功能耦合进主机名模块。

## 开发与打包

要求 Node.js 20+、pnpm，以及 `helper/go.mod` 声明版本的 Go 工具链。

```bash
pnpm install
pnpm verify
pnpm run pack
pnpm run release:metadata
```

可选运行 `pnpm run verify:runtime ../komari`，在指定 Komari 源码的测试运行时验证真实插件加载、图片处理程序、预览、原图逐字节下载、过期 410 和关闭开关，并验证主机名采集的 Agent 错误、空输出、RPC 错误、超时、恢复及 BusyBox 缺少 `hostname` 时改用 `uname -n`，以及旧版 Agent 任务回传经真实 v2 接口写入数据库、错误 Token 被拒绝和非法请求体原样返回 404。该检查只使用内存数据库及临时插件目录，会联网读取一张固定测试图片，不接触线上安装。

`pnpm run pack` 会先安全清空项目内的 `dist/`，再生成当前版本 ZIP，因此本地不会持续堆积旧包；`pnpm run release:metadata` 随后生成 `onani-update.json`。推送与 manifest 版本一致的 `v*` 标签后，Release 工作流会验证、重新构建并上传这两个资产，重复执行会覆盖同名资产而不会制造副本。

不要省略 `run`：`pnpm pack` 是 pnpm 自带的 npm tarball 命令。开发服务器连接信息请放入被 Git 忽略的 `komari.local.json`，不要提交 API Key。
