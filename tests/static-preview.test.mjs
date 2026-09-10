import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_BRAND } from '../server/brand.mjs';

function client(staticMode, fetchImpl) {
  const context = vm.createContext({
    window: { HIPAW_STATIC: staticMode ? { brand: structuredClone(DEFAULT_BRAND) } : undefined, addEventListener() {} },
    document: { addEventListener() {} }, structuredClone, fetch: fetchImpl,
  });
  vm.runInContext(readFileSync(new URL('../outputs/hipaw.js', import.meta.url), 'utf8'), context);
  return vm.runInContext('hapi', context);
}

test('Pages loads default records without backend requests and blocks writes including credentials', async () => {
  let requests = 0;
  const api = client(true, () => { requests++; throw new Error('Unexpected network request'); });
  const first = await api('/brand');
  assert.equal(first.falConfigured, false);
  first.brand.name = 'unsaved edit';
  assert.equal((await api('/brand')).brand.name, 'HiPaw');
  assert.equal((await api('/assets')).assets.length, 0);
  assert.equal((await api('/jobs')).jobs.length, 0);
  for (const path of ['/credentials', '/generate', '/brand', '/uploads', '/assets']) {
    await assert.rejects(api(path, { method: 'POST', body: 'do-not-send' }), /尚未连接后台/);
  }
  assert.equal(requests, 0);
});

test('Local workbench retains authenticated-backend request path and payload', async () => {
  const sent = [];
  const api = client(false, async (path, options) => {
    sent.push({ path, options });
    return { ok: true, json: async () => ({ saved: true }) };
  });
  const options = { method: 'PUT', body: '{"name":"test"}' };
  assert.equal((await api('/brand', options)).saved, true);
  assert.equal(sent[0].path, '/api/brand');
  assert.equal(sent[0].options, options);
});
