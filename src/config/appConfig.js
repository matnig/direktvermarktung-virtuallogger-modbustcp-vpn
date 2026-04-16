const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'src', 'persistence', 'data');

module.exports = {
  PORT,
  HOST,
  DATA_DIR,
};
