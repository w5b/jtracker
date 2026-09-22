import { ChromiumClient } from '../src/index.js';

const [url, origin] = process.argv.slice(2);
if (!url || !origin) throw new Error('Usage: node examples/websocket.js wss://your-server/echo https://initiating-page');
const client = new ChromiumClient({ origin });
try {
  const socket = await client.openWebSocket(url);
  await socket.send('hello');
  console.log(await socket.receive());
  await socket.close();
} finally { await client.close(); }
