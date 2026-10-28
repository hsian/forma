import { openDatabase } from './index.js';
import { loadEnvironment, resolveDatabasePath } from './config.js';
loadEnvironment();
const connection = openDatabase();
connection.close();
console.log(`数据库迁移完成：${resolveDatabasePath()}`);
