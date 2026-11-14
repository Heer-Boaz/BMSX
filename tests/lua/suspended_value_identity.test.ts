import assert from 'node:assert/strict';
import test from 'node:test';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';
import { RuntimePropertyIndex } from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { valueString } from '../../machine/ts/machine/cpu/value';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';

test('retained string identities and property indexes follow text, not recycled intern slots', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), cpu = runtime.machine.cpu;
	const pool = cpu.stringPool, guest = new SuspendedGuestSession(runtime);
	cpu.collectTrackedHeapBytes();
	const old = pool.intern('retained-identity-before-gc'), identity = guest.identity(valueString(old));
	const property = { section: 'entries', field: '', key: identity }, index = new RuntimePropertyIndex<string>();
	index.set(property, 'selected');
	const presentation = new SuspendedValuePresentation(guest, 'watch');
	assert.equal(presentation.update(valueString(old)), 'retained-identity-before-gc');
	cpu.collectTrackedHeapBytes();
	assert.equal(pool.find('retained-identity-before-gc'), undefined, 'tool identities do not pin guest strings');
	const replacement = pool.intern('replacement-after-gc');
	assert.equal(replacement, old, 'regression requires actual slot reuse');
	assert.equal(guest.matchesIdentity(valueString(replacement), identity), false);
	assert.equal(index.find('entries', '', valueString(replacement), guest), undefined);
	assert.equal(presentation.update(valueString(replacement)), 'replacement-after-gc');
	assert.equal(presentation.observationChanged, true, 'changed text is observable without restore invalidation');
	const recreated = pool.intern('retained-identity-before-gc');
	assert.notEqual(recreated, old);
	assert.equal(guest.matchesIdentity(valueString(recreated), identity), true, 'equal Lua strings have value identity');
	assert.equal(index.find('entries', '', valueString(recreated), guest), 'selected');
	assert.equal(presentation.update(valueString(recreated)), 'retained-identity-before-gc');
	assert.equal(index.delete(property), true);
});

test('table previews use the returned key, not traversal work, to detect exhaustion', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), cpu = runtime.machine.cpu;
	const guest = new SuspendedGuestSession(runtime);
	const table = cpu.createTable(8, 16);
	const presentation = new SuspendedValuePresentation(guest, 'preview');
	assert.equal(guest.previewValue(table, 1, 8), '{}', 'vacant allocated storage has no preview entries');
	assert.equal(presentation.update(table), '{}');
	table.set(false, 7);
	assert.equal(guest.previewValue(table, 1, 8), '{ false = 7 }', 'a false key is a live entry');
	assert.equal(presentation.update(table), '{ false = 7 }');
	table.set(false, null);
	assert.equal(guest.previewValue(table, 1, 8), '{}', 'a deleted hash node is not a preview entry');
	assert.equal(presentation.update(table), '{}');
});
