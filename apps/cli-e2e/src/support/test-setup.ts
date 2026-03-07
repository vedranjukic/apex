/* eslint-disable */
const path = require('path');
const { config } = require('dotenv');

// Load .env from workspace root for DAYTONA_API_KEY, ANTHROPIC_API_KEY, etc.
config({ path: path.join(process.cwd(), '.env') });
