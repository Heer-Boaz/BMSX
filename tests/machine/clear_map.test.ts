import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { collectReferenceHeapBytes } from '../helpers/cpu_heap_reference';
import { numberToHost, valueNil, valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { logicalThreadBytes, profileWarmGuestKernel } from '../helpers/guest_kernel';
import { runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) {
	test(`clear_map traverses mixed entries once without replacing its map (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(`
local clear<const> = require('cartlib/util/clear_map')
local map<const> = {}
local keys<const> = { false, true, 0, -1, 0.5, next }
for index = 1, 32 do
 keys[#keys + 1] = index
 keys[#keys + 1] = 'field_' .. index
 keys[#keys + 1] = {}
end
for index = 1, #keys do map[keys[index]] = { index = index } end
probe = { map = map, count = #keys }
function probe.clear() clear(map) end
`, { optLevel });
		runGuestToHalt(cpu, 10_000_000);
		const probe = valuePayload(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('probe')!));
		const map = valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('map')!));
		const clear = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('clear')!), nativeHeapReference(cpu).gc);
		const next = cpu.tables.nextStoredEntry;
		let starts = 0, steps = 0;
		// A destructive clear must advance one physical traversal. Restarting
		// next(map) for each key repeatedly scans every already-cleared prefix.
		t.mock.method(cpu.tables, 'nextStoredEntry', (record, position, output, outputIndex, wantsValue) => {
			steps++;
			if (position === 0) starts++;
			return next.call(cpu.tables, record, position, output, outputIndex, wantsValue);
		});
		runCompletionClosure(cpu, clear, []);
		assert.equal(starts, 1);
		assert.equal(steps, numberToHost(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('count')!)) + 1);
		assert.equal(valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('map')!)), map);
		cpu.tables.forEachStoredEntry(map, () => assert.fail('cleared map retained a mapping'));
	});

	test(`clear_map releases collectable keys and values across repeated lifetimes (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local clear<const> = require('cartlib/util/clear_map')
local map<const> = {}
-- Reserve the known integer band before measuring retention of historical object keys.
for index = 1, 32 do map[index] = false end
probe = { map = map }
function probe.seed()
 local weak<const> = setmetatable({}, { __mode = 'v' })
 for index = 1, 32 do
  local key<const> = {}
  local value<const> = { payload = { index } }
  weak[index] = key
  weak[index + 32] = value
  map[key] = value
  map[index] = value
 end
 probe.weak = weak
end
function probe.clear() clear(map) end
`, { optLevel });
		runGuestToHalt(cpu, 10_000_000);
		const probe = valuePayload(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('probe')!));
		const seed = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('seed')!), nativeHeapReference(cpu).gc);
		const clear = asClosure(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('clear')!), nativeHeapReference(cpu).gc);
		let warmed = 0;
		for (let cycle = 0; cycle < 3; cycle++) {
			runCompletionClosure(cpu, seed, []);
			runCompletionClosure(cpu, clear, []);
			const heap = collectReferenceHeapBytes(cpu) - logicalThreadBytes(cpu);
			const weak = valuePayload(cpu.tables.getStringKey(probe, nativeHeapReference(cpu).stringPool.find('weak')!));
			for (let index = 1; index <= 64; index++) assert.equal(cpu.tables.getInteger(weak, index), valueNil());
			if (cycle === 0) warmed = heap;
			else assert.equal(heap, warmed, 'historical keys must not grow retained clear storage');
		}
	});

	test(`warm mixed map clear and refill allocate no storage (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(`
local clear<const> = require('cartlib/util/clear_map')
local keys<const> = {}
for index = 1, 32 do
 keys[#keys + 1] = index
 keys[#keys + 1] = 'field_' .. index
 keys[#keys + 1] = {}
end
local map<const> = {}
kernel = function(count)
 for cycle = 1, count do
  for index = 1, #keys do map[keys[index]] = index end
  clear(map)
 end
end
`, { optLevel });
		runGuestToHalt(cpu, 10_000_000);
		const kernel = asClosure(cpu.getGlobalByKey(nativeHeapReference(cpu).stringPool.find('kernel')!), nativeHeapReference(cpu).gc);
		const profile = profileWarmGuestKernel(cpu, kernel, 128);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});
}
