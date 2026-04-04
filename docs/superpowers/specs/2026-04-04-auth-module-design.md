# Auth Module Design Spec

**Date:** 2026-04-04
**Status:** Approved
**PR:** #1728

## Overview

DeerFlow 内置认证模块，始终强制，零配置启动。首次启动自动创建 admin，用户通过控制台日志获取初始密码，首次登录时设置真实邮箱和新密码。

## Design Decisions

| 决策 | 选择 | 拒绝的替代方案 | 理由 |
|------|------|---------------|------|
| Auth 模式 | 始终强制 | 渐进式 / 可关闭 | 无竞争窗口，无条件分支 |
| Admin 创建 | 启动时自动创建 + 随机密码 | Setup 页面自注册 / 环境变量注入 | 零配置 + 无竞争 |
| 密码发现 | 控制台日志 | 密码文件 | 无文件权限/删除/gitignore 问题 |
| 首次登录 | 强制 setup（改邮箱 + 改密码） | 可选修改 | 避免 admin@localhost 成为永久账号 |
| Setup 接口 | 扩展 change-password | 新增 /setup 端点 | YAGNI，功能完全覆盖 |
| needs_setup 存储 | DB 字段 | JWT payload / 文件 | Single source of truth |
| Auth 保护范围 | 全局 middleware + allowlist | 逐路由装饰器 | 漏加装饰器 = 漏洞 |
| 注册 | 开放（user 角色） | 默认关闭 / 邀请制 | 团队工具，低滥用风险 |
| Token 失效 | password_version 字段 | blocklist / secret rotation | 最简实现 |

## Data Model

### User 表变更

新增两个字段：

```sql
needs_setup BOOLEAN NOT NULL DEFAULT FALSE
token_version INTEGER NOT NULL DEFAULT 0
```

- `needs_setup`: 自动创建的 admin 为 True，完成 setup 后 False
- `token_version`: 每次改密码 +1，JWT 校验时比对

已有数据库升级：`ALTER TABLE users ADD COLUMN ... DEFAULT ...`，用 try/except 兼容。

### JWT Payload

```json
{
  "sub": "user_id",
  "ver": 0,
  "exp": "...",
  "iat": "..."
}
```

`ver` 对应 `User.token_version`，decode 时查 DB 比对，不匹配则 401。

## Startup Flow

```
Gateway lifespan 启动
  ↓
count_users() == 0?
  ├─ YES → 创建 admin@localhost (needs_setup=True, 随机密码)
  │         → 迁移无 user_id 的 thread 到 admin
  │         → 控制台输出邮箱 + 密码
  ├─ NO, 有 needs_setup=True 的用户 → 日志提醒完成设置或用 reset_admin
  └─ NO, 无 needs_setup → 正常启动
```

### 多进程安全

- SQLite UNIQUE 约束处理竞争
- 第二个实例 INSERT 失败 → 捕获 ValueError → 静默跳过

### SQLite WAL 模式

`_get_connection()` 中执行 `PRAGMA journal_mode=WAL`。允许并发读 + 单写不阻塞读。

## Auth Enforcement

### 全局 Auth Middleware

```python
class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if _is_public_path(request.url.path):
            return await call_next(request)
        # 验证 JWT cookie → 401 if invalid
```

**Public allowlist:**
- `/health`
- `/api/v1/auth/login/local`
- `/api/v1/auth/register`
- `/api/v1/auth/setup-status`
- `/api/v1/auth/logout`
- `/docs`, `/openapi.json`

其他所有 `/api/*` 默认需要认证。

**与装饰器的关系：** Middleware 做粗粒度拦截（有没有合法 cookie）。`@require_auth` + `@require_permission` 做细粒度控制（owner check、权限）。两层不冲突。

### CSRF

始终校验，无条件。Auth endpoint（login/register/logout）豁免。

## Login Flow

```
POST /api/v1/auth/login/local
  ↓
验证密码 → 成功
  ↓
检查 user.needs_setup
  ├─ True  → 返回 {expires_in, needs_setup: true}
  └─ False → 返回 {expires_in}
```

前端根据 `needs_setup` 决定跳转 `/setup` 还是 `/workspace`。

## Setup Flow

```
/setup 页面（前端新增）
  ↓
表单：邮箱 + 新密码 + 确认密码
  ↓
POST /api/v1/auth/change-password
  body: {current_password, new_password, new_email}
  ↓
后端：更新邮箱 + 密码 + token_version++ + needs_setup=False
  ↓
前端：跳转 /workspace
```

### SSR Guard

`getServerSideUser()` 返回的 `AuthResult` 增加 tag：

```typescript
| { tag: "needs_setup"; user: User }
```

`workspace/layout.tsx`: `case "needs_setup": redirect("/setup")`

### change-password 接口扩展

新增可选字段 `new_email: EmailStr | None`。有值时同时更新邮箱（校验唯一性）。
如果 `user.needs_setup == True` 且提供了 `new_email`，成功后自动设 `needs_setup = False`。

## Token Invalidation

改密码时 `token_version += 1`。JWT encode 时写入 `ver`。

校验链路：`decode_token` → `TokenPayload` 包含 `ver` → `get_current_user_from_request` 查 DB → 比对 `user.token_version != payload.ver` → 401。

触发场景：
- 用户改密码
- admin 用 reset_admin CLI
- setup 流程完成

## Rate Limiting

登录端点 IP 级限速，内存计数器：

```python
_login_attempts: dict[str, tuple[int, float]] = {}  # ip → (fail_count, lock_until)
```

- 同一 IP 连续 5 次失败 → 锁定 5 分钟
- 成功登录 → 重置计数
- 不引入 Redis，进程内 dict 够用

## Thread Migration

在 `_ensure_admin_user` 中，创建 admin 后同步执行：
- 扫描 Store 中所有 thread
- `metadata.user_id` 为空 → 写入 admin 的 user_id
- 日志记录迁移数量

在 lifespan 中同步执行（此时未接受请求），不存在并发问题。

## Password Recovery

```bash
python -m app.gateway.auth.reset_admin [--email user@example.com]
```

行为：
- 生成随机密码
- 更新密码 hash
- `token_version += 1`（旧 token 立即失效）
- `needs_setup = True`（下次登录走 setup 流程）
- 打印新密码到 stdout

## File Changes Summary

### Backend

| 文件 | 变更 |
|------|------|
| `auth/models.py` | User 加 `needs_setup`, `token_version` |
| `auth/jwt.py` | encode 加 `ver`，TokenPayload 加 `ver` |
| `auth/repositories/sqlite.py` | DDL 加列 + ALTER TABLE 兼容 + WAL 模式 |
| `gateway/app.py` | `_ensure_admin_user` + thread 迁移 + AuthMiddleware |
| `gateway/auth_middleware.py` | 新文件，全局 auth middleware |
| `gateway/deps.py` | decode 后校验 `token_version` |
| `gateway/routers/auth.py` | login 返回 `needs_setup`，change-password 扩展 `new_email` + `needs_setup` + `token_version` |
| `gateway/routers/auth.py` | 登录限速 |
| `auth/reset_admin.py` | 设 `needs_setup=True` + `token_version++` |

### Frontend

| 文件 | 变更 |
|------|------|
| `core/auth/types.ts` | AuthResult 加 `needs_setup` tag |
| `core/auth/server.ts` | SSR guard 返回 `needs_setup` |
| `app/workspace/layout.tsx` | `needs_setup` → redirect `/setup` |
| `app/(auth)/setup/page.tsx` | 新页面：邮箱 + 新密码表单 |

## Deferred (Future Work)

- OAuth 登录（GitHub, Google）
- 邮件验证 / 找回密码
- RBAC 细粒度权限
- CSRF token 定期轮换
- PostgreSQL 用户存储
