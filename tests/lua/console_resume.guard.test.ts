import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('restoreFromStateSnapshot does not clear colliders or physics', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private restoreFromStateSnapshot');
  assert.ok(start > -1, 'restoreFromStateSnapshot not found');
  const end = src.indexOf('private shouldRunInitForSnapshot', start);
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
  // It should use the soft reload helper to keep state
  assert.equal(snippet.includes('reloadLuaProgramState'), true, 'reloadLuaProgramState not used in prefetch path');
});

test('initializeLuaInterpreterFromSnapshot reloads lua integrations', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private initializeLuaInterpreterFromSnapshot');
  assert.ok(start > -1, 'initializeLuaInterpreterFromSnapshot not found');
  const nextPrivate = src.indexOf('\n\tprivate ', start + 1);
  const snippet = src.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
  assert.equal(snippet.includes('loadLuaStateMachineScripts'), true, 'FSM scripts not reloaded during in-place program apply');
  assert.equal(snippet.includes('loadLuaBehaviorTreeScripts'), true, 'Behaviour tree scripts not reloaded during in-place program apply');
  assert.equal(snippet.includes('loadLuaServiceScripts'), true, 'Service scripts not reloaded during in-place program apply');
});

test('reloadLuaProgramState applies hot reload without reinitialising interpreter', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private reloadLuaProgramState');
  assert.ok(start > -1, 'reloadLuaProgramState not found');
  const nextPrivate = src.indexOf('\n\tprivate ', start + 1);
  const snippet = src.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
  assert.equal(snippet.includes('reinitializeLuaProgramFromSnapshot'), false, 'reloadLuaProgramState should not reset interpreter');
  assert.equal(snippet.includes('applyLuaProgramHotReload'), true, 'reloadLuaProgramState should apply hot reload');
});

test('applyLuaProgramHotReload keeps interpreter resident', () => {
  const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
  const start = src.indexOf('private applyLuaProgramHotReload');
  assert.ok(start > -1, 'applyLuaProgramHotReload not found');
  const nextPrivate = src.indexOf('\n\tprivate ', start + 1);
  const snippet = src.slice(start, nextPrivate === -1 ? undefined : nextPrivate);
  assert.equal(snippet.includes('resetLuaInterpreterForHotReload'), false, 'applyLuaProgramHotReload should not reset interpreter');
  assert.equal(snippet.includes('execute('), true, 'applyLuaProgramHotReload must execute the updated chunk');
  assert.equal(snippet.includes('mergeLuaChunkEnvironmentState'), true, 'applyLuaProgramHotReload should merge previous state');
});

test('registerAbilityDefinition uses Lua handler metadata', () => {
	const src = readFileSync('src/bmsx/console/runtime.ts', 'utf8');
	const start = src.indexOf('public registerAbilityDefinition');
	assert.ok(start > -1, 'registerAbilityDefinition not found');
	const nextPublic = src.indexOf('\n\tpublic ', start + 1);
	const snippet = src.slice(start, nextPublic === -1 ? undefined : nextPublic);
	assert.equal(snippet.includes('isLuaHandlerFn(activationFn)'), true, 'activation handlers should be validated as LuaHandlerFn');
	assert.equal(snippet.includes("this.registerGameplayAction(abilityId, 'activation', activationFn)"), true, 'ability actions should use Lua handler functions directly');
	assert.equal(snippet.includes('registerLuaAbilityHandler'), false, 'legacy ability handler registration should be removed');
});
