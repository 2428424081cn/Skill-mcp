import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || "data/telemetry.db";
console.log(`=== SQLite 数据库结构探查: ${dbPath} ===`);

try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  console.log(`发现 ${tables.length} 张数据表:\n`);
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info('${t.name}')`).all();
    const countRow = db.prepare(`SELECT count(*) as c FROM '${t.name}'`).get();
    console.log(`📋 表名: ${t.name} (总行数: ${countRow.c})`);
    console.log("   列定义: " + cols.map(c => `${c.name} (${c.type || 'ANY'}${c.pk ? ', PK' : ''})`).join(", "));
  }
} catch (e) {
  console.error("探查失败:", e.message);
}
