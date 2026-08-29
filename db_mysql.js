// Database Layer - Support MySQL and PostgreSQL (Supabase)
const mysql = require('mysql2/promise');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
let pool = null;
let pgClient = null;
let useMySQL = false;
let isPostgresMode = false;

async function initDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.log('[DB] 未找到 DATABASE_URL，使用 JSON 文件存储');
    useMySQL = false;
    return;
  }
  
  try {
    // 检测是 MySQL 还是 PostgreSQL
    const isPostgres = dbUrl.includes('postgres') || dbUrl.includes('supabase');
    
    if (isPostgres) {
      // 使用 pg 驱动连接 PostgreSQL
      isPostgresMode = true;
      console.log('[DB] 连接到 PostgreSQL (Supabase)...');
      pgClient = new Client({
        connectionString: dbUrl,
        family: 4,
      });
      await pgClient.connect();
      useMySQL = true;
      console.log('[DB] PostgreSQL 连接成功 ✅');
      await createTables();
    } else {
      // 使用 mysql2 驱动连接 MySQL
      isPostgresMode = false;
      console.log('[DB] 连接到 MySQL...');
      pool = await mysql.createPool({
        uri: dbUrl,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      await pool.query('SELECT 1');
      useMySQL = true;
      console.log('[DB] MySQL 连接成功 ✅');
      await createTables();
    }
    
  } catch (e) {
    console.error('[DB] 连接失败，回退到 JSON 文件存储:', e.message);
    useMySQL = false;
    isPostgresMode = false;
  }
}

async function createTables() {
  if (isPostgresMode) {
    if (!pgClient) return;
    try {
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          category VARCHAR(50) NOT NULL,
          price DECIMAL(10,2) NOT NULL DEFAULT 0,
          quantity INT NOT NULL DEFAULT 1,
          image VARCHAR(200),
          description TEXT,
          available BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] products 表就绪');
      
      await pgClient.query(`
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
      
      await pgClient.query(`
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
      
      await pgClient.query(`
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

      // 图片存储表（PostgreSQL）
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS images (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          data BYTEA NOT NULL,
          mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
          size INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] images 表就绪');
    } catch (e) {
      console.error('[DB] 创建表失败:', e.message);
    }
  } else {
    if (!pool) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          category VARCHAR(50) NOT NULL,
          price DECIMAL(10,2) NOT NULL DEFAULT 0,
          quantity INT NOT NULL DEFAULT 1,
          image VARCHAR(200),
          description TEXT,
          available BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] products 表就绪');
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
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
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(64) PRIMARY KEY,
          user_id INT NOT NULL,
          user_name VARCHAR(20) NOT NULL,
          items JSON NOT NULL,
          total_amount DECIMAL(10,2) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] orders 表就绪');
      
      await pool.query(`
        CREATE TABLE IF NOT EXISTS codes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(100) NOT NULL UNIQUE,
          code VARCHAR(6) NOT NULL,
          expiry BIGINT NOT NULL,
          last_send BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] codes 表就绪');

      // 图片存储表（MySQL）
      await pool.query(`
        CREATE TABLE IF NOT EXISTS images (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          data LONGBLOB NOT NULL,
          mime_type VARCHAR(50) NOT NULL DEFAULT 'image/png',
          size INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('[DB] images 表就绪');
    } catch (e) {
      console.error('[DB] 创建表失败:', e.message);
    }
  }
}

// ========== 商品操作 ==========
async function getAllProducts() {
  if (isPostgresMode) {
    if (!pgClient) return [];
    const result = await pgClient.query('SELECT * FROM products ORDER BY id');
    return result.rows;
  } else {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM products ORDER BY id');
    return rows;
  }
}

async function getProductById(id) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query('SELECT * FROM products WHERE id = $1', [id]);
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    return rows[0] || null;
  }
}

async function createProduct(data) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query(
      'INSERT INTO products (name, category, price, quantity, image, description, available) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [data.name, data.category, data.price, data.quantity, data.image, data.description, data.available]
    );
    return result.rows[0];
  } else {
    if (!pool) return null;
    const [result] = await pool.query(
      'INSERT INTO products (name, category, price, quantity, image, description, available) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [data.name, data.category, data.price, data.quantity, data.image, data.description, data.available]
    );
    return getProductById(result.insertId);
  }
}

async function updateProduct(id, data) {
  if (isPostgresMode) {
    if (!pgClient) return null;
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
    const result = await pgClient.query(
      `UPDATE products SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const setClauses = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (setClauses.length === 0) return null;
    values.push(id);
    await pool.query(`UPDATE products SET ${setClauses.join(', ')} WHERE id=?`, values);
    return getProductById(id);
  }
}

async function deleteProduct(id) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    const result = await pgClient.query('DELETE FROM products WHERE id=$1', [id]);
    return result.rowCount > 0;
  } else {
    if (!pool) return false;
    const [result] = await pool.query('DELETE FROM products WHERE id=?', [id]);
    return result.affectedRows > 0;
  }
}

async function deductStock(productId, quantity) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    const result = await pgClient.query(
      'SELECT * FROM products WHERE id=$1 AND available=true AND quantity>=$2',
      [productId, quantity]
    );
    if (result.rows.length === 0) return false;
    await pgClient.query('UPDATE products SET quantity=quantity-$1 WHERE id=$2', [quantity, productId]);
    return true;
  } else {
    if (!pool) return false;
    const [rows] = await pool.query('SELECT * FROM products WHERE id=? AND available=? AND quantity>=?', [productId, true, quantity]);
    if (rows.length === 0) return false;
    await pool.query('UPDATE products SET quantity=quantity-? WHERE id=?', [quantity, productId]);
    return true;
  }
}

// ========== 用户操作 ==========
async function getAllUsers() {
  if (isPostgresMode) {
    if (!pgClient) return [];
    const result = await pgClient.query('SELECT id, name, email, is_admin, created_at FROM users ORDER BY id');
    return result.rows;
  } else {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT id, name, email, is_admin, created_at FROM users ORDER BY id');
    return rows;
  }
}

async function findUserByName(name) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query('SELECT * FROM users WHERE name=$1', [name]);
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM users WHERE name=?', [name]);
    return rows[0] || null;
  }
}

async function createUser(data) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query(
      'INSERT INTO users (name, pwd_hash, email, is_admin) VALUES ($1, $2, $3, $4) RETURNING *',
      [data.name, data.pwdHash, data.email, data.is_admin]
    );
    return result.rows[0];
  } else {
    if (!pool) return null;
    const [result] = await pool.query(
      'INSERT INTO users (name, pwd_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      [data.name, data.pwdHash, data.email, data.is_admin]
    );
    return findUserByName(data.name);
  }
}

async function updateUserToken(userId, token, expiry) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query(
      'UPDATE users SET token=$1, token_expiry=$2, last_login=CURRENT_TIMESTAMP WHERE id=$3',
      [token, expiry, userId]
    );
    return true;
  } else {
    if (!pool) return false;
    await pool.query('UPDATE users SET token=?, token_expiry=?, last_login=? WHERE id=?', [token, expiry, new Date().toISOString(), userId]);
    return true;
  }
}

async function findUserByToken(token) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query('SELECT * FROM users WHERE token=$1', [token]);
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM users WHERE token=?', [token]);
    return rows[0] || null;
  }
}

async function updateUserAdmin(userId, isAdmin) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query('UPDATE users SET is_admin=$1 WHERE id=$2', [isAdmin, userId]);
    return true;
  } else {
    if (!pool) return false;
    await pool.query('UPDATE users SET is_admin=? WHERE id=?', [isAdmin, userId]);
    return true;
  }
}

// ========== 订单操作 ==========
async function getAllOrders() {
  if (isPostgresMode) {
    if (!pgClient) return [];
    const result = await pgClient.query('SELECT * FROM orders ORDER BY created_at DESC');
    return result.rows;
  } else {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    return rows;
  }
}

async function getOrdersByUserId(userId) {
  if (isPostgresMode) {
    if (!pgClient) return [];
    const result = await pgClient.query(
      'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  } else {
    if (!pool) return [];
    const [rows] = await pool.query('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC', [userId]);
    return rows;
  }
}

async function createOrder(order) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query(
      'INSERT INTO orders (id, user_id, user_name, items, total_amount, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [order.id, order.userId, order.userName, JSON.stringify(order.items), order.totalAmount, order.status]
    );
    return true;
  } else {
    if (!pool) return false;
    await pool.query(
      'INSERT INTO orders (id, user_id, user_name, items, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
      [order.id, order.userId, order.userName, JSON.stringify(order.items), order.totalAmount, order.status]
    );
    return true;
  }
}

// ========== 验证码操作 ==========
async function getCode(email) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query('SELECT * FROM codes WHERE email=$1', [email]);
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM codes WHERE email=?', [email]);
    return rows[0] || null;
  }
}

async function saveCode(email, data) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query(
      'INSERT INTO codes (email, code, expiry, last_send) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET code=$2, expiry=$3, last_send=$4',
      [email, data.code, data.expiry, data.lastSend]
    );
    return true;
  } else {
    if (!pool) return false;
    await pool.query(
      'INSERT INTO codes (email, code, expiry, last_send) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE code=?, expiry=?, last_send=?',
      [email, data.code, data.expiry, data.lastSend, data.code, data.expiry, data.lastSend]
    );
    return true;
  }
}

async function deleteCode(email) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query('DELETE FROM codes WHERE email=$1', [email]);
    return true;
  } else {
    if (!pool) return false;
    await pool.query('DELETE FROM codes WHERE email=?', [email]);
    return true;
  }
}

// 关闭连接
async function closeDatabase() {
  if (isPostgresMode) {
    if (pgClient) {
      await pgClient.end();
      pgClient = null;
    }
  } else {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}

// ========== 图片操作 ==========
async function saveImage(id, name, data, mimeType, size) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    await pgClient.query(
      'INSERT INTO images (id, name, data, mime_type, size) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET name=$2, data=$3, mime_type=$4, size=$5',
      [id, name, data, mimeType, size]
    );
    return true;
  } else {
    if (!pool) return false;
    await pool.query(
      'INSERT INTO images (id, name, data, mime_type, size) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), data=VALUES(data), mime_type=VALUES(mime_type), size=VALUES(size)',
      [id, name, data, mimeType, size]
    );
    return true;
  }
}

async function getImage(id) {
  if (isPostgresMode) {
    if (!pgClient) return null;
    const result = await pgClient.query('SELECT * FROM images WHERE id=$1', [id]);
    return result.rows[0] || null;
  } else {
    if (!pool) return null;
    const [rows] = await pool.query('SELECT * FROM images WHERE id=?', [id]);
    return rows[0] || null;
  }
}

async function deleteImage(id) {
  if (isPostgresMode) {
    if (!pgClient) return false;
    const result = await pgClient.query('DELETE FROM images WHERE id=$1', [id]);
    return result.rowCount > 0;
  } else {
    if (!pool) return false;
    const [result] = await pool.query('DELETE FROM images WHERE id=?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = {
  initDatabase,
  useMySQL,
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
  deleteCode,
  // 图片
  saveImage,
  getImage,
  deleteImage,
  closeDatabase
};
