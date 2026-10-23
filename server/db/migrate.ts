import { openDatabase } from './index.js';
const connection = openDatabase();
connection.close();
console.log('数据库迁移完成');
