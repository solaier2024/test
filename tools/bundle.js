// Compatibility entry: the standalone preview now uses the actual Vite build.
import { spawnSync } from 'node:child_process';
for (const script of ['node_modules/vite/bin/vite.js', 'tools/standalone.js']) {
  const args = script.includes('vite') ? [script, 'build'] : [script];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
