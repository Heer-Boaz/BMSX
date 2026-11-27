import { nativeHeapReference } from '../helpers/native_heap/reference';
import { createReferenceTable } from '../helpers/cpu_heap_reference';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';
import { RuntimePropertyIndex } from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { valueString, valueTable, valueInteger, valueFloat, valueFloatBits, valueBool, valueNil, valuePayload, valueFromTag, type Value, ValueTag } from '../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { CPU_RESET_BANK_ADDRESS } from '../../machine/ts/spec/bmsx/memory_map';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { runGuestToHalt } from '../helpers/cpu_test_harness';
import { linkManagedTestSystem } from '../helpers/managed_system';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';

let firmware: { rom: Uint8Array; collectionEntry: number } | undefined;
const watchBudget = 1_000_000;

function bootWatchGuest() {
	if (firmware === undefined) {
		const linked = linkManagedTestSystem(`
local ids<const> = require('kernel/heap_control_ids')
while true do
	halt_until_irq
	blua32.svc(ids.collect_full)
end`, 3);
		firmware = {
			rom: writeTestBlua32Rom(linked),
			collectionEntry: linked.startupFunctionAddress,
		};
	}
	const runtime = createTestRuntime(firmware.rom);
	runtime.boot();
	const { cpu } = runtime.machine;
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	runGuestToHalt(cpu, watchBudget);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	return runtime;
}

function collectOnGuest(runtime: ReturnType<typeof bootWatchGuest>): void {
	const { cpu } = runtime.machine;
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, watchBudget);
	assert.equal(cpu.isHaltedUntilIrq(), true, 'the guest retired its full collection and returned to the watch pause');
}

test('retained string identities and property indexes follow text, not recycled intern slots', () => {
	const runtime = bootWatchGuest(), cpu = runtime.machine.cpu;
	const pool = nativeHeapReference(cpu).stringPool, guest = new SuspendedGuestSession(runtime);
	const old = pool.intern('retained-identity-before-gc'), identity = guest.identity(valueString(old));
	const property = { section: 'entries', field: '', key: identity }, index = new RuntimePropertyIndex<string>();
	index.set(property, 'selected');
	const presentation = new SuspendedValuePresentation(guest, 'watch');
	assert.equal(presentation.update(valueString(old)), 'retained-identity-before-gc');
	collectOnGuest(runtime);
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
	const runtime = bootWatchGuest(), cpu = runtime.machine.cpu;
	const guest = new SuspendedGuestSession(runtime), presentation = new SuspendedValuePresentation(guest, 'summary');
	const table = createReferenceTable(cpu), first = valueTable(table);
	const identity = guest.identity(first);
	presentation.update(first);
	collectOnGuest(runtime);
	const replacement = createReferenceTable(cpu), second = valueTable(replacement);
	assert.equal(valuePayload(first), valuePayload(second), 'exercise physical record reuse');
	assert.equal(guest.matchesIdentity(second, identity), false);
	presentation.update(second);
	assert.equal(presentation.observationChanged, true);
});

test('table previews use the returned key, not traversal work, to detect exhaustion', () => {
	const runtime = bootWatchGuest(), cpu = runtime.machine.cpu;
	const guest = new SuspendedGuestSession(runtime);
	const table = createReferenceTable(cpu, 8, 16);
	const value = valueTable(table);
	const presentation = new SuspendedValuePresentation(guest, 'preview');
	assert.equal(guest.previewValue(value, 1, 8), '{}', 'vacant allocated storage has no preview entries');
	assert.equal(presentation.update(value), '{}');
	nativeHeapReference(cpu).gc.tables.set(table, valueBool(false), valueInteger(7));
	assert.equal(guest.previewValue(value, 1, 8), '{ false = 7 }', 'a false key is a live entry');
	assert.equal(presentation.update(value), '{ false = 7 }');
	nativeHeapReference(cpu).gc.tables.set(table, valueBool(false), valueNil());
	assert.equal(guest.previewValue(value, 1, 8), '{}', 'a deleted hash node is not a preview entry');
	assert.equal(presentation.update(value), '{}');
});

test('suspended member reads and enumeration follow the runtime index field', () => {
	const runtime = bootWatchGuest();
	const guest = new SuspendedGuestSession(runtime), { cpu } = runtime.machine;
	const { tables } = nativeHeapReference(cpu).gc, pool = nativeHeapReference(cpu).stringPool;
	const child = createReferenceTable(cpu, 0, 1), parent = createReferenceTable(cpu, 0, 2), meta = createReferenceTable(cpu, 0, 1);
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
	const runtime = bootWatchGuest(), { cpu } = runtime.machine;
	const guest = new SuspendedGuestSession(runtime), observer = new SuspendedGuestSession(runtime);
	const table = valueTable(createReferenceTable(cpu));
	const romFunction = valueFromTag(ValueTag.CodeFunction, firmware!.collectionEntry);
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
