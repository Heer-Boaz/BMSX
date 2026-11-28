import { asClosure } from '../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import { collectReferenceHeapBytes } from '../helpers/cpu_heap_reference';
import { logicalThreadBytes } from '../helpers/guest_kernel';
import { valueNil, valueInteger, valuePayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_SETUP } from '../helpers/world_cpu';
import { runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

test('Retired World actors and their local tag graphs are collectable without disturbing admitted identities (O3)', () => {
	const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
world:start()
prefab.define({ def_id = 'registered.actor', class = world_object })
local retained<const> = world:spawn('registered.actor', { id = 'retained' })
probe = { next_key = 1000 }
function probe.churn(count)
 local weak<const> = setmetatable({}, { __mode = 'v' })
 for index = 1, count do
  local actor<const> = world:spawn('registered.actor')
  local tag<const> = 'tag.' .. (probe.next_key + index)
  weak[index] = actor
  actor:add_tag(tag)
  actor:add_tag('tag.shared')
  actor:remove_tag(tag)
  assert(not actor:has_tag(tag) and actor:has_tag('tag.shared'))
  actor:remove_tag('tag.shared')
  assert(not actor:has_tag('tag.shared'))
  actor:add_tag(tag)
  assert(registry:get(actor.id) == actor)
  actor:mark_for_disposal()
  assert(registry:get(actor.id) == nil)
 end
 probe.next_key = probe.next_key + count
 probe.weak = weak
 assert(#world._objects == 1 and registry:get('retained') == retained)
end
`, { optLevel: 3 });
	runGuestToHalt(cpu, 20_000_000);
	const probe = valuePayload(cpu.getGlobalByKey(cpu.stringPool.find('probe')!));
	const churn = asClosure(cpu.tables.getStringKey(probe, cpu.stringPool.find('churn')!), nativeHeapReference(cpu).gc);
	let warmed = 0;
	for (let cycle = 0; cycle < 3; cycle++) {
		runCompletionClosure(cpu, churn, [valueInteger(128)]);
		const heap = collectReferenceHeapBytes(cpu) - logicalThreadBytes(cpu);
		const weak = valuePayload(cpu.tables.getStringKey(probe, cpu.stringPool.find('weak')!));
		for (let index = 1; index <= 128; index++) assert.equal(cpu.tables.getInteger(weak, index), valueNil());
		if (cycle === 0) warmed = heap;
		else assert.ok(heap <= warmed, `retired identities must not retain more heap: ${heap} > ${warmed}`);
	}
});
