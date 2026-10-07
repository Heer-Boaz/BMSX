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

function fixture(source = "numeric = 1; string = '1'; object = { nested = 2 }; callback = function() end") {
	const chunk = parseLuaChunk(source, 'properties.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, [], []), { entrySource: source, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	cpu.reset(); cpu.runUntilDepth(0, 100_000);
	return { sources, guest: new SuspendedGuestSession(runtime) };
}

test('filtered projections do not capture keys or format rejected values and retain warmed dynamic labels', t => {
	const { sources, guest } = fixture(), key = guest.global('string'), value = guest.global('object'), callback = guest.global('callback');
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


test('semantic rows retain their comparison baseline through insertion, removal and reorder', () => {
	const { sources, guest } = fixture(), properties = new BehaviorRuntimeProperties(sources, guest);
	properties.begin(true);
	properties.field('instance', 'health', 'HEALTH', 90);
	properties.field('owner', 'health', 'HEALTH', 120);
	const document = properties.finish(), health = document[0], owner = document[1];
	assert.ok(document.every(row => row.valueChanged === false));
	const identity = health.identity;

	properties.begin(true);
	properties.field('instance', 'extra', 'HEALTH', 1);
	properties.field('instance', 'health', 'RENAMED HEALTH', 89);
	properties.field('owner', 'health', 'HEALTH', 120);
	assert.strictEqual(properties.finish(), document);
	assert.strictEqual(document[1], health);
	assert.strictEqual(document[2], owner);
	assert.strictEqual(health.identity, identity);
	assert.equal(health.label, 'RENAMED HEALTH'); assert.equal(health.valueChanged, true);
	assert.equal(document[0].valueChanged, false); assert.equal(owner.valueChanged, false);

	properties.begin(true);
	properties.field('owner', 'health', 'HEALTH', 119);
	properties.field('instance', 'health', 'RENAMED HEALTH', 89);
	properties.finish();
	assert.deepEqual(document, [owner, health]);
	assert.equal(owner.valueChanged, true); assert.equal(health.valueChanged, false);
	assert.equal(properties.changed, true);
	assert.strictEqual(properties.finish(), document, 'nested projectors may finish the same document twice');

	properties.begin(false);
	properties.field('instance', 'health', 'HEALTH', 300);
	properties.field('owner', 'health', 'HEALTH', 400);
	properties.finish();
	assert.strictEqual(document[0], health); assert.strictEqual(document[1], owner);
	assert.ok(document.every(row => row.valueChanged === false), 'a new selected binding establishes a neutral baseline');
	properties.begin(true);
	properties.field('instance', 'health', 'HEALTH', 300);
	properties.field('owner', 'health', 'HEALTH', 400);
	properties.finish(); properties.finish();
	assert.equal(properties.changed, false);
});

test('typed entry identities retain warmed value, label and description caches through permutations', t => {
	const { sources, guest } = fixture(), key = guest.global('string'), value = guest.global('object');
	const properties = new BehaviorRuntimeProperties(sources, guest);
	const presentation = { prefix: 'ENTRY ' };
	properties.begin(true);
	properties.entry('member', 1, value, presentation, 'DEFAULT: ', value);
	properties.entry('member', key, 20, presentation);
	properties.field('member', '', 'UNKEYED', 30);
	const document = properties.finish(), numericRow = document[0], stringRow = document[1], unkeyedRow = document[2];
	assert.equal(numericRow.label, stringRow.label);
	let identities = 0, labels = 0, values = 0, previews = 0;
	const identify = guest.identity.bind(guest), label = guest.formatValue.bind(guest), format = guest.formatStoredEntries.bind(guest), preview = guest.previewValue.bind(guest);
	t.mock.method(guest, 'identity', (...args: Parameters<typeof identify>) => { identities++; return identify(...args); });
	t.mock.method(guest, 'formatValue', (...args: Parameters<typeof label>) => { labels++; return label(...args); });
	t.mock.method(guest, 'formatStoredEntries', (...args: Parameters<typeof format>) => { values++; return format(...args); });
	t.mock.method(guest, 'previewValue', (...args: Parameters<typeof preview>) => { previews++; return preview(...args); });
	for (let observation = 0; observation < 1000; observation++) {
		properties.begin(true);
		if (observation % 2 === 0) {
			properties.field('member', '', 'UNKEYED', 30);
			properties.entry('member', key, 20, presentation);
			properties.entry('member', 1, value, presentation, 'DEFAULT: ', value);
		} else {
			properties.entry('member', 1, value, presentation, 'DEFAULT: ', value);
			properties.entry('member', key, 20, presentation);
			properties.field('member', '', 'UNKEYED', 30);
		}
		properties.finish();
		assert.strictEqual(document[0], observation % 2 === 0 ? unkeyedRow : numericRow);
		assert.strictEqual(document[1], stringRow);
		assert.strictEqual(document[2], observation % 2 === 0 ? numericRow : unkeyedRow);
		assert.equal(properties.changed, true);
		assert.ok(document.every(row => row.valueChanged === false));
	}
	assert.deepEqual([identities, labels, values, previews], [0, 0, 0, 0]);
	properties.invalidate();
	properties.begin(true);
	properties.entry('member', key, 21, presentation);
	properties.entry('member', 1, value, presentation, 'DEFAULT: ', value);
	properties.field('member', '', 'UNKEYED', 30);
	properties.finish();
	assert.strictEqual(document[0], stringRow); assert.strictEqual(document[1], numericRow);
	assert.equal(stringRow.valueChanged, true); assert.equal(numericRow.valueChanged, false);
	assert.ok(labels > 0); assert.equal(values, 3); assert.ok(previews > 0);
});

test('completed observations release omitted rows and returning identities start neutral', () => {
	const { sources, guest } = fixture(), properties = new BehaviorRuntimeProperties(sources, guest);
	properties.begin(true);
	properties.entry('member', 1, 10);
	properties.entry('member', 2, 20);
	properties.entry('member', 3, 30);
	const document = properties.finish(), removed = document[0], survivor = document[2];
	properties.begin(true);
	properties.entry('member', 3, 31);
	properties.text('STATUS', 'READY');
	properties.finish();
	assert.strictEqual(document[0], survivor); assert.equal(survivor.valueChanged, true);
	assert.deepEqual(document.map(row => row.label), ['3', 'STATUS']);
	assert.strictEqual(properties.finish(), document);

	properties.begin(true);
	properties.entry('member', 1, 100);
	properties.entry('member', 3, 31);
	properties.finish();
	assert.notStrictEqual(document[0], removed); assert.equal(document[0].valueChanged, false);
	assert.strictEqual(document[1], survivor); assert.equal(survivor.valueChanged, false);
	properties.begin(true); properties.finish(); properties.finish();
	assert.equal(document.length, 0);
	properties.begin(true); properties.entry('member', 3, 32); properties.finish();
	assert.notStrictEqual(document[0], survivor); assert.equal(document[0].valueChanged, false);
});

test('display-only occurrences retain unique rows but never enter a logical-watch projection', t => {
	const { sources, guest } = fixture(), key = guest.global('string');
	const properties = new BehaviorRuntimeProperties(sources, guest);
	const presentation = { prefix: 'KEY ' };
	const refresh = () => {
		properties.begin();
		properties.entry('shadowed-slot', 1, 10, presentation, '', undefined, key, false);
		properties.entry('member', key, 20, presentation);
		return properties.finish();
	};
	const document = refresh(), shadowed = document[0], canonical = document[1];
	assert.equal(shadowed.label, canonical.label); assert.equal(shadowed.watchIdentity, undefined);
	assert.strictEqual(canonical.watchIdentity, canonical.identity);
	assert.equal(runtimeInspectionPropertiesEqual(shadowed, canonical), false);
	const identities = t.mock.method(guest, 'identity'), formats = t.mock.method(guest, 'formatStoredEntries');
	for (let observation = 0; observation < 1000; observation++) {
		refresh(); assert.strictEqual(document[0], shadowed); assert.strictEqual(document[1], canonical);
		assert.equal(properties.changed, false);
	}
	assert.equal(identities.mock.callCount(), 0); assert.equal(formats.mock.callCount(), 0);
	const filtered = new BehaviorRuntimeProperties(sources, guest, () => true);
	filtered.begin(); filtered.entry('shadowed-slot', 1, 10, presentation, '', undefined, key, false);
	assert.equal(filtered.finish().length, 0);
	assert.equal(identities.mock.callCount(), 0); assert.equal(formats.mock.callCount(), 0);
});
