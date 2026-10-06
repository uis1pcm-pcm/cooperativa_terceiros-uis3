const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const shimSource = path.join(projectRoot, 'scripts', 'shims', 'patch-package.cjs');
const binDir = path.join(projectRoot, 'node_modules', '.bin');

try {
  fs.accessSync(shimSource, fs.constants.R_OK);
} catch (error) {
  console.warn('[setup-patch-package-bin] Shim source not readable, skipping setup.');
  return;
}

try {
  fs.mkdirSync(binDir, { recursive: true });
} catch (error) {
  console.warn('[setup-patch-package-bin] Unable to create .bin directory:', error);
  return;
}

const posixShimPath = path.join(binDir, 'patch-package');
const shimTargetRelative = path.relative(binDir, shimSource).replace(/\\/g, '/');
const posixShimContent = `#!/usr/bin/env node\nrequire('${shimTargetRelative}');\n`;

try {
  fs.writeFileSync(posixShimPath, posixShimContent, { mode: 0o755 });
  fs.chmodSync(posixShimPath, 0o755);
  console.log('[setup-patch-package-bin] Installed POSIX shim at', posixShimPath);
} catch (error) {
  console.warn('[setup-patch-package-bin] Failed to write POSIX shim:', error);
}

const cmdShimPath = path.join(binDir, 'patch-package.cmd');
const cmdTargetRelative = path.relative(binDir, shimSource).replace(/\\/g, '\\\\');
const cmdShimContent = `@echo off\r\nnode "%~dp0${cmdTargetRelative}" %*\r\n`;

try {
  fs.writeFileSync(cmdShimPath, cmdShimContent);
  console.log('[setup-patch-package-bin] Installed Windows shim at', cmdShimPath);
} catch (error) {
  console.warn('[setup-patch-package-bin] Failed to write Windows shim:', error);
}
