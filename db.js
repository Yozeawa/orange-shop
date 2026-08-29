
// Persistent Storage Layer
// Auto-migrates data to persist across restarts

const fs = require('fs');
const path = require('path');

// Use data/ directory for persistence
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

console.log('[DB] Data directory:', DATA_DIR);

class Store {
  constructor(name) { this.file = path.join(DATA_DIR, name); }
  read() {
    try { return fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : []; }
    catch(e) { console.error('[DB] Read error', e.message); return []; }
  }
  write(data) {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(data, null, 2)); }
    catch(e) { console.error('[DB] Write error', e.message); }
  }
}

const products = new Store('products.json');
const users = new Store('users.json');
const orders = new Store('orders.json');
const codes = new Store('codes.json');

// Migration from root directory
['products','users','orders','codes'].forEach(name => {
  const old = path.join(__dirname, name + '.json');
  const newf = path.join(DATA_DIR, name + '.json');
  if (fs.existsSync(old) && !fs.existsSync(newf)) {
    fs.copyFileSync(old, newf);
    console.log('[DB] Migrated', name);
  }
});

// Backward compatible API
module.exports = {
  readProducts: () => products.read(),
  writeProducts: (d) => products.write(d),
  readUsers: () => users.read(),
  writeUsers: (d) => users.write(d),
  readOrders: () => orders.read(),
  writeOrders: (d) => orders.write(d),
  readCodes: () => codes.read(),
  writeCodes: (d) => codes.write(d),
  initData: () => {
    if (!products.read().length) {
      products.write([
        { id: 1, name: '鞍翼 ×28', category: 'armor', price: 5800, quantity: 28, image: 'products/inv1.png', desc: '满仓鞍翼 · 飞行套装', available: false },
        { id: 2, name: '全套附魔装备', category: 'armor', price: 1800, quantity: 1, image: 'products/inv2.png', desc: '药水+护甲+武器全套', available: true },
        { id: 3, name: '不死图腾 ×3 + 经验书 ×8', category: 'enchant', price: 1600, quantity: 1, image: 'products/inv3.png', desc: '不死图腾+全套经验修补', available: true },
        { id: 4, name: '下界合金全套 + 不死图腾', category: 'armor', price: 2200, quantity: 1, image: 'products/inv4.png', desc: '合金甲+图腾+材料', available: true },
        { id: 5, name: '完整冒险套装', category: 'material', price: 2000, quantity: 1, image: 'products/inv5.png', desc: '附魔书+图腾+材料综合', available: true }
      ]);
    }
    if (!users.read().length) users.write([]);
    if (!orders.read().length) orders.write([]);
    console.log('[DB] Data initialized');
  }
};
