# Authentication Upgrade Guide

DeerFlow 新增了可选的认证模块。本文档面向从无认证版本升级的用户。

## 核心概念

认证模块采用**渐进式强制**策略：

- **无用户注册** → 认证不生效，所有功能正常使用（与升级前行为一致）
- **首个用户注册** → 自动成为 admin，认证全局生效
- **后续用户注册** → 普通 user 角色

> 升级后无需任何配置即可继续使用。认证是按需启用的，不是强制开启的。

## 升级步骤

### 1. 更新代码

```bash
git pull origin main
cd backend && make install
```

### 2. 验证服务正常

```bash
make dev
# 访问 http://localhost:2026 — 应该和之前一样正常工作
```

此时没有注册用户，认证不生效，行为与升级前完全一致。

### 3. 启用认证（可选）

访问 `http://localhost:2026/login`，注册第一个账号：

- 第一个注册的用户自动获得 **admin** 角色
- 注册完成后，认证立即全局生效
- 所有历史对话自动迁移到 admin 名下

### 4. 后续用户

其他用户通过同一个 `/login` 页面注册，获得 **user** 角色。每个用户只能看到自己的对话（多租户隔离）。

## 安全机制

| 机制 | 说明 |
|------|------|
| JWT HttpOnly Cookie | Token 不暴露给 JavaScript，防止 XSS 窃取 |
| CSRF Double Submit Cookie | 所有 POST/PUT/DELETE 请求需携带 `X-CSRF-Token` |
| bcrypt 密码哈希 | 密码不以明文存储 |
| 多租户隔离 | 用户只能访问自己的 thread |
| HTTPS 自适应 | 检测 `x-forwarded-proto`，自动设置 `Secure` cookie 标志 |

## 常见操作

### 忘记密码

```bash
# 重置第一个 admin 的密码
cd backend
python -m app.gateway.auth.reset_admin

# 指定用户邮箱
python -m app.gateway.auth.reset_admin --email user@example.com
```

会输出新的随机密码，登录后建议立即修改。

### 修改密码

登录后进入 Settings → Account → Change Password。

### 完全重置认证

删除用户数据库，回到未注册状态：

```bash
rm -f backend/.deer-flow/users.db
# 重启服务后，认证不再生效，回到初始状态
```

## 数据存储

| 文件 | 内容 |
|------|------|
| `.deer-flow/users.db` | SQLite 用户数据库（密码哈希、角色） |
| `.env` 中的 `AUTH_JWT_SECRET` | JWT 签名密钥（未设置时自动生成临时密钥，重启后 session 失效） |

### 生产环境建议

```bash
# 生成持久化 JWT 密钥，避免重启后所有用户需重新登录
python -c "import secrets; print(secrets.token_urlsafe(32))"
# 将输出添加到 .env：
# AUTH_JWT_SECRET=<生成的密钥>
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/auth/register` | POST | 注册新用户 |
| `/api/v1/auth/login/local` | POST | 邮箱密码登录（OAuth2 form） |
| `/api/v1/auth/logout` | POST | 登出（清除 cookie） |
| `/api/v1/auth/me` | GET | 获取当前用户信息 |
| `/api/v1/auth/change-password` | POST | 修改密码 |
| `/api/v1/auth/setup-status` | GET | 检查是否需要初始化设置 |

## 兼容性

- **标准模式**（`make dev`）：完全兼容，无用户时行为不变
- **Gateway 模式**（`make dev-pro`）：完全兼容
- **Docker 部署**：完全兼容，`.deer-flow/users.db` 需持久化卷挂载
- **IM 渠道**（Feishu/Slack/Telegram）：通过 LangGraph SDK 通信，不经过认证层
- **DeerFlowClient**（嵌入式）：不经过 HTTP，不受认证影响

## 故障排查

| 症状 | 原因 | 解决 |
|------|------|------|
| 升级后无法访问 workspace | 前端重定向到 `/login` | 检查 Gateway 是否启动；如果 `/setup-status` 不可达会显示 "Service unavailable" |
| 登录后 POST 请求返回 403 | CSRF token 缺失 | 确认前端已更新（`getCsrfHeaders()` 已加到所有 API 调用） |
| 重启后需要重新登录 | `AUTH_JWT_SECRET` 未持久化 | 在 `.env` 中设置固定密钥 |
| 历史对话消失 | 首次注册未完成线程迁移 | 检查日志中 `Migrated N orphaned threads`；如未触发，手动运行迁移或删除 `users.db` 重新注册 |
