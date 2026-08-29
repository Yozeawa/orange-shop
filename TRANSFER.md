# Orange Shop 项目交接文档

## 项目基本信息
- **仓库**: https://github.com/Yozeawa/orange-shop (注意：已迁移到 Yozeawa 组织)
- **生产地址**: https://orange-shop-production-0c13.up.railway.app
- **平台**: Railway + GitHub Actions
- **技术栈**: Node.js + Express + MySQL (via db_mysql.js)

---

## 当前状态（2026-08-29）

### ✅ 已完成的修复

**验证码发送问题**
- **问题**: 点击发送验证码后直接返回"发送过于频繁"错误
- **原因**: codeStore 初始化为空对象 {}，未从文件加载历史状态
- **修复**: server.js 第134行改为 const codeStore = readCodes();
- **Commit**: 1d26fff4 - fix: 从文件加载验证码状态，修复发送过于频繁的问题

---

## 已知问题（需要下一个 AI 处理）

### 问题 1: Railway 未部署最新代码
**现象**: 代码已修复并提交，但 Railway 服务器仍返回旧行为的错误
```
POST /api/send-code
{"email": "test@example.com"}
# 返回: {"error":"请提供邮箱地址"}
```

**可能原因**:
1. GitHub Actions 部署成功但 Railway 缓存了旧版本
2. 需要手动触发 Railway 重新部署
3. 代码合并冲突导致本地和远程不一致

**当前状态**:
- 本地 HEAD: 3d948cb (尝试添加交接文档 - 被阻止)
- 本地 main: 5861014 (fix: 从文件加载验证码状态)
- 远程 origin/main: 3315f37 (feat: orange-shop 项目初始化)
- 远程 SHA 1d26fff4 是修复版本（已在 GitHub Actions 部署成功）

**解决方案**:
```bash
cd /tmp/orange-shop
git pull --rebase origin main
git push origin main
```

---

### 问题 2: Admin API 认证缺陷
**现象**: 使用 key 参数访问管理员接口返回 "未登录"
```
curl "https://orange-shop-production-0c13.up.railway.app/api/admin/users?key=dev-admin-key-2025"
# 返回: {"error":"未登录"}
```

**原因**: 
- 路由定义: app.get('/api/admin/users', requireAuth, requireAdmin, ...)
- requireAuth 先执行 JWT 验证，JWT 缺失时直接返回错误
- requireAdminKey 中间件在 requireAdmin 之后才检查 key
- 即 key 认证无法绕过 JWT 验证

**需要修复**: 调整中间件顺序或让 requireAuth 支持 key 认证

---

### 问题 3: Git 分支分歧
**现象**: 本地 main 和远程 main 有分歧
```
本地: 5861014 (fix: 从文件加载验证码状态) <- 已推送
     aca2f6c (revert: 回退...)

远程: 3315f37 (feat: orange-shop 项目初始化)
     1d26fff (fix: 从文件加载验证码状态) <- 原始修复
     94c8a00 (feat: 移除 IPv4 限制)
```

**说明**: 两次推送产生了不同的提交链，需要合并

---

## 紧急排查命令

### 检查服务器状态
```bash
# 测试公共 API
curl -s https://orange-shop-production-0c13.up.railway.app/api/products | head -c 100

# 测试验证码发送
curl -s -X POST https://orange-shop-production-0c13.up.railway.app/api/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# 检查远程代码是否包含修复
curl -s https://raw.githubusercontent.com/Yozeawa/orange-shop/main/server.js | grep "const codeStore"
# 期望输出: const codeStore = readCodes();
```

### 检查部署状态
```bash
# GitHub Actions 运行状态
curl -s https://api.github.com/repos/Yozeawa/orange-shop/actions/runs?per_page=1

# 最新 commit
curl -s https://api.github.com/repos/Yozeawa/orange-shop/commits/main
```

### 修复 Git 分歧
```bash
cd /tmp/orange-shop
git pull --rebase origin main
git push origin main
```

---

## 环境变量配置

| 变量名 | 说明 | 位置 |
|--------|------|------|
| DATABASE_URL | MySQL 连接字符串 | Railway Dashboard |
| ADMIN_ACCESS_KEY | dev-admin-key-2025 | Railway Dashboard |
| RAILWAY_TOKEN | Railway 部署令牌 | GitHub Secrets |

---

## 关键文件

| 文件 | 路径 | 说明 |
|------|------|------|
| 主服务器 | /tmp/orange-shop/server.js | 已修复验证码问题 |
| 注册页 | /tmp/orange-shop/register.html | 前端验证码逻辑 |
| 数据库 | /tmp/orange-shop/db_mysql.js | MySQL 连接 |
| 部署配置 | /tmp/orange-shop/railway.json | Railway 配置 |

---

## 下一步操作建议

1. **首先**: 解决 Git 分支分歧
   ```bash
   git pull --rebase origin main && git push origin main
   ```

2. **然后**: 验证 Railway 部署成功
   - 等待 GitHub Actions 完成
   - 测试 /api/send-code 端点

3. **最后**: 修复 Admin API 认证问题
   - 调整中间件顺序
   - 确保 key 认证能绕过 JWT

---

## 备注

- 项目使用 JSON 文件存储数据（users.json, products.json, orders.json, codes.json）
- 验证码有效期 5 分钟，60 秒冷却期
- 前端无框架依赖（vanilla JS）
- 仓库已从 YOZEAWA 迁移到 Yozeawa 组织
- 修复已通过 GitHub Actions 部署（status: success），但 Railway 服务器响应似乎未更新

*文档创建时间: 2026-08-29*
