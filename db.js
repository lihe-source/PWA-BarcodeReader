// db.js — IndexedDB wrapper via Dexie
const db = new Dexie('BarcodeProDB');
db.version(1).stores({
  scanHistory: '++id, content, format, category, source, timestamp'
});

const DB = {
  async add(record) {
    return db.scanHistory.add({
      content: record.content,
      format: record.format,
      category: record.category,
      source: record.source,
      timestamp: record.timestamp || Date.now()
    });
  },

  async getAll() {
    return db.scanHistory.orderBy('timestamp').reverse().toArray();
  },

  async delete(id) {
    return db.scanHistory.delete(id);
  },

  async clearAll() {
    return db.scanHistory.clear();
  },

  async search(query) {
    const all = await this.getAll();
    const q = query.toLowerCase();
    return all.filter(r => r.content.toLowerCase().includes(q));
  }
};
