# 更新日志

## 2026-05-02 - 修复 Token 刷新问题

### 问题描述
项目无法正常运行，Token 刷新时卡住。

### 根本原因
对比 `.other/AIClient-2-API` 项目后发现，Kiro 有两种不同的认证方式，使用不同的刷新 URL 和请求格式：

1. **Social Auth (Google/GitHub)**
   - 刷新 URL: `https://prod.{region}.auth.desktop.kiro.dev/refreshToken`
   - 请求体: `{ refreshToken }`
   - 区域字段: `region`

2. **Builder ID (IdC)**
   - 刷新 URL: `https://oidc.{region}.amazonaws.com/token`
   - 请求体: `{ refreshToken, clientId, clientSecret, grantType }`
   - 区域字段: `idcRegion`

原代码只支持 Builder ID 方式，导致 Social Auth 方式获取的 Token 无法刷新。

### 修复内容

#### 1. 更新 Token 刷新逻辑 (`kiro-proxy.js`)
- ✅ 根据 `authMethod` 字段自动选择正确的刷新 URL
- ✅ 支持两种不同的请求格式
- ✅ 兼容 `region` 和 `idcRegion` 两种区域字段名
- ✅ 增强错误日志，显示响应数据

#### 2. 更新认证数据标准化
- ✅ 同时保存 `region` 和 `idcRegion` 字段
- ✅ 支持 `profileArn` 字段（Social Auth 需要）
- ✅ 显示认证方式信息

#### 3. 更新文档 (`README.md`)
- ✅ 说明两种认证方式的区别
- ✅ 更新认证文件格式示例
- ✅ 添加注意事项

#### 4. 更新示例文件 (`kiro-auth-token.json.example`)
- ✅ 改为 Social Auth 格式示例（更常见）

### 测试结果
```
✓ 认证文件加载成功
  账号: georgewalker1988@nuodekalai.com
  认证方式: IdC
  区域: us-east-1
✓ 使用已有的设备 UUID
================================================
🚀 Kiro Proxy 服务已启动
================================================
监听地址: http://0.0.0.0:12320
目标模型: claude-sonnet-4.5
登录账号: georgewalker1988@nuodekalai.com

⚠️  Token 即将过期或已过期

[Token] 正在刷新 Access Token...
[Token] 使用 Builder ID 方式刷新 (region: us-east-1)
[Token] ✓ 刷新成功
[Token] 过期时间: 2026/5/3 00:17:14

💳 免费试用额度:
   已用: 370.82 / 500 Credits (74.2%)
   剩余: 129.18 Credits
   到期: 2026/5/26 08:42:13

📊 月度额度:
   限额: 50 Credits/月
   已用: 0.00 Credits (0.0%)
   剩余: 50.00 Credits
   重置时间: 2026/6/1 08:00:00

================================================
✅ 服务就绪
================================================
```

### 兼容性
- ✅ 向后兼容现有的 Builder ID 认证文件
- ✅ 支持新的 Social Auth 认证文件
- ✅ 自动识别认证方式，无需手动配置

### 参考
- AIClient-2-API: `.other/AIClient-2-API/src/auth/kiro-oauth.js`
- 关键常量: `KIRO_REFRESH_CONSTANTS`
