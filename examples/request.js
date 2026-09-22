import { ChromiumClient } from '../src/index.js';

const url = process.argv[2];
if (!url) throw new Error('Usage: node examples/request.js https://your-controlled-server/path');
const client = new ChromiumClient();
try {
  const response = await client.request(url);
  console.log(response.status, `HTTP/${response.httpVersion}`, response.headers);
  console.log(response.text());
} finally { await client.close(); }
