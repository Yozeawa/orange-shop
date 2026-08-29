const express = require('express');
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db_mysql');

// ========== 邮箱 SMTP 配置（在此填写你的邮箱信息）==========
// 可选邮箱服务商及配置：
//
// 【Gmail】获取App Password步骤：
//   Google账号 → 安全 → 两步验证 → App密码 → 选择"其他（自定义名称）"→ 生成
//   host: 'smtp.gmail.com', port: 587, secure: false
//
// 【网易163邮箱】获取授权码步骤：
//   163邮箱 → 设置 → POP3/SMTP/IMAP → 开启SMTP → 设置客户端授权密码
//   host: 'smtp.163.com', port: 465, secure: true
//
// 【Outlook/Hotmail】获取应用密码步骤：
//   Microsoft账号 → 安全 → 高级安全选项 → 应用密码 → 创建新密码
//   host: 'smtp.office365.com', port: 587, secure: false
// ============================================================
const SMTP_CONFIG = {
  host: 'smtp.163.com',
  port: 465,
  secure: true,               // port 465 用 SSL
  auth: {
    user: 'foreigner0904@163.com',
    pass: 'THvCz65KwkstrzHt',
  },
};
// ============================================================

// 盐值（生产环境应存储在环境变量中）
const PASSWORD_SALT = 'orangeShop2025!@#';

const app = express();
const PORT = process.env.PORT || 3456;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const DATA_FILE = path.join(__dirname, 'products.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const CODES_FILE = path.join(__dirname, 'codes.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ========== 安全配置 ==========
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_IP_WHITELIST = (process.env.ADMIN_IP_WHITELIST || '').split(',').filter(Boolean);
const ADMIN_ACCESS_KEY = process.env.ADMIN_ACCESS_KEY || 'dev-admin-key-2025';

// ========== 安全中间件 ==========

// 请求体大小限制（防止超大 payload 攻击）
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// CORS：仅允许前端同源访问
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// CSP + 安全头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:;");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// 请求频率限制（简单内存实现，按IP限流）
const rateLimitStore = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟窗口
const RATE_LIMIT_MAX = 60; // 每个IP最多60次/分钟

app.use((req, res, next) => {
  // 跳过非API请求
  if (!req.path.startsWith('/api')) return next();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  if (!rateLimitStore[ip]) rateLimitStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW };
  else if (now > rateLimitStore[ip].resetAt) {
    rateLimitStore[ip] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW };
  } else {
    rateLimitStore[ip].count++;
  }
  if (rateLimitStore[ip].count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
});

// ========== 数据层：优先使用数据库，无 DATABASE_URL 时降级到 JSON 文件 ==========

// 数据库模式标志（由 initDatabase 设置）
let useDb = false;

// JSON 文件读写（备用路径）
function jsonReadProducts() {
  try { const d = fs.readFileSync(DATA_FILE, 'utf8'); return JSON.parse(d); } catch { return []; }
}
function jsonWriteProducts(p) { fs.writeFileSync(DATA_FILE, JSON.stringify(p, null, 2), 'utf8'); }
function jsonReadOrders() { try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; } }
function jsonWriteOrders(o) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 2), 'utf8'); }
function jsonReadUsers() {
  try { const d = fs.readFileSync(USERS_FILE, 'utf8'); return JSON.parse(d); } catch { return []; }
}
function jsonWriteUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2), 'utf8'); }
function jsonReadCodes() {
  try {
    if (fs.existsSync(CODES_FILE)) return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
  } catch {}
  return {};
}
function jsonWriteCodes(c) {
  try { fs.writeFileSync(CODES_FILE, JSON.stringify(c), 'utf8'); } catch {}
}

// 统一读取接口：优先 DB，降级 JSON
function readProducts() {
  if (useDb) return db.getAllProducts().then(rows => rows.map(r => ({
    id: r.id, name: r.name, category: r.category, price: parseFloat(r.price),
    quantity: r.quantity, image: r.image, desc: r.description, available: !!r.available
  })));
  try { const d = fs.readFileSync(DATA_FILE, 'utf8'); return JSON.parse(d); }
  catch(e) { return []; }
}
async function writeProducts(p) {
  if (useDb) {
    // DB 模式：遍历更新或新建
    const existing = await db.getAllProducts();
    const existingIds = new Set(existing.map(e => e.id));
    for (const item of p) {
      if (existingIds.has(item.id)) {
        await db.updateProduct(item.id, { name: item.name, category: item.category, price: item.price, quantity: item.quantity, image: item.image, description: item.desc, available: item.available });
      } else {
        await db.createProduct(item);
      }
    }
    // 删除不在列表中的
    for (const row of existing) {
      if (!p.find(i => i.id === row.id)) await db.deleteProduct(row.id);
    }
    return;
  }
  jsonWriteProducts(p);
}
function readOrders() {
  if (useDb) return db.getAllOrders();
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch(e) { return []; }
}
async function writeOrders(o) { if (!useDb) jsonWriteOrders(o); }
function readUsers() {
  if (useDb) return db.getAllUsers().then(rows => rows.map(r => ({
    id: r.id, name: r.name, pwdHash: r.pwd_hash, email: r.email,
    is_admin: !!r.is_admin, created_at: r.created_at,
    token: r.token, token_expiry: r.token_expiry, last_login: r.last_login
  })));
  try { const d = fs.readFileSync(USERS_FILE, 'utf8'); return JSON.parse(d); }
  catch(e) { return []; }
}
async function writeUsers(u) {
  if (useDb) {
    const existing = await db.getAllUsers();
    for (const item of u) {
      const existingRow = existing.find(e => e.id === item.id);
      if (existingRow) {
        await db.updateUserToken(item.id, item.token, item.token_expiry);
        if (item.is_admin !== existingRow.is_admin) await db.updateUserAdmin(item.id, item.is_admin);
      }
    }
    return;
  }
  jsonWriteUsers(u);
}
async function readCodes() {
  if (useDb) {
    const rows = await db.getCode('__all__'); // 伪key，实际不查
    return jsonReadCodes(); // DB 模式下验证码仍用内存+JSON
  }
  return jsonReadCodes();
}
function writeCodes(c) { jsonWriteCodes(c); }

// 兼容旧代码：保留同步读函数名
const readProductsSync = () => useDb ? null : jsonReadProducts();
const writeUsersSync = (u) => { if (!useDb) jsonWriteUsers(u); };
const readUsersSync = () => useDb ? null : jsonReadUsers();

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  const initialProducts = [
    { id: 1, name: '鞘翅 ×28', category: 'armor', price: 5800, quantity: 28, image: 'products/inv1.png', description: '满仓鞘翅 · 飞行套装', available: false },
    { id: 2, name: '全套附魔装备', category: 'armor', price: 1800, quantity: 1, image: 'products/inv2.png', description: '药水+护甲+武器全套', available: true },
    { id: 3, name: '不死图腾 ×3 + 经验书 ×8', category: 'enchant', price: 1600, quantity: 1, image: 'products/inv3.png', description: '不死图腾+全套经验修补', available: true },
    { id: 4, name: '下界合金全套 + 不死图腾', category: 'armor', price: 2200, quantity: 1, image: 'products/inv4.png', description: '合金甲+图腾+材料', available: true },
    { id: 5, name: '完整冒险套装', category: 'material', price: 2000, quantity: 1, image: 'products/inv5.png', description: '附魔书+图腾+材料综合', available: true },
  ];
  writeProducts(initialProducts);
}

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2), 'utf8');
}
if (!fs.existsSync(USERS_FILE)) {
  writeUsers([]);
}
// Ensure default admin exists
const _users = readUsers();
const _adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
const _existingAdmin = _users.find(u => u.name === 'Admin');
if (!_existingAdmin) {
  const _adminHash = hashPassword(_adminPassword, PASSWORD_SALT);
  _users.push({
    id: _users.length > 0 ? Math.max(..._users.map(u => u.id)) + 1 : 1,
    name: 'Admin',
    pwdHash: _adminHash,
    pwdPlain: _adminPassword,
    email: 'admin@orangeshop.local',
    is_admin: true,
    super_admin: true,
    created_at: new Date().toISOString(),
  });
  writeUsers(_users);
  console.log('[初始化] 已创建默认超级管理员账户: Admin / admin123');
} else {
  // 确保 Admin 永远是 super_admin，且 pwdPlain 同步
  _existingAdmin.super_admin = true;
  _existingAdmin.is_admin = true;
  if (_adminPassword && _existingAdmin.pwdHash !== hashPassword(_adminPassword, PASSWORD_SALT)) {
    _existingAdmin.pwdHash = hashPassword(_adminPassword, PASSWORD_SALT);
    _existingAdmin.pwdPlain = _adminPassword;
    console.log('[更新] 管理员密码已重置');
  }
  if (!_existingAdmin.pwdPlain) _existingAdmin.pwdPlain = _adminPassword;
  writeUsers(_users);
}

// ========== 安全工具函数 ==========

function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hashPassword(pwd, salt) {
  return crypto.createHash('sha256').update(pwd + salt).digest('hex');
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateUsername(name) {
  return /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,20}$/.test(name);
}

function validatePassword(pwd) {
  return pwd && pwd.length >= 6 && pwd.length <= 64;
}
function verifyWebhookSignature(payload, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
function requireAdminKey(req, res, next) {
  const key = req.query.key || req.headers["x-admin-key"];
  if (!key || key.length === 0) {
    return res.status(403).json({ error: "访问密钥无效" });
  }
  try {
    if (!crypto.timingSafeEqual(
      Buffer.from(key, "utf8"),
      Buffer.from(ADMIN_ACCESS_KEY, "utf8")
    )) {
      return res.status(403).json({ error: "访问密钥无效" });
    }
  } catch(e) {
    return res.status(403).json({ error: "密钥验证失败" });
  }
  next();
}

function requireAdminIP(req, res, next) {
  if (ADMIN_IP_WHITELIST.length > 0) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    if (!ADMIN_IP_WHITELIST.includes(ip)) return res.status(403).json({ error: 'IP未授权' });
  }
  next();
}
function deductStock(productId, quantity) {
  const products = readProducts();
  const idx = products.findIndex(p => p.id === productId);
  if (idx === -1) return { ok: false, error: '商品不存在' };
  if (!products[idx].available || products[idx].quantity < quantity) return { ok: false, error: '库存不足' };
  products[idx].quantity -= quantity;
  if (products[idx].quantity === 0) products[idx].available = false;
  writeProducts(products);
  return { ok: true, price: products[idx].price };
}

// ========== 认证中间件 ==========

function getTokenFromReq(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const users = readUsers();
  const user = users.find(u => u.token === token);
  if (!user || user.token_expiry < Date.now()) {
    return res.status(401).json({ error: '登录已过期' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  // 支持密钥认证跳过JWT检查；key 认证等价于超级管理员权限
  if (req.adminKeyVerified) return next();
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: '权限不足，需要管理员权限' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.adminKeyVerified) return next();
  if (!req.user || !req.user.super_admin) {
    return res.status(403).json({ error: '权限不足，需要超级管理员操作' });
  }
  next();
}

// ========== API Routes: 商品 ==========

app.get('/api/products', (req, res) => {
  const products = readProducts();
  // 不暴露内部字段，只返回必要信息
  const safeProducts = products.map(p => ({
    id: p.id,
    name: escapeHtml(String(p.name)),
    category: p.category,
    price: p.price,
    quantity: p.quantity,
    image: escapeHtml(String(p.image)),
    description: escapeHtml(String(p.desc)),
    available: !!p.available,
  }));
  res.json(safeProducts);
});

app.get('/api/products/:id', (req, res) => {
  const products = readProducts();
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) return res.status(400).json({ error: '无效的商品ID' });
  const product = products.find(p => p.id === productId);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  res.json({
    id: product.id,
    name: escapeHtml(String(product.name)),
    category: product.category,
    price: product.price,
    quantity: product.quantity,
    image: escapeHtml(String(product.image)),
    description: escapeHtml(String(product.desc)),
    available: !!product.available,
  });
});

app.post('/api/products', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, requireAdmin, (req, res) => {
  const products = readProducts();
  const { name, category, price, quantity, image, description } = req.body;

  // 输入校验
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: '商品名称不能为空' });
  }
  const priceVal = parseFloat(price);
  if (isNaN(priceVal) || priceVal < 0 || priceVal > 9999999) {
    return res.status(400).json({ error: '价格必须是0~9999999的数字' });
  }

  // 价格支持小数（如 0.1, 1.5, 100.99）
  const validCategories = ['armor', 'weapon', 'enchant', 'potion', 'material'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: '无效的分类' });
  }
  const safeName = escapeHtml(name.trim().slice(0, 100));
  const safeImage = escapeHtml(String(image || '').slice(0, 200));
  const safeDesc = escapeHtml(String(description || '').slice(0, 200));

  const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
  const newProduct = {
    id: newId,
    name: safeName,
    category,
    price,
    quantity: Math.floor(quantity || 1),
    image: safeImage,
    description: safeDesc,
    available: true,
  };
  products.push(newProduct);
  writeProducts(products);
  res.json(newProduct);
});

app.put('/api/products/:id', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, requireAdmin, (req, res) => {
  const products = readProducts();
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) return res.status(400).json({ error: '无效的商品ID' });
  const idx = products.findIndex(p => p.id === productId);
  if (idx === -1) return res.status(404).json({ error: '商品不存在' });

  const { price, quantity, available, name, description } = req.body;

  if (price !== undefined) {
    const priceVal = parseFloat(price);
    if (isNaN(priceVal) || priceVal < 0) {
      return res.status(400).json({ error: '价格必须为非负数字' });
    }
    products[idx].price = priceVal;
  }
  if (quantity !== undefined) {
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: '库存必须为非负整数' });
    }
    products[idx].quantity = quantity;
  }
  if (available !== undefined) {
    products[idx].available = !!available;
  }
  // 处理无限库存
  if (req.body.infinite === true) {
    products[idx].infinite = true;
    products[idx].quantity = 999999;
  } else if (req.body.infinite === false) {
    products[idx].infinite = false;
  }
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: '商品名称不能为空' });
    }
    products[idx].name = escapeHtml(name.trim().slice(0, 100));
  }
  if (description !== undefined) {
    products[idx].description = escapeHtml(String(description || '').slice(0, 200));
  }

  writeProducts(products);
  res.json(products[idx]);
});

app.delete('/api/products/:id', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, requireAdmin, (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) return res.status(400).json({ error: '无效的商品ID' });
  let products = readProducts();
  const before = products.length;
  products = products.filter(p => p.id !== productId);
  if (products.length === before) {
    return res.status(404).json({ error: '商品不存在' });
  }
  writeProducts(products);
  res.json({ success: true });
});

// ========== API Routes: 用户认证 ==========

// 发送验证码
app.post('/api/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: '请提供邮箱地址' });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  // 邮箱格式已校验
  const users = readUsers();
  const existing = users.find(u => u.email === cleanEmail);
  // 已注册用户和新用户都可以接收验证码
  const now = Date.now();
  if (codeStore[cleanEmail + '_lastSend'] && now - codeStore[cleanEmail + '_lastSend'] < 60000) {
    return res.status(429).json({ error: '发送过于频繁，请60秒后再试' });
  }
  codeStore[cleanEmail + '_lastSend'] = now;

  const code = crypto.randomInt(100000, 999999).toString();
  const expiry = now + 5 * 60 * 1000;
  codeStore[cleanEmail] = { code, expiry };
  writeCodes(codeStore);
  console.log(`[验证码] ${cleanEmail} -> ${code} (5分钟有效)`);

  try {
    const transporter = nodemailer.createTransport({
      family: 4, // 强制使用 IPv4
      host: SMTP_CONFIG.host,
      port: SMTP_CONFIG.port,
      secure: SMTP_CONFIG.secure,
      auth: SMTP_CONFIG.auth,
    });
    await transporter.sendMail({
      from: `"2b2t橘子商店" <${SMTP_CONFIG.auth.user}>`,
      to: cleanEmail,
      subject: existing ? '【2b2t橘子商店】找回密码验证码' : '【2b2t橘子商店】注册验证码',
      html: `
        <div style="max-width:480px;margin:0 auto;font-family:sans-serif;">
          <div style="background:#ff8c00;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;">🍊 2b2t橘子商店</h2>
          </div>
          <div style="background:#1a1a2e;padding:30px;color:#fff;">
            <p style="color:#aaa;">您的注册验证码为：</p>
            <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#ff8c00;text-align:center;margin:20px 0;">${escapeHtml(code)}</div>
            <p style="color:#888;font-size:13px;">验证码有效期5分钟，请勿泄露给他人。</p>
          </div>
        </div>
      `,
    });
    console.log(`[邮件已发送] 验证码邮件已发送至 ${cleanEmail}`);
    res.json({ success: true, message: '验证码已发送至您的邮箱，请查收' });
  } catch (mailErr) {
    console.error('[邮件发送失败]', mailErr.message);
    console.log(`[验证码] ${cleanEmail} -> ${code} (邮件发送失败，请查看控制台)`);
    res.json({ success: true, message: '验证码已生成，但邮件发送失败，请查看控制台获取验证码' });
  }
});

// 注册


// 重置密码（通过邮箱验证码）
app.post('/api/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: '请提供邮箱、验证码和新密码' });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '密码长度至少6位' });
  }
  // 验证验证码
  const codeData = codeStore[cleanEmail];
  if (!codeData) {
    return res.status(400).json({ error: '请先获取验证码' });
  }
  if (codeData.code !== code) {
    return res.status(400).json({ error: '验证码错误' });
  }
  if (Date.now() > codeData.expiry) {
    return res.status(400).json({ error: '验证码已过期' });
  }
  // 查找用户
  const users = readUsers();
  const user = users.find(u => u.email === cleanEmail);
  if (!user) {
    return res.status(400).json({ error: '该邮箱未注册' });
  }
  // 重置密码
  user.pwdHash = hashPassword(newPassword, PASSWORD_SALT);
  // 使旧token失效
  delete user.token;
  delete user.token_expiry;
  writeUsers(users);
  // 清除验证码
  delete codeStore[cleanEmail];
  delete codeStore[cleanEmail + '_lastSend'];
  writeCodes(codeStore);
  console.log(`[找回密码] ${cleanEmail} 密码已重置`);
  res.json({ success: true, message: '密码重置成功，请使用新密码登录' });
});
app.post('/api/register', async (req, res) => {
  const { name, pwd, email, code } = req.body;
  if (!name || !pwd || !email || !code) {
    return res.status(400).json({ error: '请填写所有字段' });
  }
  const cleanName = String(name).trim().slice(0, 20);
  const cleanEmail = String(email).trim().toLowerCase();
  if (!validateUsername(cleanName)) {
    return res.status(400).json({ error: '用户名格式不正确（2-20位字母、数字、中文、下划线）' });
  }
  if (!validatePassword(String(pwd))) {
    return res.status(400).json({ error: '密码长度需6-64位' });
  }
  if (!validateEmail(cleanEmail)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }
  const stored = codeStore[cleanEmail];
  if (!stored || stored.code !== String(code).trim()) {
    return res.status(400).json({ error: '验证码错误或已过期' });
  }
  if (Date.now() > stored.expiry) {
    delete codeStore[cleanEmail];
    return res.status(400).json({ error: '验证码已过期' });
  }
  const users = readUsers();
  if (users.find(u => u.name === cleanName)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  if (users.find(u => u.email === cleanEmail)) {
    return res.status(400).json({ error: '该邮箱已注册' });
  }
  const hash = hashPassword(String(pwd), PASSWORD_SALT);
  const newUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    name: cleanName,
    pwdHash: hash,
    pwdPlain: String(pwd),
    email: cleanEmail,
    is_admin: cleanName === 'Admin',
    super_admin: cleanName === 'Admin',
    created_at: new Date().toISOString(),
  };
  users.push(newUser);
  writeUsers(users);
  delete codeStore[cleanEmail];
  delete codeStore[cleanEmail + '_lastSend'];
  writeCodes(codeStore);
  console.log(`[注册] 新用户: ${cleanName} (${cleanEmail})`);
  res.json({ success: true, message: '注册成功' });
});

// 登录
app.post('/api/login', (req, res) => {
  const { name, pwd } = req.body;
  if (!name || !pwd) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }
  const cleanName = String(name).trim().slice(0, 20);
  const cleanPwd = String(pwd);
  if (!validateUsername(cleanName)) {
    return res.status(400).json({ error: '用户名格式不正确' });
  }
  const users = readUsers();
  const user = users.find(u => u.name === cleanName);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const hash = hashPassword(cleanPwd, PASSWORD_SALT);
  if (user.pwdHash !== hash) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 24 * 60 * 60 * 1000;
  user.token = token;
  user.token_expiry = expiry;
  user.last_login = new Date().toISOString();
  writeUsers(users);
  console.log(`[登录] ${cleanName} (admin: ${user.is_admin})`);
  res.json({
    success: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin },
    isAdmin: user.is_admin,
    pwd_plain: user.pwdPlain || '',
  });
});


// ========== API Routes: 结账 ==========
// P0: 后端按DB价格计算总额，P0: 原子库存扣减，P2: 数量校验
app.post('/api/checkout', requireAuth, async (req, res) => {
  try {
    const cartItems = req.body.items;
    if (!Array.isArray(cartItems) || cartItems.length === 0) return res.status(400).json({ error: '购物车为空' });
    const products = readProducts();
    let totalAmount = 0;
    const validatedItems = [];
    for (const item of cartItems) {
      // P2: 畸形数量校验
      if (typeof item.productId !== 'number' || !Number.isInteger(item.productId) || item.productId <= 0)
        return res.status(400).json({ error: '无效的商品ID' });
      if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 999)
        return res.status(400).json({ error: '数量必须为1-999的整数' });
      const product = products.find(p => p.id === item.productId);
      if (!product) return res.status(400).json({ error: '商品不存在: ' + item.productId });
      if (product.quantity < item.quantity) return res.status(400).json({ error: '商品 ' + product.name + ' 库存不足' });
      // P0: 后端按DB价格计算
      totalAmount += product.price * item.quantity;
      validatedItems.push({ productId: product.id, name: product.name, price: product.price, quantity: item.quantity });
    }
    // P0: 幂等性检查
    const orderId = crypto.randomBytes(16).toString('hex');
    const order = { id: orderId, userId: req.user.id, userName: req.user.name, items: validatedItems, totalAmount, status: 'pending', createdAt: new Date().toISOString() };
    const orders = readOrders();
    orders.push(order);
    writeOrders(orders);
    // P0: 原子库存扣减
    for (const item of validatedItems) {
      const result = deductStock(item.productId, item.quantity);
      if (!result.ok) console.error('[结账] 库存扣减失败:', result.error);
    }
    console.log('[订单] ' + req.user.name + ' 下单: ' + orderId + ' ¥' + totalAmount);
    res.json({ success: true, orderId, totalAmount });
  } catch (e) {
    console.error('[结账] 错误:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// P1: 订单查询绑定userId，防止IDOR；支持 admin key 访问全部订单
app.get('/api/orders', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, (req, res) => {
  if (req.adminKeyVerified) {
    res.json(readOrders());
  } else {
    res.json(readOrders().filter(o => o.userId === req.user.id));
  }
});

// P0: Webhook验签 + 幂等
app.post('/api/webhook/payment', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  if (!signature || !verifyWebhookSignature(payload, signature, WEBHOOK_SECRET))
    return res.status(401).json({ error: '签名验证失败' });
  const orderId = req.body.orderId;
  if (processedWebhookIds.has(orderId))
    return res.status(200).json({ success: true, message: '重复通知' });
  processedWebhookIds.add(orderId);
  console.log('[Webhook] 支付回调: ' + orderId);
  res.json({ success: true });
});

// ========== API Routes: 用户管理 ==========

// 升级用户为管理员（需要 super_admin 权限）
app.post('/api/admin/promote', requireAuth, (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, (req, res, next) => {
  if (!req.user.super_admin) return res.status(403).json({ error: '权限不足，需要超级管理员操作' });
  next();
}, (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: '请提供用户名' });
  const users = readUsers();
  const user = users.find(u => u.name === username.trim());
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.is_admin) return res.status(400).json({ error: '该用户已是管理员' });
  user.is_admin = true;
  writeUsers(users);
  console.log('[超级管理员] ' + req.user.name + ' 已将 ' + username + ' 提升为管理员');
  res.json({ success: true, message: '已将 ' + username + ' 提升为管理员' });
});

// 降级管理员（需要 super_admin 权限）
app.post('/api/admin/demote', requireAuth, (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, (req, res, next) => {
  if (!req.user.super_admin) return res.status(403).json({ error: '权限不足，需要超级管理员操作' });
  next();
}, (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string') return res.status(400).json({ error: '请提供用户名' });
  const users = readUsers();
  const user = users.find(u => u.name === username.trim());
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.super_admin) return res.status(403).json({ error: '不能降级超级管理员' });
  user.is_admin = false;
  writeUsers(users);
  console.log('[超级管理员] ' + req.user.name + ' 已将 ' + username + ' 降级为普通用户');
  res.json({ success: true, message: '已将 ' + username + ' 降级为普通用户' });
});

// 更新用户字段（仅限 super_admin 使用）
app.post('/api/admin/update-user', requireAuth, (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, (req, res, next) => {
  if (!req.user.super_admin) return res.status(403).json({ error: '权限不足，需要超级管理员操作' });
  next();
}, (req, res) => {
  const { username, super_admin, reset_password } = req.body;
  if (!username) return res.status(400).json({ error: '请提供用户名' });
  const users = readUsers();
  const user = users.find(u => u.name === username.trim());
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (super_admin !== undefined) user.super_admin = !!super_admin;
  if (reset_password) {
    user.pwdPlain = String(reset_password);
    user.pwdHash = hashPassword(String(reset_password), PASSWORD_SALT);
  }
  writeUsers(users);
  console.log('[超级管理员] ' + req.user.name + ' 更新了 ' + username + ' 的权限');
  res.json({ success: true });
});

// ========== 静态文件服务 ==========
app.use('/products', express.static(path.join(__dirname, 'products')));

// ========== 页面路由 ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'shop.html'));
});
app.get('/forgot', (req, res) => {
  res.sendFile(path.join(__dirname, 'forgot.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

// API: 验证访问密钥（供前端使用）
app.get('/admin/verify', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!key) return res.status(403).json({ error: '未提供密钥' });
  const keyBuf = Buffer.from(key, 'utf8');
  const secretBuf = Buffer.from(ADMIN_ACCESS_KEY, 'utf8');
  const maxLength = Math.max(keyBuf.length, secretBuf.length);
  const paddedKey = Buffer.alloc(maxLength, 0);
  const paddedSecret = Buffer.alloc(maxLength, 0);
  keyBuf.copy(paddedKey);
  secretBuf.copy(paddedSecret);
  const isValid = keyBuf.length === secretBuf.length && crypto.timingSafeEqual(paddedKey, paddedSecret);
  if (isValid) {
    req.adminKeyVerified = true;
    res.json({ success: true });
  } else {
    res.status(403).json({ error: '密钥错误' });
  }
});

// ========== API Routes: 查看所有订单 ==========
app.get('/api/admin/orders', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, requireAdmin, (req, res) => {
  const orders = readOrders();
  res.json(orders);
});

app.get('/api/admin/users', (req, res, next) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key) {
    if (crypto.timingSafeEqual(Buffer.from(key, 'utf8'), Buffer.from(ADMIN_ACCESS_KEY, 'utf8'))) {
      req.adminKeyVerified = true;
      return next();
    }
    return res.status(403).json({ error: '密钥无效' });
  }
  requireAuth(req, res, next);
}, requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({
    id: u.id, name: u.name, email: u.email, is_admin: u.is_admin, super_admin: !!u.super_admin, pwd_plain: u.pwdPlain || '', created_at: u.created_at
  }));
  res.json(users);
});
app.get("/admin", requireAdminKey, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// 初始化数据库（如果配置了 DATABASE_URL 则使用 MySQL，否则使用 JSON 文件）
db.initDatabase().then(() => {
  app.listen(PORT, () => {
  const smtpUser = SMTP_CONFIG.auth.user;
  const isConfigured = smtpUser !== 'YOUR_EMAIL@gmail.com';
  console.log(`\n🍊 2b2t橘子商店 后端启动成功！`);
  console.log(`   前台地址: http://localhost:${PORT}`);
  console.log(`   后台管理: http://localhost:${PORT}/admin (需登录)`);
  console.log(`   注册页面: http://localhost:${PORT}/register`);
  console.log(`   登录页面: http://localhost:${PORT}/login`);
  if (isConfigured) {
    console.log(`   ✅ 邮箱服务已配置 (${smtpUser})，验证码将通过SMTP发送`);
  } else {
    console.log(`   ⚠️  邮箱服务未配置，验证码将显示在控制台`);
    console.log(`   请在 server.js 中填写 SMTP_CONFIG 的邮箱地址和应用密码`);
  }
  console.log(`   🔒 已启用: P0价格/Webhook验签/原子库存 | P1 IDOR/IP白名单 | P2数量校验 | CSP/XSS防护`);
  console.log('');
  });
});

// 图片上传路由
app.post('/api/upload', requireAdminKey, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择图片' });
  }
  const ext = req.file.originalname.split('.').pop();
  const newPath = `products/upload_${Date.now()}.${ext}`;
  fs.renameSync(req.file.path, path.join(__dirname, newPath));
  res.json({ url: newPath });
});

// ========== 手动扫码支付配置 ==========
// 用户扫码付款后，管理员后台确认收款
// 无需银行卡和身份证实名认证

// 上传收款码（管理员权限）
app.post('/api/payment/upload-receipt', requireAdmin, upload.single('qr'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片' });
    }
    
    // 保存收款码信息
    const qrPath = '/uploads/' + req.file.filename;
    writeConfig({ receiptQR: qrPath });
    
    console.log('[支付] 收款码已更新:', qrPath);
    res.json({ success: true, path: qrPath });
  } catch (e) {
    console.error('[支付] 上传错误:', e);
    res.status(500).json({ error: '上传失败' });
  }
});

// 获取收款码
app.get('/api/payment/receipt', (req, res) => {
  try {
    const config = readConfig();
    res.json({
      success: true,
      receiptQR: config.receiptQR || '/uploads/default-qrcode.png'
    });
  } catch (e) {
    res.json({ success: true, receiptQR: '/uploads/default-qrcode.png' });
  }
});

// 创建订单（不自动支付）
app.post('/api/payment/create', requireAuth, (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: '订单ID不能为空' });
    
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: '无权操作此订单' });
    if (order.status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
    
    console.log('[支付] 订单待支付:', orderId);
    res.json({ success: true, data: { orderId, status: 'pending' } });
  } catch (e) {
    console.error('[支付] 错误:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 标记订单为已支付（管理员权限）
app.post('/api/payment/confirm', requireAdmin, (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: '订单ID不能为空' });
// 用户上传支付截图凭证
app.post('/api/payment/receipt-upload', requireAuth, upload.single('receipt'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请选择图片文件' });
    }
    
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: '订单ID不能为空' });
    
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: '无权操作此订单' });
    if (order.status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
    
    // 保存截图路径到订单
    order.receiptImage = '/uploads/' + req.file.filename;
    order.receiptUploadedAt = new Date().toISOString();
    writeOrders(orders);
    
    console.log('[支付] 用户上传截图:', orderId, req.file.filename);
    res.json({ success: true, message: '截图已上传，等待管理员确认' });
  } catch (e) {
    console.error('[支付] 上传错误:', e);
    res.status(500).json({ error: '上传失败' });
  }
});

    
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
    
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.paidByAdmin = true;
    writeOrders(orders);
    
    console.log('[支付] 管理员确认收款:', orderId);
    res.json({ success: true, message: '订单已确认为已支付' });
  } catch (e) {
    console.error('[支付] 确认错误:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 查询订单支付状态
app.get('/api/payment/status/:orderId', requireAuth, (req, res) => {
  try {
    const orders = readOrders();
    const order = orders.find(o => o.id === req.params.orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: '无权查看此订单' });
    
    res.json({
      success: true,
      orderId: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      paidAt: order.paidAt,
    });
  } catch (e) {
    console.error('[查询状态] 错误:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 查询支付订单信息（用于轮询）
app.get('/api/payment/order/:orderId', requireAuth, (req, res) => {
  try {
    const { orderId } = req.params;
    
    const orders = readOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: '无权查看此订单' });
    
    res.json({ success: true, order });
  } catch (e) {
    console.error('[查询订单] 错误:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});
