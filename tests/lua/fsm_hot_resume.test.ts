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
	['cartlib/registry', 'cartlib/registry.lua'],
	['cartlib/eventemitter', 'cartlib/eventemitter.lua'],
	['cartlib/world/component', 'cartlib/world/component.lua'],
	['cartlib/clock', 'cartlib/clock.lua'],
	['cartlib/timeline/timeline', 'cartlib/timeline/timeline.lua'],
	['cartlib/timeline/dispatch', 'cartlib/timeline/dispatch.lua'],
	['cartlib/timeline/component', 'cartlib/timeline/component.lua'],
	['cartlib/util/clamp', 'cartlib/util/clamp.lua'],
	['cartlib/util/clear_map', 'cartlib/util/clear_map.lua'],
	['cartlib/util/scratchrecordbatch', 'cartlib/util/scratchrecordbatch.lua'],
	['cartlib/fsm/fsm', 'cartlib/fsm/fsm.lua'],
	['cartlib/fsm/library', 'cartlib/fsm/library.lua'],
	['cartlib/fsm/component', 'cartlib/fsm/component.lua'],
	['cartlib/behaviourtree', 'cartlib/behaviourtree.lua'],
	['cartlib/behaviourtree/component', 'cartlib/behaviourtree/component.lua'],
] as const;

const SYSTEM_STUB_MODULES = [
	{
		path: 'tty/console',
		source: 'return { write = function() end, end_line = function() end }',
	},
] as const;

const CART_STUB_MODULES = [
	{
		path: 'cartlib/input/player',
		source: `return {
			bind = function(_, pattern) return pattern end,
			is_active = function() return false end,
		}`,
	},
	{
		path: 'cartlib/timeline/apply',
		source: `return {
			compile_frames = function() error('unexpected compiled-frame timeline') end,
			compile_tracks = function() error('unexpected track timeline') end,
		}`,
	},
] as const;

const SYSTEM_ENTRY_SOURCE = `
require('base')
table = require('table')
string = require('string/base')
string.find = require('string/pattern').find
assert(setmetatable ~= nil)
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;

const CART_ENTRY_SOURCE = `
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/eventemitter')
local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/component')
local timelinecomponent<const> = require('cartlib/timeline/component')
local behaviourtree<const> = require('cartlib/behaviourtree')
local behaviourtreecomponent<const> = require('cartlib/behaviourtree/component')

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
local timelines<const> = timelinecomponent.new({ parent = target })
timelines.id = 'hot_target_timelines'
timelines:on_attach()
registry:register(timelines)

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
						ticks_per_frame = 1,
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
local timeline_entry_before<const> = timelines.active_entries[1]
local timeline_head_before<const> = timeline_before.head
local timeline_time_before<const> = timeline_before.time_ms

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
						ticks_per_frame = 1,
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
assert(timelines.active_entries[1] == timeline_entry_before)
assert(timeline_before.head == timeline_head_before and timeline_before.time_ms == timeline_time_before)
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

local published_definition<const> = fsm_library.get('hot_machine')
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
assert(fsm_library.get('hot_machine') == published_definition)
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
assert(fsm_library.get('hot_machine') == published_definition)
assert(machine.definition == published_definition)

local old_root<const> = behaviourtree.action.new('enemy_hot', function(_, blackboard)
	blackboard.nodedata.ticks = (blackboard.nodedata.ticks or 0) + 1
	return 'SUCCESS'
end)
local make_old_tree<const> = behaviourtreecomponent.factory(old_root)
local behaviour_tree<const> = make_old_tree({ parent = target })
behaviour_tree.id = 'hot_target_bt'
registry:register(behaviour_tree)
behaviour_tree.root:tick(target, behaviour_tree)
local node_data<const> = behaviour_tree.nodedata
node_data.retained = 91

local new_root<const> = behaviourtree.action.new('enemy_hot', function(_, blackboard)
	blackboard.nodedata.ticks = blackboard.nodedata.ticks + 10
	return 'SUCCESS'
end)
local make_new_tree<const> = behaviourtreecomponent.factory(new_root)
assert(behaviour_tree.root == new_root)
assert(behaviour_tree.nodedata == node_data and node_data.retained == 91)
behaviour_tree.root:tick(target, behaviour_tree)
local future_tree<const> = make_new_tree({ parent = target })
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
