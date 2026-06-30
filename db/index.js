require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

function getConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bulk_email_sender',
    waitForConnections: true,
    connectionLimit: 10
  };
}

async function initPool() {
  if (pool) return pool;
  pool = mysql.createPool(getConfig());
  await pool.query('SELECT 1');
  return pool;
}

async function query(sql, params = []) {
  const p = await initPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

async function ping() {
  try {
    await initPool();
    return true;
  } catch {
    return false;
  }
}

async function initSchema() {
  const config = getConfig();
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: true
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  await conn.query(`USE \`${config.database}\``);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  await conn.end();
  console.log(`Database ${config.database} initialized`);
}

module.exports = { initPool, query, ping, initSchema, getConfig };
