/* eslint-disable */
const path = require('path');
const { config } = require('dotenv');
const axios = require('axios');

// Load .env from workspace root for DAYTONA_API_KEY, ANTHROPIC_API_KEY, etc.
config({ path: path.join(process.cwd(), '.env') });

module.exports = async function () {
  // Configure axios for tests to use.
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ?? '6000';
  axios.defaults.baseURL = `http://${host}:${port}`;
};
