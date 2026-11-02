import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';

// These are real cartlib registrations, not a host-side model of a registry.
// An entry into register is not evidence that its definition wins: a nested
// registration may succeed before the outer compilation fails.
for (const optLevel of [0, 3] as const) test(`Scene registration reflects successful writes in execution order (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(WORLD_CPU_SETUP + `
prefab.define({def_id='fixture.actor', class=object_2d})
local first<const> = {objects={{member_id='first', definition_id='fixture.actor'}}}
local second<const> = {objects={{member_id='second', definition_id='fixture.actor'}}}
scenes.register('fixture', first)
local original<const> = scenes.instantiate('fixture')
scenes.register('fixture', second)
local replacement<const> = scenes.instantiate('fixture')
assert(original.members.first ~= nil and original.members.second == nil)
assert(replacement.members.second ~= nil and replacement.members.first == nil)

local nested<const> = {objects={{member_id='nested', definition_id='fixture.actor'}}}
local rejecting<const> = { _compile_pose = function(member, definition, source)
  if definition ~= nil then
    scenes.register('fixture', nested)
    return false
  end
  return true
end }
prefab.define({def_id='fixture.rejecting', class=rejecting})
local ok<const> = pcall(scenes.register, 'fixture',
  {objects={{member_id='failed', definition_id='fixture.rejecting'}}})
assert(not ok)
local current<const> = scenes.instantiate('fixture')
assert(current.members.nested ~= nil and current.members.failed == nil)
assert(original.members.first ~= nil and replacement.members.second ~= nil)

local accepting<const> = { _compile_pose = function(member, definition, source)
  if definition ~= nil then scenes.register('fixture', nested) end
  return true
end }
prefab.define({def_id='fixture.accepting', class=accepting})
scenes.register('fixture', {objects={{member_id='outer', definition_id='fixture.accepting'}}})
assert(scenes.definition('fixture').objects[1].member_id == 'outer')
assert(current.members.nested ~= nil)
fixture_passed = true
`, { optLevel, modules: WORLD_CPU_MODULES });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('fixture_passed')!), true);
});
