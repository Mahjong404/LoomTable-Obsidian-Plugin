import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const repository = 'Mahjong404/LoomTable-Server';
const path = 'docs/api/openapi.yaml';
const sourcePath = new URL('../openapi/source.json', import.meta.url);
const snapshotPath = new URL('../openapi/loomtable-server.openapi.yaml', import.meta.url);
const requestedCommit = process.argv[2];

if (requestedCommit !== undefined && !/^[0-9a-f]{40}$/u.test(requestedCommit)) {
  throw new Error('Usage: pnpm api:sync [40-character-server-commit-sha]');
}

const currentSource = JSON.parse(await readFile(sourcePath, 'utf8'));
const commit = requestedCommit ?? currentSource.commit;
const rawUrl = `https://raw.githubusercontent.com/${repository}/${commit}/${path}`;
const response = await fetch(rawUrl, { headers: { accept: 'application/yaml' } });
if (!response.ok) {
  throw new Error(`OpenAPI download failed: ${response.status} ${response.statusText}`);
}

const contents = await response.text();
if (!contents.startsWith('openapi: 3.1.0')) {
  throw new Error('Downloaded file is not the expected LoomTable OpenAPI 3.1 document.');
}

await writeFile(snapshotPath, contents.endsWith('\n') ? contents : `${contents}\n`, 'utf8');
await writeFile(sourcePath, `${JSON.stringify({ repository, path, commit }, null, 2)}\n`, 'utf8');

console.log(`Synced ${repository}@${commit}:${path}`);
console.log('Run pnpm api:generate and commit the snapshot, source metadata, and generated types.');
