import { readStockGlobalValue } from '../../toolchain/ts/firmware/stock_global_bank';
import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { valueInteger, valueBool, valueNil, asStringId, valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) test(`FSM reset releases every previous data field and restores declared defaults (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local fsm<const> = require('cartlib/fsm/fsm')
local default_object<const> = { retained = true }
local definition<const> = fsm.state_definition.new('reset_lifetime', {
 data = { count = 7, enabled = false, object = default_object },
 initial = 'idle',
 states = { idle = { data = { status = 'idle' } } },
})
local machine<const> = fsm.state.new(definition, { id = 'reset_target' }, nil, nil, nil)
local child<const> = machine.states.idle
local weak<const> = setmetatable({}, { __mode = 'v' })
probe = { weak = weak, data = machine.data, child_data = child.data, default_object = default_object }
function probe.seed()
 machine.data.count = 99
 machine.data.enabled = true
 machine.data.object = nil
 child.data.status = 'changed'
 local next_ref = 1
 for index = 1, 16 do
  local key<const> = {}
  local value<const> = { buffer = { index, index + 1 } }
  weak[next_ref] = key
  weak[next_ref + 1] = value
  next_ref = next_ref + 2
  machine.data[key] = value
  machine.data['transient_' .. index] = value
  child.data['transient_' .. index] = value
 end
 weak[next_ref] = default_object
end
function probe.reset_local()
 machine:reset(false)
end
function probe.reset_tree()
 machine:reset()
end
`, { optLevel });
	runGuestToHalt(cpu, 10_000_000);
	const probe = valuePayload(readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find('probe')!));
	const seed = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('seed')!), nativeHeapReference(cpu).gc);
	const resetLocal = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('reset_local')!), nativeHeapReference(cpu).gc);
	const resetTree = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('reset_tree')!), nativeHeapReference(cpu).gc);
	const weak = valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('weak')!));
	const data = valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('data')!));
	const childData = valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('child_data')!));
	const defaultObject = cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('default_object')!);
	for (let cycle = 0; cycle < 3; cycle++) {
		runCompletionClosure(cpu, seed, []);
		runCompletionClosure(cpu, resetLocal, []);
		let rootFields = 0;
		cpu.tables.forEachStoredEntry(data, () => rootFields++);
		assert.equal(rootFields, 3, 'local reset must remove every undeclared field, including object keys');
		assert.equal(cpu.tables.getStringKey(data, nativeHeapReference(cpu).stringPool.find('count')!), valueInteger(7));
		assert.equal(cpu.tables.getStringKey(data, nativeHeapReference(cpu).stringPool.find('enabled')!), valueBool(false));
		assert.equal(cpu.tables.getStringKey(data, nativeHeapReference(cpu).stringPool.find('object')!), defaultObject);
		assert.notEqual(cpu.tables.getStringKey(childData, nativeHeapReference(cpu).stringPool.find('transient_16')!), valueNil(), 'local reset must preserve child data');
		runCompletionClosure(cpu, resetTree, []);
		let childFields = 0;
		cpu.tables.forEachStoredEntry(childData, () => childFields++);
		assert.equal(childFields, 1, 'tree reset must remove every undeclared child field');
		assert.equal(cpu.stringPool.toString(asStringId(cpu.tables.getStringKey(childData, nativeHeapReference(cpu).stringPool.find('status')!))), 'idle');
		nativeHeapReference(cpu).gc.collect();
		for (let index = 1; index <= 32; index++) assert.equal(cpu.tables.getInteger(weak, index), valueNil(), `stale data reference ${index} survived reset`);
		assert.notEqual(cpu.tables.getInteger(weak, 33), valueNil(), 'declared object defaults must retain their identity');
	}
});
