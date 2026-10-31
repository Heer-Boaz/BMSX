import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { profileWarmGuestKernel } from '../helpers/guest_kernel';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';

for (const optLevel of [0, 3] as const) {
	test(`World and Scene accept omitted construction options without replacing explicit inputs (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local shared<const> = { score = 12 }
local actor<const> = {}
function actor:ctor(options)
 assert(self.world == world and self.definition_id == 'inputs.actor')
 self.received_options = options
 assert(self.health ~= nil and self.team == 'player')
end
prefab.define({ def_id = 'inputs.actor', class = actor,
 defaults = { health = 10, team = 'player', shared = shared } })

local first<const> = world:spawn('inputs.actor')
local second<const> = world:spawn('inputs.actor', nil)
assert(first.received_options == second.received_options and next(first.received_options) == nil)
assert(first.health == 10 and first.visible and first.shared == shared)
assert(registry:get(first.id) == first and registry:get(second.id) == second)
assert(first._construction_options == nil and second._construction_options == nil)

local input<const> = { health = 0, visible = false, shared = shared }
local explicit<const> = world:spawn('inputs.actor', input)
assert(explicit.received_options == input and explicit.health == 0 and not explicit.visible)
assert(input.team == nil and explicit.shared == shared)
input.health = 7
local reused<const> = world:spawn('inputs.actor', input)
assert(reused.received_options == input and reused.health == 7 and explicit.health == 0)
shared.score = 23
assert(explicit.shared.score == 23 and reused.shared.score == 23)

scenes.register('inputs.scene', { objects = {} })
local scene<const> = scenes.create('inputs.scene')
local member<const> = scene:spawn('inputs.actor')
assert(member.scene == scene and member.health == 10 and member.shared == shared)
assert(member.received_options == first.received_options and #scene.objects.items == 1)
assert(registry:get(member.id) == member)
scene:dispose()
assert(member.world == nil and #scene.objects.items == 0)

world:_open_mutation_barrier()
local pending<const> = world:spawn('inputs.actor')
assert(pending.health == 10 and pending.received_options == first.received_options)
assert(registry:get(pending.id) == nil and not pending.active)
world:_commit_mutation_barrier()
assert(registry:get(pending.id) == pending and pending.active)
assert(pending._construction_options == nil)
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});

	test(`Omitted spawn options have the same guest allocation cost as reused explicit input (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
prefab.define({ def_id = 'inputs.group', class = world_object,
 defaults = { id = 'inputs.reused' } })
local input<const> = {}
probe = {
 omitted = function(count)
  for index = 1, count do world:spawn('inputs.group'):mark_for_disposal() end
 end,
 explicit = function(count)
  for index = 1, count do world:spawn('inputs.group', input):mark_for_disposal() end
 end,
}
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const probe = cpu.getGlobalByKey(cpu.stringPool.find('probe')!) as Table;
		const omitted = probe.getStringKey(cpu.stringPool.find('omitted')!) as Closure;
		const explicit = probe.getStringKey(cpu.stringPool.find('explicit')!) as Closure;
		const implicitProfile = profileWarmGuestKernel(cpu, omitted, 32);
		const explicitProfile = profileWarmGuestKernel(cpu, explicit, 32);
		// Fixed identity and immediate retirement isolate input admission from
		// ID-string growth; the control reuses one real caller-owned input.
		assert.equal(implicitProfile.reservations, explicitProfile.reservations);
		assert.equal(implicitProfile.reservedBytes, explicitProfile.reservedBytes);
	});
}
