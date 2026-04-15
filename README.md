# Kiro Proxy

简化的 Kiro API 反代服务，将 Kiro API 转换为 OpenAI 兼容格式。

> **定位**: 个人本地使用的轻量级反代工具。如需对外提供服务或多用户场景，请使用功能完整的 [AIClient-2-API](https://github.com/snailyp/AIClient-2-API)。

## 功能特性

✅ **已实现的功能**：
- OpenAI 兼容的 API 接口
- 流式响应支持（SSE 格式）
- 双格式认证文件兼容（AIClient-2-API 和 Kiro账号管理器）
- Token 自动刷新机制
- 设备 UUID 持久化
- 正确的二进制流解析（参考 AIClient-2-API）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置认证文件

**首次使用**：

将你的 Kiro 认证文件放在项目根目录，命名为 `kiro-auth-token.json`，或在 `config.toml` 中指定文件路径。

支持两种格式（程序自动识别）：

**格式 1: AIClient-2-API 格式**
```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token",
  "expiresAt": "2026-04-15T16:56:22.923Z",
  "authMethod": "IdC",
  "idcRegion": "us-east-1"
}
```

**格式 2: Kiro账号管理器格式**
```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token",
  "expiresAt": "2026-04-15T16:56:22.923Z",
  "region": "us-east-1",
  "userInfo": {
    "email": "user@example.com",
    "userId": "your-user-id"
  }
}
```

> **如何获取认证文件？**
> 1. 从 AWS Toolkit、Kiro 或相关工具导出
> 2. 或使用 [Kiro账号管理器](https://github.com/snailyp/kiro-account-manager) 等工具生成

### 3. 配置服务器

编辑 `config.toml`：

```toml
[server]
port = 12321
host = "127.0.0.1"  # 仅本机访问，更安全

[model]
# 支持的模型：claude-sonnet-4.5, claude-haiku-4.5, claude-opus-4.5, 
#           claude-sonnet-4.6, claude-opus-4.6
target_model = "claude-sonnet-4.5"

[credentials]
auth_file = "./kiro-auth-token.json"

[device]
# 首次启动自动生成，请勿手动修改
uuid = "auto-generated-on-first-run"
```

### 4. 启动服务

```bash
npm start
# 或
node kiro-proxy.js
```

服务器将在 `http://0.0.0.0:12321 或 http://127.0.0.1:12321` 启动。

### 5. 在客户端中使用

以 ChatWise 为例：

1. 打开 ChatWise 设置
2. 添加自定义 Provider
3. 配置如下：
   - **API 端点**: `http://127.0.0.1:12321/v1` （或运行服务的设备ip）
   - **API Key**: 任意字符串（无验证，仅本地使用）
   - **模型**: 任意字符串（程序会统一转换为 `config.toml` 中配置的模型）

> **安全提示**: 本程序不验证 API Key，仅适合本地或安全的局域网内使用。如果不信任当前网络环境，建议配置 `host = "127.0.0.1"` 以防止外部访问。

## API 端点

### POST /v1/chat/completions

OpenAI 兼容的聊天完成接口。

**请求示例**：
```json
{
  "model": "any-model-name",
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "stream": true
}
```

> **注意**: `model` 字段可以填任意值，程序会统一使用 `config.toml` 中配置的 `target_model`。

**响应格式**：
- 流式：SSE 格式（`data: {...}\n\n`）
- 非流式：标准 JSON

### GET /v1/models

获取可用模型列表。

### GET /health

健康检查端点，返回服务状态和 Token 信息。

## 配置说明

### config.toml 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `server.port` | 服务监听端口 | 12321 |
| `server.host` | 监听地址 | 0.0.0.0 |
| `model.target_model` | 目标模型名称 | claude-sonnet-4.5 |
| `credentials.auth_file` | 认证文件路径 | ./kiro-auth-token.json |
| `device.uuid` | 设备唯一标识 | 自动生成 |
| `advanced.delay_min` | 最小请求延迟（毫秒） | 2000 |
| `advanced.delay_max` | 最大请求延迟（毫秒） | 4000 |
| `advanced.max_retries` | 最大重试次数 | 3 |
| `advanced.kiro_version` | Kiro 版本号 | 0.11.131 |

### 设备 UUID

程序会在首次启动时自动生成设备 UUID 并保存到 `config.toml`：

**首次启动**:
```
✓ 生成新的设备 UUID: 67faf5b0-2c6c-42c2-aaf7-6f662dcbaf7e
  已保存到配置文件
```

**后续启动**:
```
✓ 使用已有的设备 UUID
```

**重新生成 UUID**: 将 `config.toml` 中的 `uuid` 改为 `"auto-generated-on-first-run"`

### Token 自动刷新

程序内置了智能 Token 管理：

1. **启动时检查**: 如果 Token 即将在 5 分钟内过期，自动刷新
2. **请求前检查**: 每次 API 请求前都会检查 Token 有效性
3. **自动保存**: 刷新后的新 Token 自动保存到原文件
4. **无需手动**: 只要 refreshToken 有效，程序会一直自动续期

启动时会显示 Token 状态：
```
Token 状态: ✓ 有效 (剩余 2 小时 30 分钟)
过期时间: 2026/4/15 18:30:45
```

## 故障排除

### Token 过期

**症状**: 
```
✗ Token 刷新失败
```

**解决方法**:
1. 检查 refreshToken 是否有效
2. 检查 clientId 和 clientSecret 是否正确
3. 重新从源软件导出新的认证文件

程序会自动尝试刷新，无需手动操作。

### 模型名称错误

**症状**: 
```
响应状态: 400
响应数据: {"message": "Invalid model..."}
```

**解决方法**:
确保使用点号格式：
- ✅ `claude-sonnet-4.5`
- ❌ `claude-sonnet-4-5`

### 流式响应不工作

**解决方法**:
1. 检查服务器日志，确认收到数据
2. 确认客户端配置正确
3. 检查防火墙设置

## 技术细节

### 流式响应解析

Kiro API 返回的是二进制格式的流数据，格式如下：
```
[二进制头部]:message-type\x07\x00\x05event{"content":"...","modelId":"..."}[二进制尾部]
```

程序使用正则表达式 `/:message-type[\x00-\x1F]+event(\{[^\x00]*?\})/g` 来提取 JSON 数据，并使用 Set 来避免重复发送。

### HTTP/HTTPS Agent

使用持久连接和连接池来提高性能：
```javascript
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 5,
  timeout: 120000,
  rejectUnauthorized: true
});
```

## 与 AIClient-2-API 的对比

| 特性 | 本项目 | AIClient-2-API |
|------|--------|----------------|
| 配置格式 | TOML | JSON |
| 代码行数 | ~400 | ~10,000+ |
| 依赖数量 | 3 | 30+ |
| 支持提供商 | Kiro | 多个 (Claude, Gemini, OpenAI, Grok) |
| 插件系统 | ✗ | ✓ |
| OAuth 流程 | ✗ | ✓ |
| 进程管理 | 单进程 | Master-Worker |
| 适用场景 | 个人使用、低配置设备 | 生产环境、多用户 |

## 参考

本项目参考了 `.other/AIClient-2-API` 的实现，特别是：
- 流式响应解析逻辑
- HTTP Agent 配置
- Token 刷新机制

## 许可证

MIT
