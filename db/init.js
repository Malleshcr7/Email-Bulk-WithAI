require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initSchema } = require('./index');

initSchema().catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});
