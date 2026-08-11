import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk } from './cpu_test_harness';

const SYSTEM_MODULE_FILES = [
	['base', 'machine/bios/base.lua'],
	['table', 'machine/bios/table.lua'],
	['string/base', 'machine/bios/string/base.lua'],
	['string/pattern', 'machine/bios/string/pattern.lua'],
] as const;

const CART_MODULE_FILES = [
	['cartlib/util/dense_set', 'cartlib/util/dense_set.lua'],
	['cartlib/component/componentclass', 'cartlib/component/componentclass.lua'],
	['cartlib/registry', 'cartlib/registry.lua'],
	['cartlib/eventemitter', 'cartlib/eventemitter.lua'],
	['cartlib/component/basecomponent', 'cartlib/component/basecomponent.lua'],
	['cartlib/clock', 'cartlib/clock.lua'],
	['cartlib/easing', 'cartlib/easing.lua'],
	['cartlib/timeline/scalar_channel', 'cartlib/timeline/scalar_channel.lua'],
	['cartlib/timeline/track_program', 'cartlib/timeline/track_program.lua'],
	['cartlib/timeline/sequence_program', 'cartlib/timeline/sequence_program.lua'],
	['cartlib/timeline/track_evaluator', 'cartlib/timeline/track_evaluator.lua'],
	['cartlib/timeline/program', 'cartlib/timeline/program.lua'],
	['cartlib/timeline/time_transform', 'cartlib/timeline/time_transform.lua'],
	['cartlib/timeline/timeline', 'cartlib/timeline/timeline.lua'],
	['cartlib/timeline/dispatch', 'cartlib/timeline/dispatch.lua'],
	['cartlib/timeline/sequence_evaluator', 'cartlib/timeline/sequence_evaluator.lua'],
	['cartlib/timeline/timeline_component', 'cartlib/timeline/timeline_component.lua'],
	['cartlib/util/clamp', 'cartlib/util/clamp.lua'],
	['cartlib/util/clear_map', 'cartlib/util/clear_map.lua'],
	['cartlib/util/scratch_record_batch', 'cartlib/util/scratch_record_batch.lua'],
	['cartlib/fsm/fsm', 'cartlib/fsm/fsm.lua'],
	['cartlib/fsm/library', 'cartlib/fsm/library.lua'],
	['cartlib/fsm/fsmcomponent', 'cartlib/fsm/fsmcomponent.lua'],
	['cartlib/behaviourtree/bt', 'cartlib/behaviourtree/bt.lua'],
	['cartlib/behaviourtree/btcomponent', 'cartlib/behaviourtree/btcomponent.lua'],
	['cartlib/behaviourtree/library', 'cartlib/behaviourtree/library.lua'],
] as const;

const SYSTEM_STUB_MODULES = [
	{
		path: 'tty/console',
		source: 'return { write = function() end, end_line = function() end }',
	},
] as const;

const CART_STUB_MODULES = [
	{
		path: 'cartlib/input/input',
		source: `return {
			bind = function(_, pattern) return pattern end,
			is_active = function() return false end,
		}`,
	},
	{
		path: 'cartlib/timeline/apply',
		source: `return {
			compile_frames = function() error('unexpected compiled-frame timeline') end,
			compile_setter = function() error('unexpected property track') end,
		}`,
	},
] as const;

const SYSTEM_ENTRY_SOURCE = `
require('base')
table = require('table')
string = require('string/base')
string.find = require('string/pattern').find
math = { sin = function(value) return value end, pi = 3.141592653589793 }
assert(setmetatable ~= nil)
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;

const CART_ENTRY_SOURCE = `
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/eventemitter')
local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/fsmcomponent')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local behaviour_tree<const> = require('cartlib/behaviourtree/bt')
local behaviour_tree_component<const> = require('cartlib/behaviourtree/btcomponent')
local behaviour_tree_library<const> = require('cartlib/behaviourtree/library')

local target<const> = {
	id = 'hot_target',
	active = true,
	tags = {},
	value = 0,
}
function target:add_tag(tag)
	self.tags[tag] = true
end
function target:remove_tag(tag)
	self.tags[tag] = nil
end
target.events = events.events_of(target)
local timelines<const> = timeline_component.new({ parent = target })
timelines.id = 'hot_target_timelines'
timelines:on_attach()
registry:register(timelines)
registry:index(timelines, timeline_component)

fsm_library.register('hot_machine', {
	initial = 'idle',
	states = {
		idle = {
			tags = { 'old_idle' },
			update = function(self)
				self.value = self.value + 1
			end,
			on = { activate = '/active' },
		},
		active = {
			data = { retained = 11 },
			tags = { 'old_active' },
			timelines = {
				hot_timeline = {
					def = {
						frames = function(params)
							return { params.offset, params.offset + 1, params.offset + 2 }
						end,
						frame_duration = 1,
						apply = function(self, value)
							self.timeline_value = 100 + value
						end,
					},
					autoplay = true,
					stop_on_exit = true,
					play_options = { params = { offset = 0 } },
				},
			},
			update = function(self)
				self.value = self.value + 2
			end,
		},
	},
})

local make_fsm<const> = state_machine_component.factory({ 'hot_machine' })
local state_machines<const> = make_fsm({ parent = target })
state_machines.id = 'hot_target_fsm'
state_machines:on_attach()
registry:register(state_machines)
registry:index(state_machines, state_machine_component)
state_machines:start()

local machine<const> = state_machines._machines_by_id.hot_machine
local idle<const> = machine.states.idle
local active<const> = machine.states.active
state_machines:update()
assert(target.value == 1)
target.events:emit('activate')
assert(machine.current_id == 'active')
assert(target.tags.old_active == true)
timelines:tick_active(1)
assert(target.timeline_value == 101)
local timeline_before<const> = timelines:get('hot_timeline')
local timeline_entry_before<const> = timelines._active_entries[1]
local timeline_head_before<const> = timeline_before.head
local timeline_position_before<const> = timeline_before.position_ms

local active_data<const> = active.data
active_data.retained = 73
local history_before<const> = machine:get_history_snapshot()
assert(#history_before == 1 and history_before[1] == 'idle')
local bound_before<const> = state_machines:bind_state_path('/active')

fsm_library.register('hot_machine', {
	initial = 'idle',
	states = {
		idle = {
			tags = { 'new_idle' },
			update = function(self)
				self.value = self.value + 100
			end,
		},
		active = {
			data = { retained = 900 },
			tags = { 'new_active' },
			timelines = {
				hot_timeline = {
					def = {
						frames = function(params)
							return { params.offset + 10, params.offset + 11, params.offset + 12 }
						end,
						frame_duration = 1,
						apply = function(self, value)
							self.timeline_value = 1000 + value
						end,
					},
					autoplay = true,
					stop_on_exit = true,
					play_options = { params = { offset = 100 } },
				},
			},
			update = function(self)
				self.value = self.value + 10
			end,
			on = { deactivate = '/idle', bonus = '/bonus' },
		},
		bonus = {
			update = function(self)
				self.value = self.value + 1000
			end,
			on = { restore = '/active' },
		},
	},
})

assert(state_machines._machines_by_id.hot_machine == machine)
assert(machine.states.idle == idle and machine.states.active == active)
assert(machine.states.bonus ~= nil)
assert(active.data == active_data and active_data.retained == 73)
assert(machine.current_id == 'active')
local history_after<const> = machine:get_history_snapshot()
assert(#history_after == 1 and history_after[1] == 'idle')
assert(target.tags.old_active == nil and target.tags.new_active == true)
assert(timelines:get('hot_timeline') == timeline_before)
assert(timelines._active_entries[1] == timeline_entry_before)
assert(timeline_before.head == timeline_head_before and timeline_before.position_ms == timeline_position_before)
timelines:tick_active(1)
assert(target.timeline_value == 1012)
assert(state_machines._state_paths == nil)
assert(#events.listeners.activate == 0)
assert(#events.listeners.deactivate == 1)
assert(#events.listeners.bonus == 1)
local bound_after<const> = state_machines:bind_state_path('/active')
assert(bound_after ~= bound_before)

state_machines:update()
assert(target.value == 11)
target.events:emit('deactivate')
assert(machine.current_id == 'idle' and target.tags.new_idle == true)
machine:pop_and_transition()
assert(machine.current_id == 'active')
state_machines:update()
assert(target.value == 21)
target.events:emit('bonus')
assert(machine.current_id == 'bonus')
state_machines:update()
assert(target.value == 1021)
target.events:emit('restore')
assert(machine.current_id == 'active')

local published_definition<const> = machine.definition
local concurrent_compatible<const> = pcall(function()
	fsm_library.register('hot_machine', {
		initial = 'idle',
		states = {
			idle = {},
			active = {},
			bonus = {},
			parallel = { is_concurrent = true },
		},
	})
end)
assert(concurrent_compatible == false)
assert(machine.definition == published_definition)
local compatible<const> = pcall(function()
	fsm_library.register('hot_machine', {
		initial = 'idle',
		states = {
			idle = {},
			active = {},
		},
	})
end)
assert(compatible == false)
assert(machine.definition == published_definition)
local future_state_machines<const> = make_fsm({ parent = target })
assert(future_state_machines._machines_by_id.hot_machine.definition == published_definition)

local old_root<const> = behaviour_tree.action_node.new('enemy_hot', function(_, blackboard)
	blackboard.node_data.ticks = (blackboard.node_data.ticks or 0) + 1
	return 'SUCCESS'
end)
behaviour_tree_library.register(old_root)
local make_old_tree<const> = behaviour_tree_component.factory(old_root.id)
local behaviour_tree_instance<const> = make_old_tree({ parent = target })
behaviour_tree_instance.id = 'hot_target_bt'
registry:register(behaviour_tree_instance)
registry:index(behaviour_tree_instance, behaviour_tree_component)
behaviour_tree_instance.root:tick(target, behaviour_tree_instance)
local node_data<const> = behaviour_tree_instance.node_data
node_data.retained = 91

local new_root<const> = behaviour_tree.action_node.new('enemy_hot', function(_, blackboard)
	blackboard.node_data.ticks = blackboard.node_data.ticks + 10
	return 'SUCCESS'
end)
behaviour_tree_library.register(new_root)
assert(behaviour_tree_instance.root == new_root)
assert(behaviour_tree_instance.node_data == node_data and node_data.retained == 91)
behaviour_tree_instance.root:tick(target, behaviour_tree_instance)
local future_tree<const> = make_old_tree({ parent = target })
assert(future_tree.root == new_root)

return target.value, active_data.retained, node_data.ticks, node_data.retained,
	machine.current_id == 'active', target.tags.new_active, target.tags.old_active
`;

test('cartlib FSM and behaviour-tree instances rebind compiled definitions without resetting runtime state', () => {
	const systemModules = SYSTEM_MODULE_FILES.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
	for (const module of SYSTEM_STUB_MODULES) {
		systemModules.push({
			path: module.path,
			chunk: parseLuaChunk(module.source, `${module.path}.lua`),
			source: module.source,
		});
	}
	const cartModules = CART_MODULE_FILES.map(([path, file]) => {
		const source = readFileSync(file, 'utf8');
		return { path, chunk: parseLuaChunk(source, `${path}.lua`), source };
	});
	for (const module of CART_STUB_MODULES) {
		cartModules.push({
			path: module.path,
			chunk: parseLuaChunk(module.source, `${module.path}.lua`),
			source: module.source,
		});
	}
	const systemCompiled = compileLuaChunkToProgram(parseLuaChunk(SYSTEM_ENTRY_SOURCE, 'boot.lua'), systemModules, {
		entrySource: SYSTEM_ENTRY_SOURCE,
		optLevel: 3,
		programDomain: 'system',
	});
	const cartCompiled = compileLuaChunkToProgram(parseLuaChunk(CART_ENTRY_SOURCE, 'entry.lua'), cartModules, {
		entrySource: CART_ENTRY_SOURCE,
		optLevel: 3,
		programDomain: 'cart',
	});
	const images = linkTestBlua32Pair(systemCompiled, cartCompiled);
	const cpu: CPU = createTestBlua32PairCpu(images).cpu;
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [
		1021,
		73,
		11,
		91,
		true,
		true,
		null,
	]);
});
