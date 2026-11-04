import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { runCompletionClosure } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
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
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const map = probe.getStringKey(cpu.stringPool.find('map')!) as Table;
		const clear = probe.getStringKey(cpu.stringPool.find('clear')!) as Closure;
		const next = map.next;
		let starts = 0, steps = 0;
		// A destructive clear must advance one physical traversal. Restarting
		// next(map) for each key repeatedly scans every already-cleared prefix.
		t.mock.method(map, 'next', (afterTag, afterScalar, afterReference, output, outputIndex) => {
			steps++;
			if (afterTag === ValueTag.Nil) starts++;
			return next.call(map, afterTag, afterScalar, afterReference, output, outputIndex);
		});
		runCompletionClosure(cpu, clear, []);
		assert.equal(starts, 1);
		assert.equal(steps, (probe.getStringKey(cpu.stringPool.find('count')!) as number) + 1);
		assert.equal(probe.getStringKey(cpu.stringPool.find('map')!), map);
		map.forEachStoredEntry(() => assert.fail('cleared map retained a mapping'));
	});

	test(`clear_map releases collectable keys and values across repeated lifetimes (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(`
local clear<const> = require('cartlib/util/clear_map')
local map<const> = {}
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
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const seed = probe.getStringKey(cpu.stringPool.find('seed')!) as Closure;
		const clear = probe.getStringKey(cpu.stringPool.find('clear')!) as Closure;
		let warmed = 0;
		for (let cycle = 0; cycle < 3; cycle++) {
			runCompletionClosure(cpu, seed, []);
			runCompletionClosure(cpu, clear, []);
			const heap = cpu.collectTrackedHeapBytes();
			const weak = probe.getStringKey(cpu.stringPool.find('weak')!) as Table;
			for (let index = 1; index <= 64; index++) assert.equal(weak.getInteger(index), null);
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
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 128);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});
}
