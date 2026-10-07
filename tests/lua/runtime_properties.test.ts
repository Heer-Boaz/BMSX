import assert from 'node:assert/strict';
import test from 'node:test';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import {
	BehaviorRuntimeProperties, RuntimePropertyIndex, runtimeInspectionPropertiesEqual, runtimePropertyIdentitiesEqual,
	type RuntimePropertyIdentity,
} from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { parseLuaChunk } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';

const numeric: RuntimePropertyIdentity = { section: 'member', field: '', key: { tag: ValueTag.Number, scalar: 1 } };
const string: RuntimePropertyIdentity = { section: 'member', field: '', key: { tag: ValueTag.String, scalar: 1 } };
const field: RuntimePropertyIdentity = { section: 'instance', field: 'id' };

test('runtime property identities distinguish semantic fields and typed keys independently of labels', () => {
	assert.equal(runtimePropertyIdentitiesEqual(numeric, string), false);
	assert.equal(runtimePropertyIdentitiesEqual(numeric, structuredClone(numeric)), true);
	assert.equal(runtimePropertyIdentitiesEqual(field, { section: 'definition', field: 'id' }), false);
	const row = { label: '1', value: '', description: '', warning: false };
	assert.equal(runtimeInspectionPropertiesEqual({ ...row, identity: numeric }, { ...row, identity: string }), false);
	assert.equal(runtimeInspectionPropertiesEqual({ ...row, identity: numeric }, { ...row, label: 'CHANGED', identity: numeric }), true);
	assert.equal(runtimeInspectionPropertiesEqual(row, { ...row, identity: numeric }), false);
	assert.equal(runtimeInspectionPropertiesEqual(row, { ...row }), true);
});

test('runtime property indexes keep semantic sections and same-scalar key tags separate through deletion', () => {
	const index = new RuntimePropertyIndex<string>();
	index.set(numeric, 'numeric'); index.set(string, 'string'); index.set(field, 'field');
	assert.equal(index.get(structuredClone(numeric)), 'numeric');
	assert.equal(index.get(string), 'string'); assert.equal(index.get(field), 'field');
	assert.equal(index.delete(numeric), true); assert.equal(index.delete(numeric), false);
	assert.equal(index.get(numeric), undefined); assert.equal(index.get(string), 'string');
	assert.equal(index.delete(field), true); assert.equal(index.get(string), 'string');
	assert.equal(index.delete(string), true);
	index.set(numeric, 'new numeric'); assert.equal(index.get(numeric), 'new numeric');
});

test('filtered projections do not capture keys or format rejected values and retain warmed dynamic labels', t => {
	const source = "numeric = 1; string = '1'; object = { nested = 2 }; callback = function() end";
	const chunk = parseLuaChunk(source, 'properties.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, [], []), { entrySource: source, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	cpu.reset(); cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime), key = guest.global('string'), value = guest.global('object'), callback = guest.global('callback');
	const identity = { section: 'member', field: '', key: guest.identity(key) };
	const index = new RuntimePropertyIndex<boolean>(); index.set(identity, true);
	assert.equal(index.find('member', '', key, guest), true);
	assert.equal(index.find('member', '', guest.global('numeric'), guest), undefined);
	const properties = new BehaviorRuntimeProperties(sources, guest, (section, field, key) => index.find(section, field, key, guest) === true);
	const refresh = () => {
		properties.begin(); properties.text('STATUS', 'IGNORED');
		properties.field('instance', 'id', 'IGNORED', callback);
		properties.entry('member', 1, callback);
		properties.entry('member', key, value);
		return properties.finish();
	};
	const document = refresh(), row = document[0];
	assert.equal(document.length, 1); assert.equal(row.label, '1');
	let identities = 0, labels = 0, values = 0;
	const identify = guest.identity.bind(guest), label = guest.formatValue.bind(guest), format = guest.formatStoredEntries.bind(guest);
	t.mock.method(guest, 'identity', (...args: Parameters<typeof identify>) => { identities++; return identify(...args); });
	t.mock.method(guest, 'formatValue', (...args: Parameters<typeof label>) => { labels++; return label(...args); });
	t.mock.method(guest, 'formatStoredEntries', (...args: Parameters<typeof format>) => { values++; return format(...args); });
	for (let frame = 0; frame < 1000; frame++) {
		assert.strictEqual(refresh(), document); assert.strictEqual(document[0], row); assert.equal(properties.changed, false);
	}
	assert.deepEqual([identities, labels, values], [0, 0, 0]);
	properties.invalidate(); refresh();
	assert.equal(values, 1); assert.ok(labels > 0);
});
