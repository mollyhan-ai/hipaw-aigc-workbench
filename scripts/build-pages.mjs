import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DEFAULT_BRAND } from '../server/brand.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PAGES_BASE || '/hipaw-aigc-workbench/';
if (!/^\/[a-zA-Z0-9_-]+\/$/.test(base)) throw new Error('Invalid Pages base path');
const output = resolve(root, '_site');
const canvasOutput = resolve(root, 'work/pages-canvas');
const source = readFileSync(resolve(root, 'outputs/hipaw-aigc-workbench.html'), 'utf8');
const tasksSection = source.match(/const TASKS = \[([\s\S]*?)\n\];/)?.[1];
const taskIds = [...(tasksSection || '').matchAll(/id:'([a-z0-9-]+)'/g)].map(match => match[1]);
if (!taskIds.length) throw new Error('No canvas tasks found');

execFileSync('npm', ['run', 'build', '--', '--outDir', canvasOutput, '--emptyOutDir'], {
  cwd: resolve(root, 'vendor/infinite-canvas/web'), stdio: 'inherit',
  env: { ...process.env, VITE_BASE: base + 'canvas-app/', VITE_HIPAW_STATIC: 'true' },
});
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of ['hipaw.css', 'hipaw.js']) cpSync(resolve(root, 'outputs', file), resolve(output, file));
const config = JSON.stringify({ brand: DEFAULT_BRAND, canvasBase: base + 'canvas-app' }).replaceAll('<', '\\u003c');
const html = source
  .replace('href="/hipaw.css"', `href="${base}hipaw.css"`)
  .replace('<script src="/hipaw.js"></script>', `<script>window.HIPAW_STATIC=${config};</script>\n<script src="${base}hipaw.js"></script>`);
writeFileSync(resolve(output, 'index.html'), html);
writeFileSync(resolve(output, 'hipaw-aigc-workbench.html'), html);
writeFileSync(resolve(output, '.nojekyll'), '');
cpSync(canvasOutput, resolve(output, 'canvas-app'), { recursive: true });
// Pages serves directories directly; each known task gets an entry for the existing browser router.
for (const id of taskIds) {
  const target = resolve(output, 'canvas-app/embed/hipaw-' + id);
  mkdirSync(target, { recursive: true });
  cpSync(resolve(canvasOutput, 'index.html'), resolve(target, 'index.html'));
}
cpSync(resolve(root, 'vendor/infinite-canvas/LICENSE'), resolve(output, 'canvas-app/LICENSE'));
console.log(`Pages ready: ${taskIds.length} canvas routes; only frontend assets and default brand configuration included.`);
