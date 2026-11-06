# RoboParty MCP（统一入口）

把三个 RoboParty MCP 合并为一个 npm 包、一个 MCP 入口：

| 子服务 | 工具前缀 | 运行时 | 作用 |
|---|---|---|---|
| 文档 MCP | `docs_*` | Node | 检索官方文档和 RP1 GitHub 文档 |
| 控制 MCP | `control_*` | Python 子进程 | 经 rp_server protocol v2 控制/遥测 |
| System-1 MCP | `system1_*` | Node | Laya 决策分析（本地 ONNX） |

三个子服务仍在独立进程中运行，但代码都打包在本 npm 包内，不再依赖
`roboparty-docs-mcp` / `roboparty-control-mcp` / `roboparty-system1-mcp`：

```text
src/docs          文档 MCP 源（TypeScript）
src/system1       System-1 MCP 源（TypeScript）
src/control       控制 MCP（Python 源码 + roboparty.v1 + 启动器）
dist/             构建输出：docs/system1 bundle
```

## 工具

统一入口把子服务工具加前缀后暴露，例如：

- `docs_list_manuals`、`docs_search_docs`、`docs_get_page`、`docs_list_toc`
- `control_get_imu`、`control_get_battery`、`control_stop`、`control_policy_start`
- `system1_laya_analyze`、`system1_laya_health`、`system1_laya_info`

原工具名、参数和结果保持不变，只是在前面加子服务前缀。

## 安装

```bash
npm install -g roboparty-mcp
# 或
npx -y roboparty-mcp
```

控制子进程首次使用需要 Python 3.10+、`pyyaml` 和 `protobuf`：

```bash
roboparty-mcp --setup
```

System-1 首次使用需要 Laya 模型（约 1.7GB）；模型不随 npm 包分发。可跨平台预置：

```bash
npm run fetch:model
# 或
roboparty-mcp --fetch-model
```

默认下载到 `~/.cache/receptron-laya`（Windows 为 `%USERPROFILE%\.cache\receptron-laya`），
也支持 `LAYA_CACHE`、`LAYA_MIRROR`、`LAYA_REVISION`、`LAYA_SUBFOLDER`。

## 运行

```bash
# 全部启用
roboparty-mcp

# 只启用部分子服务
roboparty-mcp --profile docs,system1
roboparty-mcp --profile control

# 检查三个子进程和工具列表
roboparty-mcp --check
```

MCP 客户端配置：

```json
{
  "mcpServers": {
    "roboparty": {
      "command": "npx",
      "args": ["-y", "roboparty-mcp"]
    }
  }
}
```

## 环境变量

子进程继承调用方环境，但有隔离：

- 只有 `src/control` 子进程会收到 `RP_SERVICE_TOKEN`、`RP_TLS_CERT`、`RP_ALLOW_PLAINTEXT` 和 `MCP_CONFIG`。
- `docs`、`system1` 子进程会移除这些控制凭据。
- 其他变量（代理、缓存、`LAYA_CACHE` 等）按需继承。

控制相关：

| 变量 | 作用 |
|---|---|
| `RP_SERVICE_TOKEN` | rp_server Bearer token |
| `RP_TLS_CERT` | 机器人证书路径 |
| `MCP_CONFIG` | 控制 MCP 配置文件 |
| `RP_ALLOW_PLAINTEXT` | 仅本地调试允许 `ws://` |

## 安全边界

- 统一入口只做 MCP 工具路由，不复制 rp_server 的认证、lease、stop 逻辑。
- 文档和 System-1 不能调用控制工具，也拿不到控制 token。
- 控制子进程默认 `readonly: true`，运动/策略启停仍需可写配置和 lease。
- System-1 结果只是分析建议，不是设备授权。
- 工具调用成功不等于硬件动作完成；控制结果需结合 rp_server v2 回执和 telemetry。

## 包内容与安装注意

- 文档、System-1 的源码在本包内构建；npm 运行时不再依赖三个独立 MCP 包。
- skills 不在本包内分发；控制、产品文档和文章写作技能统一在独立仓库
  `Roboparty/roboparty_skills`（GPL-3.0-only）。
- 控制 MCP 的 Python 源码和 `roboparty.v1` 绑定在 `src/control`，首次使用需要
  `roboparty-mcp --setup` 准备 `pyyaml`/`protobuf`。
- System-1 使用 `@receptron/laya` 和本地 Laya 模型；模型权重不随包分发。
- 如果 `onnxruntime-node` 在安装时下载失败，使用：
  `ONNXRUNTIME_NODE_INSTALL=skip npm install -g roboparty-mcp`
  然后用 `roboparty-mcp --fetch-model` 预置模型。
- 包内不包含 systemd 或 Linux 专用服务文件；Windows 可直接通过 `npx`/stdio 使用。
