# Onani Toolbox

一个轻量、安全、可扩展的 Komari 插件工具箱。当前只提供节点主机名采集与缓存，主题集成暂不包含在本仓库中。

## 当前功能

- 仅对 Komari 判定为在线的节点执行固定命令 `hostname`
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
- 刷新任务运行在 Komari 插件后端；浏览器请求使用 `keepalive`，任务被接受后关闭管理页面不会中断
- 缓存保存在 Komari 的插件独立持久化目录，插件升级不会清除
- 管理页面和插件 RPC 仅供管理员使用，不向公开主页暴露数据

搜索与筛选只处理管理页面已经加载的数据，不会因为输入关键词或切换筛选条件而向 Agent 请求主机名。

## 安全边界

插件只声明 `allowSystemRPC`，用于读取节点状态并调用 Komari 自带的远程任务 RPC。它不会申请：

- `allowExec`（在 Komari 宿主机执行命令）
- `allowHooks`（拦截请求或 WebSocket）
- `allowRoutes`（注册公开 HTTP 路由）
- `allowAllFileAccess`（访问插件目录以外的文件）
- `allowListen` 或 HTML 全局注入

远程命令是源码中的固定字面量 `hostname`，节点 UUID 只作为 RPC 参数传递，不能拼接或替换命令。Agent 禁用远程控制时会记录失败并进入退避，不会绕过 Agent 设置。

## 项目结构

```text
src/plugin.ts                    插件入口，只负责装载功能模块
src/features/hostname/           主机名功能及可独立测试的纯逻辑
src/shared/json-store.ts         可供未来功能复用的受限 JSON 存储
pages/                           管理员页面
komari-plugin.json               插件清单、权限和托管配置
```

未来功能应继续放在独立的 `src/features/<feature>/` 下，并保持权限按需申请，避免把功能耦合进主机名模块。

## 开发与打包

要求 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm verify
pnpm run pack
```

`pnpm run pack` 生成可在 Komari 后台导入的 ZIP 包。不要省略 `run`：`pnpm pack` 是 pnpm 自带的 npm tarball 命令。开发服务器连接信息请放入被 Git 忽略的 `komari.local.json`，不要提交 API Key。
