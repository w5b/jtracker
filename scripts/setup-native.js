import { readFile, writeFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, '.native');
const manifest = JSON.parse(await readFile(new URL('./native-assets.json', import.meta.url)));
const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
const libc = process.platform === 'linux' && process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl';
const platform = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'arm64' : arch}-macos`
  : `${arch}-linux-${libc}`;
if (!arch || !['darwin', 'linux'].includes(process.platform)) {
  throw new Error('Prebuilt setup supports macOS/Linux x64/arm64. See docs/design.md for custom builds.');
}
const asset = manifest.assets.find(a => a.name.endsWith(`.${platform}.tar.gz`));
if (!asset) throw new Error(`No pinned native asset for ${platform}`);
const sha256 = b => createHash('sha256').update(b).digest('hex');
await mkdir(target, { recursive: true });
const archive = join(target, asset.name);
let bytes;
try { bytes = await readFile(archive); } catch { /* first setup */ }
if (!bytes || sha256(bytes) !== asset.sha256) {
  console.log(`Downloading ${asset.name}`);
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== asset.sha256) throw new Error('Native archive SHA-256 mismatch');
  await writeFile(`${archive}.tmp`, bytes);
  await rename(`${archive}.tmp`, archive);
}
const stage = join(target, `unpack-${process.pid}`);
await mkdir(stage, { recursive: true });
try {
  // Only a hash-verified, pinned release archive reaches tar.
  execFileSync('tar', ['-xzf', archive, '-C', stage]);
  async function findLib(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { const found = await findLib(path); if (found) return found; }
      if (entry.isFile() && /^libcurl-impersonate.*\.(dylib|so(?:\.[\d.]+)?)$/.test(entry.name)) return path;
    }
  }
  const library = await findLib(stage);
  if (!library) throw new Error('Library missing from verified archive');
  const libBytes = await readFile(library);
  const name = process.platform === 'darwin' ? 'libcurl-impersonate.dylib' : 'libcurl-impersonate.so';
  await writeFile(join(target, name), libBytes);
  await writeFile(join(target, 'ca-bundle.pem'), rootCertificates.join('\n'));
  await writeFile(join(target, 'install.json'), JSON.stringify({
    release: manifest.release, platform, asset: asset.name, archiveSha256: asset.sha256,
    library: relative(target, join(target, name)), librarySha256: sha256(libBytes),
    caSource: `${process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.version}`} bundled Mozilla roots`,
  }, null, 2) + '\n');
  console.log(`Installed verified ${manifest.release} in .native/ (no browser).`);
} finally { await rm(stage, { recursive: true, force: true }); }
