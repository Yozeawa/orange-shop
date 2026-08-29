# 2b2t橘子商店 - 部署指南

## 修改完成 ✅

### 1. shop.html 已更新
- API 地址改为动态获取：`window.location.origin + '/api'`

### 2. server.js 已更新  
- CORS 允许所有来源：`process.env.ALLOWED_ORIGIN || '*'`

### 3. 部署文件已准备
- Dockerfile
- .dockerignore
- README.md

---

## 一键部署步骤

### 方案一：Koyeb（推荐⭐）

1. 访问 https://koyeb.com
2. 用 GitHub 账号登录
3. 点击 "New App" → "Deploy from Git"
4. 选择你的仓库
5. 框架选择 "Other"
6. 设置：
   - Build Command: `npm install`
   - Start Command: `npm start`
7. 点击 Deploy

**获得免费域名**: https://your-app.koyeb.app

---

### 方案二：Render.com

1. 访问 https://render.com
2. 注册并连接 GitHub
3. 新建 "Web Service"
4. 配置同上
5. 获得域名: https://your-app.onrender.com

---

## 上传代码到 GitHub

如果你有 GitHub 账号，可以直接上传：

```bash
# 在服务器上执行
cd /tmp/orange-shop
git init
git add .
git commit -m "Initial commit"
git branch -M main
# 添加远程仓库（替换为你的 GitHub 用户名和仓库名）
git remote add origin https://github.com/YOUR_USERNAME/orange-shop.git
git push -u origin main
```

如果没有 git，可以手动上传：
1. 压缩项目: `tar -czf orange-shop.tar.gz *`
2. 在 GitHub 新建仓库
3. 手动上传所有文件
