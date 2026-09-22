import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Bun replaces bare "ws" imports with its own WebSocket shim. Load the installed
// package by file path so createConnection/finishRequest really use CurlStream.
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('ws/package.json'));
const codec = require(join(packageRoot, 'index.js'));
export default codec;
export const WebSocketServer = codec.WebSocketServer;
