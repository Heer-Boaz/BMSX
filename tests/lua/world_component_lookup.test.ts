import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES as modules, WORLD_CPU_SETUP as setup } from '../helpers/world_cpu';

for (const optLevel of [0, 3] as const) {
	test(`World component lookup returns absence across attachment and dense removal (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(setup + `
local component_class<const> = setmetatable({}, { __index = base_component })
component_class.__index = component_class
local derived_class<const> = setmetatable({}, { __index = component_class })
derived_class.__index = derived_class
prefab.define({ def_id = 'lookup.owner', class = world_object })
local owner<const> = world:spawn('lookup.owner', {})
assert(owner:get_component(component_class) == nil
	and owner:get_component(component_class, 'missing') == nil
	and owner:get_component(base_component, 'missing') == nil,
	'component lookup did not return absence before attachment')

local first<const> = setmetatable(base_component.new(owner, { id_local = 'first' }), component_class)
local second<const> = setmetatable(base_component.new(owner, { id_local = 'second' }), derived_class)
local third<const> = setmetatable(base_component.new(owner, { id_local = 'third' }), component_class)
owner:add_component(first)
owner:add_component(second)
owner:add_component(third)
assert(owner:get_component(component_class) == first
	and owner:get_component(component_class, 'first') == first
	and owner:get_component(component_class, 'second') == second
	and owner:get_component(derived_class, 'second') == second
	and owner:get_component(base_component, 'third') == third,
	'component lookup did not return the attached identity through its class lineage')
assert(owner:get_component(component_class, 'missing') == nil
	and owner:get_component(derived_class, 'first') == nil,
	'named component lookup returned an unrelated attached component')

owner:remove_component(first)
assert(owner:get_component(component_class, 'first') == nil
	and owner:get_component(component_class, 'second') == second
	and owner:get_component(component_class, 'third') == third
	and owner:get_component(base_component, 'third') == third,
	'dense removal lost a remaining component or retained the removed identity')
owner:remove_component(third)
owner:remove_component(second)
assert(owner:get_component(component_class) == nil
	and owner:get_component(component_class, 'third') == nil
	and owner:get_component(derived_class, 'second') == nil
	and owner:get_component(base_component, 'second') == nil,
	'component lookup did not return absence after the final attachment was removed')

owner:add_component(second)
assert(owner:get_component(component_class) == second
	and owner:get_component(component_class, 'second') == second
	and owner:get_component(derived_class, 'second') == second
	and owner:get_component(component_class, 'first') == nil,
	'component reattachment did not restore lookup without restoring removed peers')
owner:remove_component(second)
assert(owner:get_component(component_class, 'second') == nil,
	'component lookup retained the reattached identity after removal')
owner:mark_for_disposal()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
}
