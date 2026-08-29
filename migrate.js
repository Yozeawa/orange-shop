// Database Migration Script - JSON to PostgreSQL
const { Client } = require('pg');
const fs = require('fs');

const dbUrl = process.env.DATABASE_URL || '';

async function init() {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('✅ 连接到PostgreSQL成功');
  
  // 创建表
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
  console.log('✅ products 表创建成功');
  
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
  console.log('✅ users 表创建成功');
  
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
  console.log('✅ orders 表创建成功');
  
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
  console.log('✅ codes 表创建成功');
  
  // 迁移产品数据
  const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
  for (const p of products) {
    await client.query(
      'INSERT INTO products (id, name, category, price, quantity, image, desc, available) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO UPDATE SET name=$2, category=$3, price=$4, quantity=$5, image=$6, desc=$7, available=$8',
      [p.id, p.name, p.category, p.price, p.quantity, p.image, p.desc, p.available]
    );
  }
  console.log('✅ 迁移了', products.length, '个商品');
  
  // 迁移用户数据
  const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
  for (const u of users) {
    await client.query(
      'INSERT INTO users (id, name, pwd_hash, email, is_admin, token, token_expiry, created_at, last_login) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET name=$2, pwd_hash=$3, email=$4, is_admin=$5',
      [u.id, u.name, u.pwdHash, u.email, u.is_admin, u.token || null, u.token_expiry || null, u.created_at || null, u.last_login || null]
    );
  }
  console.log('✅ 迁移了', users.length, '个用户');
  
  // 迁移订单数据
  const orders = JSON.parse(fs.readFileSync('orders.json', 'utf8'));
  for (const o of orders) {
    await client.query(
      'INSERT INTO orders (id, user_id, user_name, items, total_amount, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
      [o.id, o.userId, o.userName, JSON.stringify(o.items), o.totalAmount, o.status, o.createdAt || new Date().toISOString()]
    );
  }
  console.log('✅ 迁移了', orders.length, '个订单');
  
  await client.end();
  console.log('');
  console.log('========================================');
  console.log('  ✅ 数据库迁移完成!');
  console.log('========================================');
}

init().catch(e => console.error('❌ 错误:', e.message));