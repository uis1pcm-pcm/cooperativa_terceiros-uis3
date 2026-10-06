#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const patchesDir = path.join(projectRoot, 'patches');

if (!fs.existsSync(patchesDir)) {
  console.log('[patch-package shim] No `patches` directory found. Skipping.');
  process.exit(0);
}

const patchFiles = fs
  .readdirSync(patchesDir)
  .filter((file) => file.endsWith('.patch'))
  .sort();

if (patchFiles.length === 0) {
  console.log('[patch-package shim] No patch files found. Skipping.');
  process.exit(0);
}

let cliPath;
try {
  cliPath = require.resolve('patch-package/dist/index.js', { paths: [projectRoot] });
} catch (error) {
  cliPath = null;
}

if (cliPath) {
  const result = spawnSync(process.execPath, [cliPath], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status === null) {
    console.error('[patch-package shim] Failed to execute patch-package CLI.');
    process.exit(1);
  }

  process.exit(result.status);
}

console.warn('[patch-package shim] `patch-package` dependency not found; attempting to apply patches with the `patch` binary.');

let hasErrors = false;

for (const patchFile of patchFiles) {
  const patchPath = path.join(patchesDir, patchFile);
  console.log(`[patch-package shim] Applying ${patchFile}`);

  const result = spawnSync('patch', ['-p1', '-N', '-i', patchPath], {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    hasErrors = true;
    console.error(`[patch-package shim] Failed to apply ${patchFile}`);
  }
}

process.exit(hasErrors ? 1 : 0);
