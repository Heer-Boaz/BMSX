import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';

// Real component/World construction; the compiler dependency records its
// admission inputs. Actual binding evaluation belongs to input/runtime tests.
const modules = [...WORLD_CPU_MODULES, {
	path: 'cartlib/input/actioneffect/actioneffect_component',
	source: readFileSync('cartlib/input/actioneffect/actioneffect_component.lua', 'utf8'),
}, {
	path: 'cartlib/input/actioneffect/compiler', source: `return {compile_program=function(owner,source,clock)
 owner.compiled_source=source
 owner.compiled_clock=clock
 return {release_binding_count=0,max_custom_count=0,queued_command_capacity=0,
  queued_event_capacity=0,combo_resets={}},false
end}`,
}];

for (const optLevel of [0, 3] as const) {
	test(`input components bind concrete configuration and retain the final owner (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
local input<const> = require('cartlib/input/actioneffect/actioneffect_component')
local clock<const> = require('cartlib/clock')
local original<const>, override<const> = {bindings={}}, {bindings={}}
local definition<const> = {id_local='controls',program=original}
local factory<const> = input.factory(definition)
definition.program=override
prefab.define({def_id='input.default',class={},components={factory}})
prefab.define({def_id='input.override',class={},components={input.factory({id_local='controls',program=override,clock_source=clock.frame})}})
prefab.define({def_id='input.dynamic',class={ctor=function(self)
 self:add_component(input.new(self,{program=override}))
end}})
local a<const> = world:spawn('input.default',{})
local b<const> = world:spawn('input.override',{})
local c<const> = world:spawn('input.dynamic',{})
assert(a.compiled_source==original and a.compiled_clock==clock.gameplay,
 'factory reread mutated configuration or lost its real owner')
assert(b.compiled_source==override and b.compiled_clock==clock.frame,
 'concrete component configuration did not reach activation')
assert(c.compiled_source==override and c.compiled_clock==clock.gameplay,
 'dynamic construction did not use its actual owner and concrete configuration')
assert(a:get_component(input,'controls').owner==a
 and b:get_component(input,'controls').owner==b and c:get_component(input,'input').owner==c,
 'input identity does not belong to the final World object')
world:clear()
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	});
}
