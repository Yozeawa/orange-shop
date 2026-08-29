// Database Layer - PostgreSQL (Supabase) with retry and timeout
const { Client } = require('pg');
let client = null;
let useDB = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// 带重试的数据库连接
async function connectWithRetry(retries = MAX_RETRIES) {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.log('[DB] 未找到 DATABASE_URL，使用 JSON 文件存储');
    return null;
  }
  
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[DB] 尝试连接 PostgreSQL (尝试 ${i + 1}/${retries})...`);
      const c = new Client({
        connectionString: dbUrl,
        // 支持 IPv4/IPv6 双栈连接
        connectTimeoutSeconds: 10,
        statement_timeout: 5000,
      });
      await c.connect();
      console.log('[DB] PostgreSQL 连接成功 ✅');
      return c;
    } catch (e) {
      console.error(`[DB] 连接失败 (${i + 1}/${retries}):`, e.message);
      if (i < retries - 1) {
        console.log(`[DB] 等待 ${RETRY_DELAY}ms 后重试...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }
  }
  
  console.log('[DB] 所有连接尝试失败，回退到 JSON 文件存储');
  return null;
}

async function initDatabase() {
  client = await connectWithRetry();
  
  if (client) {
    useDB = true;
    try {
      await createTables();
      // 测试查询
      await client.query('SELECT 1');
      console.log('[DB] 数据库初始化完成 ✅');
    } catch (e) {
      console.error('[DB] 初始化失败:', e.message);
      useDB = false;
      client = null;
    }
  } else {
    useDB = false;
  }
}

async function createTables() {
  if (!client) return;
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 1,
        image VARCHAR(200),
        desc TEXT,
        available BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[DB] products 表就绪');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(20) NOT NULL UNIQUE,
        pwd_hash VARCHAR(64) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        is_admin BOOLEAN DEFAULT false,
        token VARCHAR(128),
        token_expiry BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);
    console.log('[DB] users 表就绪');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        user_name VARCHAR(20) NOT NULL,
        items JSONB NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[DB] orders 表就绪');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS codes (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) NOT NULL UNIQUE,
        code VARCHAR(6) NOT NULL,
        expiry BIGINT NOT NULL,
        last_send BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[DB] codes 表就绪');
    
  } catch (e) {
    console.error('[DB] 创建表失败:', e.message);
  }
}

// ========== 商品操作 ==========
async function getAllProducts() {
  if (!client) return [];
  const result = await client.query('SELECT * FROM products ORDER BY id');
  return result.rows;
}
async function getProductById(id) {
  if (!client) return null;
  const result = await client.query('SELECT * FROM products WHERE id = $1', [id]);
  return result.rows[0] || null;
}
async function createProduct(data) {
  if (!client) return null;
  const result = await client.query(
    'INSERT INTO products (name, category, price, quantity, image, desc, available) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [data.name, data.category, data.price, data.quantity, data.image, data.desc, data.available]
  );
  return result.rows[0];
}
async function updateProduct(id, data) {
  if (!client) return null;
  const setClauses = [];
  const values = [];
  let paramIndex = 1;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(value);
    }
  }
  if (setClauses.length === 0) return null;
  values.push(id);
  const result = await client.query(
    `UPDATE products SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}
async function deleteProduct(id) {
  if (!client) return false;
  const result = await client.query('DELETE FROM products WHERE id=$1', [id]);
  return result.rowCount > 0;
}
async function deductStock(productId, quantity) {
  if (!client) return false;
  const result = await client.query(
    'SELECT * FROM products WHERE id=$1 AND available=true AND quantity>=$2',
    [productId, quantity]
  );
  if (result.rows.length === 0) return false;
  await client.query('UPDATE products SET quantity=quantity-$1 WHERE id=$2', [quantity, productId]);
  return true;
}
// ========== 用户操作 ==========
async function getAllUsers() {
  if (!client) return [];
  const result = await client.query('SELECT id, name, email, is_admin, created_at FROM users ORDER BY id');
  return result.rows;
}
async function findUserByName(name) {
  if (!client) return null;
  const result = await client.query('SELECT * FROM users WHERE name=$1', [name]);
  return result.rows[0] || null;
}
async function createUser(data) {
  if (!client) return null;
  const result = await client.query(
    'INSERT INTO users (name, pwd_hash, email, is_admin) VALUES ($1, $2, $3, $4) RETURNING *',
    [data.name, data.pwdHash, data.email, data.is_admin]
  );
  return result.rows[0];
}
async function updateUserToken(userId, token, expiry) {
  if (!client) return false;
  await client.query(
    'UPDATE users SET token=$1, token_expiry=$2, last_login=CURRENT_TIMESTAMP WHERE id=$3',
    [token, expiry, userId]
  );
  return true;
}
async function findUserByToken(token) {
  if (!client) return null;
  const result = await client.query('SELECT * FROM users WHERE token=$1', [token]);
  return result.rows[0] || null;
}
async function updateUserAdmin(userId, isAdmin) {
  if (!client) return false;
  await client.query('UPDATE users SET is_admin=$1 WHERE id=$2', [isAdmin, userId]);
  return true;
}
// ========== 订单操作 ==========
async function getAllOrders() {
  if (!client) return [];
  const result = await client.query('SELECT * FROM orders ORDER BY created_at DESC');
  return result.rows;
}
async function getOrdersByUserId(userId) {
  if (!client) return [];
  const result = await client.query(
    'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows;
}
async function createOrder(order) {
  if (!client) return false;
  await client.query(
    'INSERT INTO orders (id, user_id, user_name, items, total_amount, status) VALUES ($1, $2, $3, $4, $5, $6)',
    [order.id, order.userId, order.userName, JSON.stringify(order.items), order.totalAmount, order.status]
  );
  return true;
}
// ========== 验证码操作 ==========
async function getCode(email) {
  if (!client) return null;
  const result = await client.query('SELECT * FROM codes WHERE email=$1', [email]);
  return result.rows[0] || null;
}
async function saveCode(email, data) {
  if (!client) return false;
  await client.query(
    'INSERT INTO codes (email, code, expiry, last_send) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET code=$2, expiry=$3, last_send=$4',
    [email, data.code, data.expiry, data.lastSend]
  );
  return true;
}
async function deleteCode(email) {
  if (!client) return false;
  await client.query('DELETE FROM codes WHERE email=$1', [email]);
  return true;
}
// 关闭连接
async function closeDatabase() {
  if (client) {
    await client.end();
    client = null;
  }
}
module.exports = {
  useMySQL: useDB,
  initDatabase,
  closeDatabase,
  useDB,
  // 商品
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deductStock,
  // 用户
  getAllUsers,
  findUserByName,
  createUser,
  updateUserToken,
  findUserByToken,
  updateUserAdmin,
  // 订单
  getAllOrders,
  getOrdersByUserId,
  createOrder,
  // 验证码
  getCode,
  saveCode,
  deleteCode
};
