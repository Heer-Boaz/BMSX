import assert from 'node:assert/strict';
import test from 'node:test';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';
import { RuntimePropertyIndex } from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { valueString, valueTable, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valuePayload, valueResidentFunction, type Value } from '../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileHeapServiceSystem, residentFunctionAddress } from '../helpers/heap_service_system';
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
	const replacement = pool.intern('retained-identity-after-gc!');
	assert.equal(replacement, old, 'regression requires actual slot reuse');
	assert.equal(guest.matchesIdentity(valueString(replacement), identity), false);
	assert.equal(index.find('entries', '', valueString(replacement), guest), undefined);
	assert.equal(presentation.update(valueString(replacement)), 'retained-identity-after-gc!');
	assert.equal(presentation.observationChanged, true, 'changed text is observable without restore invalidation');
	const recreated = pool.intern('retained-identity-before-gc');
	assert.notEqual(recreated, old);
	assert.equal(guest.matchesIdentity(valueString(recreated), identity), true, 'equal Lua strings have value identity');
	assert.equal(index.find('entries', '', valueString(recreated), guest), 'selected');
	assert.equal(presentation.update(valueString(recreated)), 'retained-identity-before-gc');
	assert.equal(index.delete(property), true);
});

test('numeric watches retain subtype and raw NaN identity instead of host Number equality', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), guest = new SuspendedGuestSession(runtime);
	const presentation = new SuspendedValuePresentation(guest, 'summary');
	presentation.update(valueInteger(2));
	presentation.update(valueInteger(2)); assert.equal(presentation.observationChanged, false);
	presentation.update(valueFloat(2)); assert.equal(presentation.observationChanged, true);
	presentation.update(valueFloat(2)); assert.equal(presentation.observationChanged, false);
	const first = valueFloatBits(0xffa12345), second = valueFloatBits(0xffa12346);
	assert.equal(guest.formatValue(first), guest.formatValue(second), 'the same display must not hide different raw words');
	presentation.update(first); presentation.update(second);
	assert.equal(presentation.observationChanged, true);
	presentation.update(second); assert.equal(presentation.observationChanged, false);
});

test('retained object identities do not alias a recycled compact heap reference', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), cpu = runtime.machine.cpu;
	const guest = new SuspendedGuestSession(runtime), presentation = new SuspendedValuePresentation(guest, 'summary');
	cpu.collectTrackedHeapBytes();
	const table = cpu.createTable(), first = valueTable(table);
	const identity = guest.identity(first);
	presentation.update(first);
	cpu.collectTrackedHeapBytes();
	const replacement = cpu.createTable(), second = valueTable(replacement);
	assert.equal(valuePayload(first), valuePayload(second), 'exercise physical record reuse');
	assert.equal(guest.matchesIdentity(second, identity), false);
	presentation.update(second);
	assert.equal(presentation.observationChanged, true);
});

test('table previews use the returned key, not traversal work, to detect exhaustion', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload()), cpu = runtime.machine.cpu;
	const guest = new SuspendedGuestSession(runtime);
	const table = cpu.createTable(8, 16);
	const value = valueTable(table);
	const presentation = new SuspendedValuePresentation(guest, 'preview');
	assert.equal(guest.previewValue(value, 1, 8), '{}', 'vacant allocated storage has no preview entries');
	assert.equal(presentation.update(value), '{}');
	cpu.gc.tables.set(table, valueBool(false), valueInteger(7));
	assert.equal(guest.previewValue(value, 1, 8), '{ false = 7 }', 'a false key is a live entry');
	assert.equal(presentation.update(value), '{ false = 7 }');
	cpu.gc.tables.set(table, valueBool(false), valueNil());
	assert.equal(guest.previewValue(value, 1, 8), '{}', 'a deleted hash node is not a preview entry');
	assert.equal(presentation.update(value), '{}');
});

test('suspended member reads and enumeration follow the runtime index field', () => {
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const guest = new SuspendedGuestSession(runtime), { cpu } = runtime.machine;
	const { tables } = cpu.gc, pool = cpu.stringPool;
	const child = cpu.createTable(0, 1), parent = cpu.createTable(0, 2), meta = cpu.createTable(0, 1);
	const shared = pool.intern('member-shadow'), inherited = pool.intern('member-inherited');
	tables.setStringKey(child, shared, valueBool(false));
	tables.setStringKey(parent, shared, valueInteger(13));
	tables.setStringKey(parent, inherited, valueInteger(17));
	tables.setStringKey(meta, pool.find('__index')!, valueTable(parent));
	tables.setMetatableAddress(child, meta);
	const value = valueTable(child);

	assert.equal(guest.readStringMember(value, 'member-shadow'), valueBool(false));
	assert.equal(guest.readStringMember(value, 'member-inherited'), valueInteger(17));
	const members = new Map<string, Value>();
	guest.visitTableStringMembers(value, (name, entry) => members.set(name, entry));
	assert.deepEqual(members, new Map([['member-shadow', valueBool(false)], ['member-inherited', valueInteger(17)]]));
});

test('a replaced heap retires tool lifetime tokens without a collector notification', () => {
	const system = linkTestSystemBlua32(compileHeapServiceSystem('halt_until_irq', 3));
	const runtime = createTestRuntime(system.romBytes), { cpu } = runtime.machine;
	runtime.boot();
	const guest = new SuspendedGuestSession(runtime), observer = new SuspendedGuestSession(runtime);
	const table = valueTable(cpu.createTable());
	const romFunction = valueResidentFunction(residentFunctionAddress(system, 'kernel/gc_full', 'collect_full'));
	const checkpoint = captureRuntimeSaveState(runtime);
	const previous = observer.identity(table);
	const previousFunction = observer.identity(romFunction);
	guest.invalidate('execution');
	assert.equal(observer.matchesIdentity(table, previous), true, 'suspending the same live heap retains the observation');
	assert.equal(observer.matchesIdentity(romFunction, previousFunction), true);
	applyRuntimeSaveState(runtime, checkpoint);
	assert.equal(observer.matchesIdentity(table, previous), false, 'an actual RAM restore drops derived observations');
	assert.equal(observer.matchesIdentity(romFunction, previousFunction), false, 'ROM observations end on replacement without a RAM watch');
	const restored = observer.identity(table);
	guest.invalidate('heap-replaced');
	assert.equal(observer.matchesIdentity(table, restored), false, 'a replacement can reuse exactly the same encoded address');
});
