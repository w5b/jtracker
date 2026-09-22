// All connections stay on loopback. The temporary test certificate is trusted
// explicitly by this client only.
import { ChromiumClient } from '../src/index.js';
import { endpoint } from '../test/endpoint.js';

const server = await endpoint();
const client = new ChromiumClient({ caFile: server.caFile, origin: server.https });
try {
  console.log(client.backend.version);
  const response = await client.request(`${server.https}/hello`);
  console.log('HTTPS:', response.status, `HTTP/${response.httpVersion}`);
  console.log('Received request headers:', response.json().headers);
  const socket = await client.openWebSocket(`${server.wss}/echo`, { protocols: ['echo'] });
  await socket.send('Hello over BoringSSL');
  console.log('WSS:', await socket.receive());
  await socket.send(Buffer.from([0, 1, 255]));
  console.log('Binary:', await socket.receive());
  console.log('Closed:', await socket.close(1000, 'done'));
} finally { await client.close(); await server.close(); }
