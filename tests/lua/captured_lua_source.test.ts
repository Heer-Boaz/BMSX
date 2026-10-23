import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resourceIdentityKey, type ResourceDomain } from '../../ide/common/resource';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { capturedLuaSourceAtPc } from '../../ide/runtime/lua_inspection';
import { advanceLuaSourceRevision, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createBlua32SourceImage, registerRuntimeLuaResource } from '../../ide/runtime/sources';
import { CapturedLuaSourceBinding } from '../../ide/workbench/services/working_copy/captured_lua_source';
import { setWorkspaceLuaSourceOverride, releaseWorkspaceSourceOverrides } from '../../ide/workspace/cache';
import type { Blua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const TEXT = 'local value = 7\nreturn value\n';
const RANGE = { path: 'modules/logic.lua', start: { line: 2, column: 1 }, end: { line: 2, column: 13 } };
const linked = linkRawTestSystemBlua32({ text: new Uint8Array(8), functions: [{ firstWord: 0, wordCount: 2 }], debugRanges: [RANGE, null] });

function fixture(t: TestContext, domain: ResourceDomain = 0) {
	const record = createScenarioTestSourceRecord('src/logic.lua', 1, TEXT), sources = createScenarioTestSourceState(domain === 0 ? [record] : []);
	if (domain === -1) registerLuaSourceRecord(sources.systemLuaSources, record);
	const registry = domain === -1 ? sources.systemLuaSources : sources.cartridgeSlots[0]!.luaSources;
	const resource = registerRuntimeLuaResource(sources, domain, record);
	const models = new EditorTextModelService();
	const compiled: Blua32CompiledSource = { displayPath: resource.path, content: { kind: 'utf8', bytes: new TextEncoder().encode(TEXT) } };
	const captured = createBlua32SourceImage(linked.image, linked.symbols, new Map([[toLuaModulePath(RANGE.path), compiled]]), domain);
	const pc = linked.image.header.textAddress, binding = new CapturedLuaSourceBinding(models, sources);
	t.after(() => { binding.clear(); models.clear(); releaseWorkspaceSourceOverrides(registry); });
	return { record, sources, registry, resource, models, compiled, captured, pc, binding };
}

test('captured PC uses the captured source domain and written display path, not the physical execution domain or module alias', t => {
	for (const domain of [-1, 0] as const) {
		const f = fixture(t, domain), location = capturedLuaSourceAtPc(f.captured, f.pc)!;
		assert.deepEqual(location.resource, { domain, path: 'src/logic.lua' });
		assert.deepEqual(location.range, { ...RANGE, path: 'src/logic.lua' });
		assert.equal(location.installedSource, TEXT); assert.equal(f.compiled.content.kind, 'text');
		f.binding.bind(f.captured, f.pc); assert.equal(f.binding.status, 'available');
	}
});

test('current dirty working copies and ordinary Undo determine captured-source admission without Save or installing overrides', t => {
	const f = fixture(t), model = f.models.retain(f.resource, 'lua', TEXT);
	f.binding.bind(f.captured, f.pc); assert.equal(f.binding.status, 'available');
	const location = f.binding.location, revision = f.binding.revision;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	f.binding.update(); assert.equal(f.binding.status, 'changed'); assert.ok(f.binding.revision > revision);
	assert.equal(f.binding.location, location); assert.equal(location!.installedSource, TEXT); assert.equal(f.record.src, TEXT);
	assert.notEqual(model.undo(), null); f.binding.update(); assert.equal(f.binding.status, 'available');
	assert.equal(f.binding.location, location); assert.equal(model.dirty, false);
});

test('without an open model the registry publication owns source comparison, while newer installed media never replaces captured bytes', t => {
	const f = fixture(t); f.binding.bind(f.captured, f.pc);
	const location = f.binding.location;
	setWorkspaceLuaSourceOverride(f.registry, f.record.source_path, '-- published workspace\n' + TEXT);
	f.binding.update(); assert.equal(f.binding.status, 'changed'); assert.equal(f.binding.location, location);
	setWorkspaceLuaSourceOverride(f.registry, f.record.source_path, TEXT);
	f.binding.update(); assert.equal(f.binding.status, 'available');
	const newer = createBlua32SourceImage(linked.image, linked.symbols, new Map([[toLuaModulePath(RANGE.path),
		{ displayPath: f.resource.path, content: { kind: 'text', text: '-- different installation\n' + TEXT } } as Blua32CompiledSource]]), 0);
	f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media, cartridgeSlots: [newer, null] };
	f.binding.update(); assert.equal(f.binding.status, 'available'); assert.equal(f.binding.location, location);
	assert.equal(location!.installedSource, TEXT, 'this target is the observed installation, not the latest installed program');
});

test('registry/catalog replacement and model retirement invalidate source generations even when source bytes remain equal', t => {
	const f = fixture(t); f.binding.bind(f.captured, f.pc);
	let revision = f.binding.revision;
	f.sources.resourceByIdentity = new Map(f.sources.resourceByIdentity);
	f.binding.update(); assert.ok(f.binding.revision > revision); assert.equal(f.binding.status, 'available');
	revision = f.binding.revision;
	const replacement = { ...f.registry, records: [...f.registry.records], path2lua: { ...f.registry.path2lua }, module2lua: { ...f.registry.module2lua } };
	f.sources.cartridgeSlots[0]!.luaSources = replacement;
	f.binding.update(); assert.ok(f.binding.revision > revision); assert.equal(f.binding.status, 'available');
	const model = f.models.retain(f.resource, 'lua', '-- unsaved model\n' + TEXT);
	f.binding.update(); assert.equal(f.binding.status, 'changed');
	f.models.clear(); f.binding.update(); assert.equal(f.binding.status, 'available');
	assert.equal(model.buffer.getText(), '-- unsaved model\n' + TEXT);
	f.sources.resourceByIdentity.delete(resourceIdentityKey(f.resource)); f.binding.update(); assert.equal(f.binding.status, 'unavailable');
	registerRuntimeLuaResource(f.sources, 0, f.record); f.binding.update(); assert.equal(f.binding.status, 'available');
});

test('absent captured provenance never adopts current source, and clear releases the previous document binding', t => {
	const f = fixture(t); f.models.retain(f.resource, 'lua', TEXT); f.binding.bind(f.captured, f.pc);
	const clear = () => { f.binding.clear(); assert.equal(f.binding.status, 'unavailable'); assert.equal(f.binding.location, undefined); };
	clear(); const revision = f.binding.revision;
	for (let frame = 0; frame < 100; frame++) f.binding.update();
	assert.equal(f.binding.revision, revision);
	f.binding.bind(f.captured, f.pc); assert.equal(f.binding.status, 'available');
	f.binding.bind(createBlua32SourceImage(linked.image, null, f.captured.sources, 0), f.pc);
	assert.equal(f.binding.location, undefined); assert.equal(f.binding.status, 'unavailable');
	f.binding.bind(f.captured, f.pc + 4); assert.equal(f.binding.location, undefined);
	f.binding.bind(createBlua32SourceImage(linked.image, linked.symbols, new Map(), 0), f.pc); assert.equal(f.binding.location, undefined);
	f.binding.bind(f.captured, undefined); assert.equal(f.binding.location, undefined);
	f.binding.bind(null, f.pc); assert.equal(f.binding.location, undefined);
	clear();
});

test('unchanged source admission performs no further captured-source decoding or current-buffer reads', t => {
	const f = fixture(t), model = f.models.retain(f.resource, 'lua', TEXT);
	f.binding.bind(f.captured, f.pc);
	const location = f.binding.location, revision = f.binding.revision;
	const content = f.compiled.content;
	Object.defineProperty(f.compiled, 'content', { configurable: true, get: () => assert.fail('unchanged binding re-read captured source') });
	t.after(() => Object.defineProperty(f.compiled, 'content', { configurable: true, writable: true, value: content }));
	t.mock.method(model.buffer, 'getText', () => assert.fail('unchanged binding re-read current source'));
	for (let frame = 0; frame < 1000; frame++) { f.binding.bind(f.captured, f.pc); f.binding.update(); }
	assert.equal(f.binding.location, location); assert.equal(f.binding.revision, revision); assert.equal(f.binding.status, 'available');
	advanceLuaSourceRevision(f.registry, 'unrelated.lua'); f.binding.update();
	assert.equal(f.binding.status, 'available', 'registry publication still consumes the retained working copy snapshot');
});
