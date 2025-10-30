import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('restoreFromStateSnapshot does not clear colliders or physics', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private restoreFromStateSnapshot');
  assert.ok(start > -1, 'restoreFromStateSnapshot not found');
  const end = src.indexOf('private reinitializeLuaProgramForState', start);
  const snippet = src.slice(start, end === -1 ? undefined : end);
  // Should not clear colliders/physics during resume restore
  assert.equal(snippet.includes('collider_clear('), false, 'collider_clear present in restoreFromStateSnapshot');
  assert.equal(snippet.includes('physics.clear('), false, 'physics.clear present in restoreFromStateSnapshot');
});

test('prefetchLuaSourceFromFilesystem soft-applies without boot()', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private async prefetchLuaSourceFromFilesystem');
  assert.ok(start > -1, 'prefetchLuaSourceFromFilesystem not found');
  // Slice until the next private method to approximate the function body
  const nextPrivate = src.indexOf('\n\t\tprivate ', start + 1);
  const snippet = src.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
  // The prefetch path should not call boot() directly
  assert.equal(snippet.includes('.boot('), false, 'boot() found in prefetch path');
  // It should use restoreFromStateSnapshot to keep state
  assert.equal(snippet.includes('restoreFromStateSnapshot'), true, 'restoreFromStateSnapshot not used in prefetch path');
});
