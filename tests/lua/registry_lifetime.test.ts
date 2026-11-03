import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { runCompletionClosure } from './cpu_test_harness';

function entryCount(table: Table): number {
	let count = 0;
	table.forEachStoredEntry(() => count++);
	return count;
}

const setup = `
local registry<const> = require('cartlib/registry')
probe = { registry = registry }
`;

for (const optLevel of [0, 3] as const) {
	test(`Registry retires last-member keys through reconciliation and deregistration without disturbing live members (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local key<const> = {}
local other<const> = {}
local first<const> = { id = registry:next_id() }
local second<const> = { id = registry:next_id() }
registry:register(first)
registry:register(second)
registry:index(first, key)
registry:index(second, key)
registry:index(first, other)
registry:reconcile_index(first, key, false)
assert(#registry:entries(key) == 1 and registry:entries(key)[1] == second)
assert(#registry:entries(other) == 1 and registry:entries(other)[1] == first)
registry:deregister(second)
probe.after_deregister = registry._entries_by_key[key]
registry:index(first, key)
assert(#registry:entries(key) == 1 and registry:entries(key)[1] == first)
registry:reconcile_index(first, key, false)
probe.after_reconcile = registry._entries_by_key[key]
assert(#registry:entries(key) == 0 and #registry:entries(other) == 1)
registry:deregister(first)
probe.remaining = registry._entries_by_key
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		assert.equal(probe.getStringKey(cpu.stringPool.find('after_deregister')!), null, 'last deregistered member must retire its key');
		assert.equal(probe.getStringKey(cpu.stringPool.find('after_reconcile')!), null, 'last reconciled member must retire its key');
		assert.equal(entryCount(probe.getStringKey(cpu.stringPool.find('remaining')!) as Table), 0);
	});

	for (const keyKind of ['table', 'string'] as const) test(`Registry releases retired ${keyKind} keys and entries and plateaus across distinct-key lifetimes (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
probe.next_key = 1000
function probe.churn(count)
 local weak<const> = setmetatable({}, { __mode = 'v' })
 for index = 1, count do
  local key<const> = ${keyKind === 'table' ? '{ buffer = { index } }' : "'tag.' .. (probe.next_key + index)"}
  local entry<const> = { id = registry:next_id() }
  weak[1] = ${keyKind === 'table' ? 'key' : 'nil'}
  weak[2] = entry
  registry:register(entry)
  registry:index(entry, key)
  registry:deregister(entry)
 end
 probe.next_key = probe.next_key + count
 probe.weak = weak
end
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const churn = probe.getStringKey(cpu.stringPool.find('churn')!) as Closure;
		const registry = probe.getStringKey(cpu.stringPool.find('registry')!) as Table;
		const byKey = registry.getStringKey(cpu.stringPool.find('_entries_by_key')!) as Table;
		let warmed = 0;
		for (let cycle = 0; cycle < 3; cycle++) {
			runCompletionClosure(cpu, churn, [256]);
			const heap = cpu.collectTrackedHeapBytes();
			const weak = probe.getStringKey(cpu.stringPool.find('weak')!) as Table;
			assert.equal(weak.getInteger(1), null, 'retired key graph remained reachable');
			assert.equal(weak.getInteger(2), null, 'deregistered entry remained reachable');
			assert.equal(entryCount(byKey), 0, 'empty key buckets accumulated');
			if (cycle === 0) warmed = heap;
			else assert.equal(heap, warmed, 'distinct historical keys must not grow retained Registry storage');
		}
	});

	test(`World tag reconciliation and disposal retire historical Registry keys and actor graphs (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({ def_id = 'registry.actor', class = world_object })
probe = { next_key = 1000 }
function probe.churn(count)
 local weak<const> = setmetatable({}, { __mode = 'v' })
 for index = 1, count do
  local actor<const> = world:spawn('registry.actor')
  local tag<const> = 'tag.' .. (probe.next_key + index)
  weak[index] = actor
  actor:add_tag(tag)
  actor:add_tag('tag.shared')
  actor:remove_tag(tag)
  assert(registry._entries_by_key[tag] == nil and not actor:has_tag(tag))
  actor:remove_tag('tag.shared')
  assert(registry._entries_by_key['tag.shared'] == nil)
  actor:add_tag(tag)
  actor:mark_for_disposal()
  assert(registry._entries_by_key[tag] == nil and registry:get(actor.id) == nil)
 end
 probe.next_key = probe.next_key + count
 probe.weak = weak
 assert(#world._objects == 0 and next(registry._entries_by_key) == nil)
end
`, { optLevel, modules: WORLD_CPU_MODULES });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const churn = probe.getStringKey(cpu.stringPool.find('churn')!) as Closure;
		let warmed = 0;
		for (let cycle = 0; cycle < 3; cycle++) {
			runCompletionClosure(cpu, churn, [128]);
			const heap = cpu.collectTrackedHeapBytes();
			const weak = probe.getStringKey(cpu.stringPool.find('weak')!) as Table;
			for (let index = 1; index <= 128; index++) assert.equal(weak.getInteger(index), null);
			if (cycle === 0) warmed = heap;
			else assert.equal(heap, warmed, 'historical World tags must not grow retained Registry storage');
		}
	});

	test(`Warm fixed-key Registry reconciliation reuses empty membership storage without allocating (O${optLevel})`, t => {
		const { cpu } = createCartlibProgramHarness(setup + `
local entries<const> = {}
local keys<const> = {}
for index = 1, 32 do
 local entry<const> = { id = registry:next_id() }
 registry:register(entry)
 entries[index] = entry
 keys[index] = {}
end
kernel = function(count)
 for cycle = 1, count do
  for index = 1, 32 do registry:index(entries[index], keys[index]) end
  for index = 1, 32 do registry:reconcile_index(entries[index], keys[index], false) end
 end
end
`, { optLevel });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const kernel = cpu.getGlobalByKey(cpu.stringPool.find('kernel')!) as Closure;
		const profile = profileWarmGuestKernel(cpu, kernel, 128);
		assert.equal(profile.reservations, 0);
		assert.equal(profile.reservedBytes, 0);
		assert.equal(profile.retainedAfter, profile.retainedBefore);
		t.diagnostic(JSON.stringify({ optLevel, ...profile }));
	});
}
