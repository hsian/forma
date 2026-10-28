import Database from 'better-sqlite3';
const [source, target] = process.argv.slice(2);
if (!source || !target) throw Error('缺少数据库备份路径');
const database = new Database(source, { readonly: true, fileMustExist: true });
try { await database.backup(target); }
finally { database.close(); }
