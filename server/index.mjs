import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEFAULT_BRAND, validateBrand, buildGeneration, AppError } from './brand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const MAX_FILE = 20 * 1024 * 1024;
export function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new AppError('请使用 PNG、JPG 或 WEBP 图片');
}
function safeFalUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.hostname !== 'queue.fal.run' || u.username || u.password) throw new AppError('生图服务返回了无效的任务地址', 502);
  return u.href;
}
export function createWorkbench({ dataDir = resolve(ROOT, 'data'), fetchImpl = fetch, initialKey = process.env.FAL_KEY || '' } = {}) {
  mkdirSync(resolve(dataDir, 'media'), { recursive: true });
  const load = (name, fallback) => {
    const path = resolve(dataDir, name + '.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(fallback);
  };
  const save = (name, value, secret = false) => {
    const path = resolve(dataDir, name + '.json');
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: secret ? 0o600 : 0o644 });
    renameSync(tmp, path);
  };
  let brand = load('brand', DEFAULT_BRAND);
  let key = initialKey || load('credentials', {}).falKey || '';
  let assets = load('assets', []);
  let jobs = load('jobs', []);
  const polls = new Map();
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const body = async (req, max = 32 * 1024 * 1024) => {
    const chunks = []; let size = 0;
    for await (const part of req) { size += part.length; if (size > max) throw new AppError('文件太大，请使用 20MB 以内的图片', 413); chunks.push(part); }
    return Buffer.concat(chunks);
  };
  const readJson = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('请求格式应为 JSON', 415);
    try { return JSON.parse((await body(req)).toString()); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('请求内容无法读取'); }
  };
  const saveImage = bytes => {
    const type = imageType(bytes);
    if (bytes.length > MAX_FILE) throw new AppError('单张图片不能超过 20MB', 413);
    const name = randomUUID() + '.' + type;
    writeFileSync(resolve(dataDir, 'media', name), bytes);
    return '/media/' + name;
  };
  const imageData = value => {
    if (typeof value !== 'string') throw new AppError('参考图无法读取');
    if (/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(value)) {
      const bytes = readFileSync(resolve(dataDir, 'media', basename(value)));
      return `data:${MIME[extname(value)]};base64,${bytes.toString('base64')}`;
    }
    const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if (!match) throw new AppError('参考图需要上传到工作台后再使用');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_FILE) throw new AppError('参考图不能超过 20MB', 413);
    imageType(bytes);
    return value;
  };
  const fal = async (url, options = {}) => {
    if (!key) throw new AppError('生图服务尚未连接，请先在品牌中心配置 fal 密钥', 503);
    const response = await fetchImpl(safeFalUrl(url), { ...options, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? 'fal 密钥无效或账户没有访问权限' : response.status === 402 ? 'fal 账户余额不足' : response.status === 422 ? '生图参数或 LoRA 不受服务支持，请检查模型配置' : `fal 生图服务暂时不可用（${response.status}）`;
      throw new AppError(reason, 502);
    }
    return response.json();
  };
  const publicJob = job => {
    const { statusUrl, resultUrl, cancelUrl, ...visible } = job;
    return visible;
  };
  async function poll(job) {
    if (job.status === 'success' || job.status === 'failed' || job.status === 'cancelled') return job;
    const state = await fal(job.statusUrl);
    if (state.status !== 'COMPLETED') { job.status = state.status === 'IN_QUEUE' ? 'queued' : 'running'; save('jobs', jobs); return job; }
    const result = await fal(job.resultUrl);
    if (!result.images?.length || result.error) {
      job.status = 'failed'; job.error = '生图服务没有返回图片，请检查 LoRA 与提示词'; save('jobs', jobs); return job;
    }
    try {
      const output = [];
      for (const item of result.images) {
        let bytes;
        if (item.url.startsWith('data:')) bytes = Buffer.from(imageData(item.url).split(',')[1], 'base64');
        else {
          const u = new URL(item.url);
          if (u.protocol !== 'https:' || !['fal.media', 'storage.googleapis.com'].some(h => u.hostname === h || u.hostname.endsWith('.' + h))) throw new AppError('生成图片的下载地址无法验证', 502);
          const response = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new AppError('图片已经生成，但下载失败，请重新读取结果', 502);
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX_FILE) { await reader.cancel(); throw new AppError('生成图片超出本地保存限制', 502); } chunks.push(Buffer.from(part.value)); }
          bytes = Buffer.concat(chunks);
        }
        output.push({ id: randomUUID(), url: saveImage(bytes), width: item.width, height: item.height });
      }
      job.images = output; job.status = 'success'; job.seed = result.seed;
      job.finishedAt = new Date().toISOString(); save('jobs', jobs); return job;
    } catch (e) { job.error = e.message; save('jobs', jobs); throw e; }
  }
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new AppError('此工作台仅供本机访问', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new AppError('请求来源不受支持', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError('请求来源不受支持', 403);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      const url = new URL(req.url, `http://${host}`);
      const path = decodeURIComponent(url.pathname);
      if (path === '/api/health') return json(res, 200, { ok: true, service: 'HiPaw', falConfigured: Boolean(key), localOnly: true });
      if (path === '/api/brand' && req.method === 'GET') return json(res, 200, { brand, falConfigured: Boolean(key) });
      if (path === '/api/brand' && req.method === 'PUT') {
        const next = validateBrand(await readJson(req), brand); save('brand', next); brand = next; return json(res, 200, { brand });
      }
      if (path === '/api/credentials' && req.method === 'PUT') {
        const value = await readJson(req); const next = String(value.falKey || '').trim();
        if (!next || /[\r\n]/.test(next)) throw new AppError('请输入有效的 fal 密钥');
        save('credentials', { falKey: next }, true); key = next; return json(res, 200, { configured: true });
      }
      if (path === '/api/uploads' && req.method === 'POST') {
        const location = saveImage(await body(req, MAX_FILE)); return json(res, 201, { url: location });
      }
      if (path === '/api/assets' && req.method === 'GET') return json(res, 200, { assets });
      if (path === '/api/assets' && req.method === 'POST') {
        const input = await readJson(req);
        const data = imageData(input.url);
        const imageUrl = input.url.startsWith('/media/') ? input.url : saveImage(Buffer.from(data.split(',')[1], 'base64'));
        const asset = { id: randomUUID(), title: String(input.title || '画布作品').slice(0, 120), url: imageUrl, createdAt: new Date().toISOString(), status: 'pending_review', kind: 'image', source: input.source === 'upload' ? 'upload' : 'canvas', jobId: String(input.jobId || '').slice(0, 100) };
        assets.unshift(asset); save('assets', assets); return json(res, 201, { asset });
      }
      if (path.startsWith('/api/assets/') && req.method === 'PATCH') {
        const asset = assets.find(x => x.id === path.split('/').pop()); if (!asset) throw new AppError('素材不存在', 404);
        const input = await readJson(req);
        if (!['approved', 'pending_review'].includes(input.status)) throw new AppError('审核状态无效');
        asset.status = input.status; save('assets', assets); return json(res, 200, { asset });
      }
      if (path === '/api/generate' && req.method === 'POST') {
        const input = await readJson(req);
        const brandSnapshot = structuredClone(brand);
        const payload = buildGeneration(input, brandSnapshot);
        const references = input.references || [];
        if (!Array.isArray(references) || references.length > 4) throw new AppError('一次最多使用 4 张参考图');
        if (references.length) payload.image_urls = references.map(imageData);
        const endpoint = 'fal-ai/flux-2/lora' + (references.length ? '/edit' : '');
        const queued = await fal(`https://queue.fal.run/${endpoint}`, { method: 'POST', body: JSON.stringify(payload) });
        const job = { id: randomUUID(), requestId: queued.request_id, status: 'queued', statusUrl: safeFalUrl(queued.status_url), resultUrl: safeFalUrl(queued.response_url), cancelUrl: safeFalUrl(queued.cancel_url), prompt: String(input.prompt).slice(0, 10000), effectivePrompt: payload.prompt, brandVersion: brandSnapshot.version, brandSnapshot, useMascot: input.useMascot === true, ratio: input.ratio || '3:4', count: payload.num_images, referenceCount: references.length, taskId: String(input.taskId || '').slice(0, 100), createdAt: new Date().toISOString(), images: [] };
        jobs.unshift(job); save('jobs', jobs); return json(res, 202, publicJob(job));
      }
      if (path === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs: jobs.map(publicJob) });
      if (path.startsWith('/api/jobs/')) {
        const job = jobs.find(x => x.id === path.split('/').pop()); if (!job) throw new AppError('生成任务不存在', 404);
        if (req.method === 'DELETE') { if (['queued', 'running'].includes(job.status)) { await fal(job.cancelUrl, { method: 'PUT' }); job.status = 'cancelled'; save('jobs', jobs); } return json(res, 200, publicJob(job)); }
        if (req.method === 'GET') {
          if (!polls.has(job.id)) polls.set(job.id, poll(job).finally(() => polls.delete(job.id)));
          return json(res, 200, publicJob(await polls.get(job.id)));
        }
      }
      if (path.startsWith('/api/')) throw new AppError('未找到这个接口', 404);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('不支持此操作', 405);
      let file;
      if (/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(path)) file = resolve(dataDir, 'media', basename(path));
      else if (path.startsWith('/canvas-app/')) {
        const base = resolve(ROOT, 'vendor/infinite-canvas/web/dist');
        file = resolve(base, '.' + path.slice('/canvas-app'.length));
        if (!file.startsWith(base + '/')) throw new AppError('文件不存在', 404);
        if (!existsSync(file) && !extname(path)) file = resolve(base, 'index.html');
      } else if (['/', '/hipaw-aigc-workbench.html'].includes(path)) file = resolve(ROOT, 'outputs/hipaw-aigc-workbench.html');
      else if (/^\/hipaw\.(js|css)$/.test(path)) file = resolve(ROOT, 'outputs', basename(path));
      else throw new AppError('文件不存在', 404);
      if (!existsSync(file) || !statSync(file).isFile()) throw new AppError('文件不存在', 404);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'SAMEORIGIN' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      json(res, error.status || 500, { error: error instanceof AppError ? error.message : '操作未完成，请保留当前内容后重试' });
    }
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (existsSync(resolve(ROOT, '.env.local'))) process.loadEnvFile(resolve(ROOT, '.env.local'));
  const port = Number(process.env.PORT || 18766);
  createWorkbench().listen(port, '127.0.0.1', () => console.log(`HiPaw: http://127.0.0.1:${port}/hipaw-aigc-workbench.html`));
}
