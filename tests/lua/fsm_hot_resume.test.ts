import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { Table } from '../../machine/ts/machine/cpu/table';
import {
	asStringId,
	type StringValue,
} from '../../machine/ts/machine/cpu/value';
import { materializeCpuCompletionValues, runCompletionClosure } from './cpu_test_harness';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { FSM_PATH_CASES, FSM_SCOPE_SOURCE } from '../helpers/fsm_source_fixture';
import { BT_MEMBERSHIP_SOURCE } from '../helpers/behavior_membership_fixture';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldMoveEdits } from '../../ide/language/lua/table_field_moves';
import { duplicateBehaviorTreeChild, removeBehaviorTreeChild } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { BehaviorTreeTransferAnalysis } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_transfer';
import { FSM_INITIAL_SOURCE } from '../helpers/fsm_initial_fixture';
import { indexStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_index';
import { setStateMachineInitial } from '../../ide/workbench/contrib/behavior_lens/state_machine_initial';
import { FSM_RETARGET_EXECUTION_SOURCE, FSM_RETARGET_PATH_CASES, FSM_RETARGET_PATH_SOURCE } from '../helpers/fsm_retarget_fixture';
import { StateMachineRetargetAnalysis } from '../../ide/workbench/contrib/behavior_lens/state_machine_retarget';
import { quoteLuaString } from '../../toolchain/ts/lua/syntax/string_literal';
import { createLuaStringValueEdit } from '../../ide/language/lua/source_edits';

const CART_ENTRY_SOURCE = `
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/event_emitter')
local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/fsm_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local behaviour_tree_component<const> = require('cartlib/behaviour_tree/bt_component')
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')

local target<const> = {
	id = 'hot_target',
	active = true,
	tags = {},
	value = 0,
}
function target:_retain_tag(tag)
	self.tags[tag] = true
end
function target:_release_tag(tag)
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
					on_finished = function(self)
						self.timeline_finished = (self.timeline_finished or 0) + 1
					end,
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

local machine<const> = state_machines:get_machine('hot_machine')
local idle<const> = machine.states.idle
local active<const> = machine.states.active
state_machines.update_gameplay()
assert(target.value == 1)
target.events:emit('activate')
assert(machine.current_id == 'active')
assert(target.tags.old_active == true)
timelines:tick_gameplay(1)
assert(target.timeline_value == 101)
local timeline_before<const> = timelines:get('hot_timeline')
local timeline_entry_before<const> = timelines._gameplay_tick_lane[1]
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
					on_finished = function(self)
						self.timeline_finished = (self.timeline_finished or 0) + 10
					end,
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

assert(state_machines:get_machine('hot_machine') == machine)
assert(machine.states.idle == idle and machine.states.active == active)
assert(machine.states.bonus ~= nil)
assert(active.data == active_data and active_data.retained == 73)
assert(machine.current_id == 'active')
local history_after<const> = machine:get_history_snapshot()
assert(#history_after == 1 and history_after[1] == 'idle')
assert(target.tags.old_active == nil and target.tags.new_active == true)
assert(timelines:get('hot_timeline') == timeline_before)
assert(timelines._gameplay_tick_lane[1] == timeline_entry_before)
assert(timeline_before.head == timeline_head_before and timeline_before.position_ms == timeline_position_before)
timelines:tick_gameplay(1)
assert(target.timeline_value == 1012)
timelines:tick_gameplay(1)
assert(target.timeline_finished == 10)
assert(state_machines._state_paths == nil)
local bound_after<const> = state_machines:bind_state_path('/active')
assert(bound_after ~= bound_before)

state_machines.update_gameplay()
assert(target.value == 11)
target.events:emit('deactivate')
assert(machine.current_id == 'idle' and target.tags.new_idle == true)
machine:pop_and_transition()
assert(machine.current_id == 'active')
state_machines.update_gameplay()
assert(target.value == 21)
target.events:emit('bonus')
assert(machine.current_id == 'bonus')
state_machines.update_gameplay()
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
assert(future_state_machines:get_machine('hot_machine').definition == published_definition)

local ticks_key<const> = blackboard.key('ticks', 0)
local retained_key<const> = blackboard.key('retained', 0)
local old_action<const> = function(_, execution)
	local active_blackboard<const> = execution.blackboard
	active_blackboard:set(ticks_key, active_blackboard:get(ticks_key) + 1)
	return 'SUCCESS'
end
local old_task<const> = {
	execute = old_action,
}
behaviour_tree_library.register('enemy_hot', {
	blackboard = {
		ticks_key,
		retained_key,
	},
	root = {
		type = 'task',
		task = old_task,
	},
})
local make_old_tree<const> = behaviour_tree_component.factory('enemy_hot')
local behaviour_tree_instance<const> = make_old_tree({ parent = target })
behaviour_tree_instance.id = 'hot_target_bt'
registry:register(behaviour_tree_instance)
registry:index(behaviour_tree_instance, behaviour_tree_component)
behaviour_tree_instance.evaluate(target, behaviour_tree_instance, behaviour_tree_instance.operand)
local blackboard_instance<const> = behaviour_tree_instance.blackboard
blackboard_instance:set(retained_key, 91)

local new_action<const> = function(_, execution)
	local active_blackboard<const> = execution.blackboard
	active_blackboard:set(ticks_key, active_blackboard:get(ticks_key) + 10)
	return 'SUCCESS'
end
local new_task<const> = {
	execute = new_action,
}
behaviour_tree_library.register('enemy_hot', {
	blackboard = {
		retained_key,
		ticks_key,
	},
	root = {
		type = 'task',
		task = new_task,
	},
})
assert(behaviour_tree_instance.evaluate == new_action)
assert(behaviour_tree_instance.blackboard == blackboard_instance and blackboard_instance:get(retained_key) == 91)
behaviour_tree_instance.evaluate(target, behaviour_tree_instance, behaviour_tree_instance.operand)
local future_tree<const> = make_old_tree({ parent = target })
assert(future_tree.evaluate == new_action)

return target.value, active_data.retained, blackboard_instance:get(ticks_key), blackboard_instance:get(retained_key),
	machine.current_id == 'active', target.tags.new_active, target.tags.old_active
`;

const TRANSITION_RECORDER_ENTRY_SOURCE = `
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local transition_recorder<const> = require('testlib/fsm/transition_recorder')

local target<const> = {
	id = 'trace_target',
	active = true,
	tags = {},
	allow_active = false,
}
function target:_retain_tag(tag)
	self.tags[tag] = true
end
function target:_release_tag(tag)
	self.tags[tag] = nil
end

fsm_library.register('trace_machine', {
	initial = 'idle',
	states = {
		idle = {},
		active = {
			transition_guards = {
				can_enter = function(self)
					return self.allow_active
				end,
			},
			entering_state = function()
				return '/done'
			end,
		},
		done = {},
	},
})

local state_machines<const> = fsm_component.new({ parent = target }, { 'trace_machine' })
local machine<const> = state_machines:get_machine('trace_machine')
state_machines:start()
local recorder<const> = transition_recorder.new(machine, 4)

assert(machine:transition_to_state('active') == false)
target.allow_active = true
assert(machine:transition_to_state('active') == true)
assert(machine.current_id == 'done')

local run<const> = function(count)
	for _ = 1, count do
		if machine.current_id == 'idle' then
			machine:transition_to_state('done')
		else
			machine:transition_to_state('idle')
		end
	end
end

local detach<const> = function()
	recorder:dispose()
end

return run, detach, recorder
`;

for (const optLevel of [0, 3] as const) test(`BT empty/single-child lowering preserves optional reset through component rebind (O${optLevel})`, () => {
	const { cpu } = createCartlibProgramHarness(`
local compiler<const> = require('cartlib/behaviour_tree/program')
local library<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local registry<const> = require('cartlib/registry')
local result<const> = require('cartlib/behaviour_tree/result')
local aborts = 0
local callback<const> = function() return result.running end
for _, kind in ipairs({ 'sequence', 'selector' }) do
	local empty<const> = compiler.compile(kind, { root = { type = kind, children = {} } })
	assert(empty.reset == nil and empty.create_execution_state() == nil)
	assert(empty.evaluate() == (kind == 'sequence' and result.success or result.failure))
	local definition<const> = { root = { type = kind, children = {
		{ type = kind, children = { { type = 'task', task = { execute = callback } } } },
	} } }
	local program<const> = compiler.compile(kind, definition)
	assert(program.evaluate == callback and program.reset == nil and program.create_execution_state() == nil)
	library.register(kind, definition)
	local instance<const> = component.new({ parent = {} }, kind)
	instance.id = kind
	registry:register(instance)
	registry:index(instance, component)
	instance:stop()
	instance:start()
	library.register(kind, definition)
	assert(instance.evaluate == callback and instance.reset == nil)
	local stateful<const> = { root = { type = kind, children = {
		{ type = 'task', task = { tick = callback, abort = function() aborts = aborts + 1 end } },
	} } }
	library.register(kind, stateful)
	instance.evaluate(instance.parent, instance, instance.operand)
	library.register(kind, definition)
	assert(instance.reset == nil)
end
return aborts
`, { optLevel });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [2]);
});

test('BT source membership fixture executes its opaque builders and ordered children only in compiled cartlib', () => {
	const { cpu } = createCartlibProgramHarness(BT_MEMBERSHIP_SOURCE + `
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = sequence })
local target<const> = { order = 0 }
local execution<const> = { _execution_state = program.create_execution_state() }
assert(#sequence_children == 4, 'BLua table fields consume one result, including a last builder call')
assert(sequence_children[3] == nested and #nested.children == 1, 'nested builder owns its own child list')
local status<const> = program.evaluate(target, execution, program.operand)
return status == result.success, target.order
`);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, 1212]);
});

test('source-owned BT moves change actual compiled task order and keep choice weights attached to their children', () => {
	for (const [destination, expected] of [[0, 1213], [3, 1312]] as const) {
		const resource = { domain: 0 as const, path: 'order.lua', source: { type: 'lua' as const, resid: 'order' } };
		const model = new EditorTextModel(resource, 'lua', BT_ORDER_SOURCE);
		const definition = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path))).definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const branch = definition.root.branches[0];
		assert.ok(branch.role === 'children' && branch.source.kind === 'section');
		model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, resource.path, branch.source.table, 2, destination));
		const { cpu } = createCartlibProgramHarness(model.buffer.getText() + `
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = root })
local target<const> = { order = 0 }
local execution<const> = { _execution_state = program.create_execution_state() }
local status<const> = program.evaluate(target, execution, program.operand)
return status == result.success, target.order, #children, children.note == 'metadata is not a child'
`);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [true, expected, 3, true]);
		model.undo();
		assert.equal(model.buffer.getText(), BT_ORDER_SOURCE);
		const weighted = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path))).definitions[2];
		assert.ok(weighted.behaviorKind === 'behavior_tree' && weighted.root?.kind === 'node');
		const choices = weighted.root.branches[0];
		assert.ok(choices.role === 'choices' && choices.source.kind === 'section');
		model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, resource.path, choices.source.table, 2, destination));
		const { cpu: choiceCpu } = createCartlibProgramHarness(model.buffer.getText() + `
local target<const> = { order = 0 }
for index = 1, #weighted.choices do
	local choice<const> = weighted.choices[index]
	local program<const> = require('cartlib/behaviour_tree/program').compile('choice', { root = choice.child })
	program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand)
end
return target.order, weighted.choices[${destination === 0 ? 1 : 3}].weight, weighted.choices.note == 'metadata is not a choice'
`);
		assert.equal(choiceCpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(choiceCpu), [expected, 9, true]);
	}
});

test('BT source removal changes actual compiled task order without deleting referenced definitions or choice weights', () => {
	const resource = { domain: 0 as const, path: 'remove.lua', source: { type: 'lua' as const, resid: 'remove' } };
	for (const [definitionIndex, index, expected] of [[0, 0, 123], [0, 1, 13], [0, 2, 112], [2, 1, 13]] as const) {
		const model = new EditorTextModel(resource, 'lua', BT_ORDER_SOURCE);
		const definition = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path))).definitions[definitionIndex];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const branch = definition.root.branches[0];
		assert.ok((branch.role === 'children' || branch.role === 'choices') && branch.source.kind === 'section');
		removeBehaviorTreeChild(model, { table: branch.source.table, branch, index });
		const execution = definitionIndex === 0 ? `
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = root })
assert(program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand) == result.success)
assert(#children == 2 and children.note == 'metadata is not a child')
` : `
assert(#weighted.choices == 2 and weighted.choices[1].weight == 1 and weighted.choices[2].weight == 3)
assert(weighted.choices.note == 'metadata is not a choice')
for index = 1, #weighted.choices do
	local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = weighted.choices[index].child })
	assert(program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand) == result.success)
end
`;
		const { cpu } = createCartlibProgramHarness(model.buffer.getText() + `
local target<const> = { order = 0 }
${execution}
return target.order, #nested.children, nested.children[1] == leaf
`);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [expected, 2, true]);
		model.undo();
		assert.equal(model.buffer.getText(), BT_ORDER_SOURCE);
	}
});

test('BT source duplication executes the copied Lua uses and keeps choice weights, rather than cloning runtime nodes', () => {
	const resource = { domain: 0 as const, path: 'duplicate.lua', source: { type: 'lua' as const, resid: 'duplicate' } };
	for (const [definitionIndex, index, expected, sameValue] of [[0, 0, 11123, true], [0, 1, 112123, true], [0, 2, 11233, false], [2, 1, 112123, false]] as const) {
		const model = new EditorTextModel(resource, 'lua', BT_ORDER_SOURCE);
		const definition = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path))).definitions[definitionIndex];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const branch = definition.root.branches[0];
		assert.ok((branch.role === 'children' || branch.role === 'choices') && branch.source.kind === 'section');
		duplicateBehaviorTreeChild(model, { table: branch.source.table, branch, index });
		const execution = definitionIndex === 0 ? `
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = root })
assert(program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand) == result.success)
assert(#children == 4 and children.note == 'metadata is not a child')
local same_value<const> = children[${index + 1}] == children[${index + 2}]
` : `
assert(#weighted.choices == 4 and weighted.choices[1].weight == 1 and weighted.choices[2].weight == 9
	and weighted.choices[3].weight == 9 and weighted.choices[4].weight == 3)
assert(weighted.choices.note == 'metadata is not a choice')
assert(weighted.choices[2].child == nested and weighted.choices[3].child == nested)
for index = 1, #weighted.choices do
	local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = weighted.choices[index].child })
	assert(program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand) == result.success)
end
local same_value<const> = weighted.choices[2] == weighted.choices[3]
`;
		const { cpu } = createCartlibProgramHarness(model.buffer.getText() + `
local target<const> = { order = 0 }
${execution}
return target.order, #nested.children, same_value
`);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [expected, 2, sameValue]);
		model.undo();
		assert.equal(model.buffer.getText(), BT_ORDER_SOURCE);
	}
});

test('language-owned field transfer changes actual compiled BT composition without a host graph or runtime clone', () => {
	const resource = { domain: 0 as const, path: 'transfer.lua', source: { type: 'lua' as const, resid: 'transfer' } };
	for (const inward of [false, true]) {
		const model = new EditorTextModel(resource, 'lua', BT_ORDER_SOURCE);
		const definition = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path))).definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const outer = definition.root.branches[0];
		assert.ok(outer.role === 'children' && outer.source.kind === 'section');
		const node = outer.entries[1].node;
		assert.ok(node.kind === 'node');
		const inner = node.branches[0];
		assert.ok(inner.role === 'children' && inner.source.kind === 'section');
		const transfer = inward
			? createLuaTableFieldTransfer(model.buffer, resource.path, outer.entries[2].field, inner.source.table, 0)
			: createLuaTableFieldTransfer(model.buffer, resource.path, inner.entries[1].field, outer.source.table, outer.source.table.fields.length);
		model.pushEditOperations(transfer.edits);
		const { cpu } = createCartlibProgramHarness(model.buffer.getText() + `
local target<const> = { order = 0 }
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', { root = root })
assert(program.evaluate(target, { _execution_state = program.create_execution_state() }, program.operand) == result.success)
assert(children.note == 'metadata is not a child')
return target.order, #children, #nested.children
`);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), inward ? [1312, 2, 3] : [1132, 4, 1]);
		model.undo();
		assert.equal(model.buffer.getText(), BT_ORDER_SOURCE);
	}
});

test('admitted BT transfers compile with actual source sharing and cartlib task order', () => {
	const resource = { domain: 0 as const, path: 'admitted.lua', source: { type: 'lua' as const, resid: 'admitted' } };
	for (const inward of [false, true]) {
		const model = new EditorTextModel(resource, 'lua', BT_ORDER_SOURCE);
		const semantic = buildLuaFileSemanticData(BT_ORDER_SOURCE, resource.path);
		const document = buildBehaviorSourceDocument(resource, semanticSnapshot(semantic));
		const definition = document.definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const outer = definition.root.branches[0];
		assert.ok(outer.role === 'children' && outer.source.kind === 'section');
		const nested = outer.entries[1].node;
		assert.ok(nested.kind === 'node');
		const inner = nested.branches[0];
		assert.ok(inner.role === 'children' && inner.source.kind === 'section');
		const origin = inward ? outer : inner;
		const target = inward ? inner : outer;
		assert.ok(origin.source.kind === 'section' && target.source.kind === 'section');
		const member = { table: origin.source.table, branch: origin, index: 0 };
		const admission = new BehaviorTreeTransferAnalysis(document, semantic, member);
		assert.equal(admission.checkTarget(target).kind, 'available');
		model.pushEditOperations(createLuaTableFieldTransfer(model.buffer, resource.path, origin.entries[0].field,
			target.source.table, target.source.table.fields.length).edits);
		const { cpu } = createCartlibProgramHarness(model.buffer.getText() + `
local target<const> = {order=0}
local program<const> = require('cartlib/behaviour_tree/program').compile('oracle', {root=root})
assert(program.evaluate(target, {_execution_state=program.create_execution_state()}, program.operand) == result.success)
return target.order, #children, #nested.children, children.note == 'metadata is not a child'
`);
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), inward ? [1213, 2, 3, true] : [1231, 4, 1, true]);
		model.undo();
		assert.equal(model.buffer.getText(), BT_ORDER_SOURCE);
		model.dispose();
	}
});

test('cartlib FSM and behaviour-tree instances retain semantic state across program replacement', () => {
	const { cpu } = createCartlibProgramHarness(CART_ENTRY_SOURCE);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
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

test('visual initial edits rebind real cartlib definitions without forcing the living machine to restart', () => {
	const resource = { domain: 0 as const, path: 'initial.lua', source: { type: 'lua' as const, resid: 'initial' } };
	const model = new EditorTextModel(resource, 'lua', FSM_INITIAL_SOURCE);
	const document = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(FSM_INITIAL_SOURCE, resource.path)));
	const target = [...indexStateMachineSource(document).initialTargets.values()].find(target => target.name === 'active')!;
	setStateMachineInitial(model, target);
	const { cpu } = createCartlibProgramHarness(`
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/event_emitter')
local component<const> = require('cartlib/fsm/fsm_component')
local target<const> = {id='initial-test', active=true, tags={}}
function target:_retain_tag(tag) self.tags[tag]=true end
function target:_release_tag(tag) self.tags[tag]=nil end
target.events = events.events_of(target)
do ${FSM_INITIAL_SOURCE} end
local machines<const> = component.factory({'fixture.initial'})({parent=target})
machines.id='initial-test-fsm'
machines:on_attach()
registry:register(machines)
registry:index(machines, component)
machines:start()
local machine<const> = machines:get_machine('fixture.initial')
local left<const> = machine.states.left
local idle<const> = left.current_state
idle.data.retained=73
assert(machine.current_id=='left' and left.current_id=='idle')
do ${model.buffer.getText()} end
assert(machines:get_machine('fixture.initial')==machine and machine.states.left==left and left.current_state==idle)
assert(left.current_id=='idle' and idle.data.retained==73)
assert(left.definition.initial=='active' and machine.states.right.definition.initial=='active')
machine:reset()
machine:start()
return machine.current_id=='left', left.current_id=='active', machine.states.right.current_id=='active', left.current_state==left.states.active
`);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true, true, true]);
	model.undo(); assert.equal(model.buffer.getText(), FSM_INITIAL_SOURCE);
	model.dispose();
});

test('cold BT channel selection leaves actual FSM transition work identical to erased traces', t => {
	const measurements: { mode: string; cycles: number }[] = [];
	for (const mode of ['erase', 'compile-only', 'emit'] as const) {
		const { cpu } = createCartlibProgramHarness(TRANSITION_RECORDER_ENTRY_SOURCE, {
			traceStatements: mode === 'compile-only'
				? ['bt.compile.begin', 'bt.compile.node', 'bt.compile.end'] : mode,
		});
		assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
		const [run, , recorder] = materializeCpuCompletionValues(cpu) as [Closure, Closure, Table];
		runCompletionClosure(cpu, run, [20]);
		const warmBytes = cpu.luaHeap.usedBytes();
		const cycles = runCompletionClosure(cpu, run, [10_000]);
		assert.equal(cpu.luaHeap.usedBytes(), warmBytes);
		assert.equal(recorder.getInteger(4), mode === 'emit' ? 10_023 : 0);
		measurements.push({ mode, cycles });
	}
	assert.equal(measurements[1].cycles, measurements[0].cycles);
	assert.ok(measurements[2].cycles > measurements[0].cycles);
	for (const row of measurements) t.diagnostic(JSON.stringify(row));
});

test('FSM transition recorder publishes ordered fixed-capacity facts without steady-state allocation', () => {
	const { cpu } = createCartlibProgramHarness(TRANSITION_RECORDER_ENTRY_SOURCE, { traceStatements: 'emit' });
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	const [run, detach, channel] = materializeCpuCompletionValues(cpu) as [
		Closure,
		Closure,
		Table,
	];
	const records = channel.getInteger(5) as Table;
	const strings = cpu.stringPool;
	const text = (value: StringValue): string => strings.toString(asStringId(value));

	assert.equal(text(channel.getInteger(1) as StringValue), 'trace_target.trace_machine');
	assert.equal(text(channel.getInteger(2) as StringValue), 'trace_machine');
	assert.equal(channel.getInteger(3), 4);
	assert.equal(channel.getInteger(4), 3);
	const rejected = records.getInteger(1) as Table;
	const committed = records.getInteger(2) as Table;
	const nested = records.getInteger(3) as Table;
	assert.equal(rejected.getInteger(1), 1);
	assert.equal(rejected.getInteger(6), false);
	assert.equal(text(rejected.getInteger(3) as StringValue), 'trace_machine');
	assert.equal(text(rejected.getInteger(4) as StringValue), 'trace_machine:/idle');
	assert.equal(text(rejected.getInteger(5) as StringValue), 'trace_machine:/active');
	assert.equal(committed.getInteger(1), 2);
	assert.equal(committed.getInteger(6), true);
	assert.equal(nested.getInteger(1), 3);
	assert.equal(text(nested.getInteger(4) as StringValue), 'trace_machine:/active');
	assert.equal(text(nested.getInteger(5) as StringValue), 'trace_machine:/done');

	runCompletionClosure(cpu, run, [20]);
	const heapBefore = cpu.collectTrackedHeapBytes();
	const recordedCycles = runCompletionClosure(cpu, run, [10_000]);
	assert.equal(cpu.collectTrackedHeapBytes(), heapBefore);
	assert.equal(channel.getInteger(4), 10_023);
	for (let sequence = 10_020; sequence <= 10_023; sequence += 1) {
		const slot = ((sequence - 1) % 4) + 1;
		const record = records.getInteger(slot) as Table;
		assert.equal(record.getInteger(1), sequence);
	}

	runCompletionClosure(cpu, detach, []);
	const unselectedCycles = runCompletionClosure(cpu, run, [10_000]);
	assert.ok(unselectedCycles <= 1_900_000, `unselected trace used ${unselectedCycles} cycles`);
	const recorderCycles = recordedCycles - unselectedCycles;
	assert.ok(recorderCycles > 0);
	assert.ok(recorderCycles <= 400_000, `recorder used ${recorderCycles} cycles`);
});


test('FSM source path fixture agrees with real compiled cartlib plans, not a mock resolver', () => {
	const checks = FSM_PATH_CASES.map((entry, index) => {
		const origin = 'definition' + entry.origin.map(key => `.states[ [==[${key}]==] ]`).join('');
		const steps = entry.steps.map(([key, concurrent], step) => `
		assert(plan[${step * 2 + 1}] == [==[${key}]==], 'key ${index}:${step}')
		assert((not not plan[${step * 2 + 2}]) == ${concurrent}, 'lane ${index}:${step}')`).join('');
		return `do
		local plan<const> = fsm.bind_state_path(${origin}, [==[${entry.path}]==])
		assert(plan.abs == ${entry.absolute}, 'absolute ${index}')
		assert(plan.up == ${entry.up}, 'up ${index}')
		assert(plan.count == ${entry.steps.length}, 'count ${index}')${steps}
	end`;
	}).join('\n');
	const { cpu } = createCartlibProgramHarness(FSM_SCOPE_SOURCE + `
local fsm<const> = require('cartlib/fsm/fsm')
local definition<const> = fsm.state_definition.new('fixture.paths', blueprint)
${checks}
return ${FSM_PATH_CASES.length}
`);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [FSM_PATH_CASES.length]);
});

test('retarget descriptors compile to the exact cartlib anchor and guarded/concurrent step plan', () => {
	const resource = { domain: 0 as const, path: 'retarget.lua' };
	const document = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(FSM_RETARGET_PATH_SOURCE, resource.path)));
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	const checks = FSM_RETARGET_PATH_CASES.map((entry, index) => {
		let origin = definition.scopes[0];
		for (const key of entry.origin) origin = origin.children.get(key)!;
		let target = definition.scopes[0];
		for (const key of entry.target) target = target.children.get(key)!;
		const transition = definition.transitions.find(item => item.origin === origin && item.slot.source.label === entry.event)!;
		const check = new StateMachineRetargetAnalysis(document, transition, transition.outcomes[0]).checkTarget(target);
		assert.ok(check.kind === 'available');
		const luaOrigin = 'definition' + entry.origin.map(key => `.states[${quoteLuaString(key)}]`).join('');
		const steps = entry.steps.map(([key, concurrent], step) => `
		assert(plan[${step * 2 + 1}] == ${quoteLuaString(key)}, 'key ${index}:${step}')
		assert((not not plan[${step * 2 + 2}]) == ${concurrent}, 'lane ${index}:${step}')`).join('');
		return `do
		local plan<const> = fsm.bind_state_path(${luaOrigin}, ${quoteLuaString(check.text)})
		assert(plan.abs == ${entry.absolute}, 'absolute ${index}')
		assert(plan.up == ${entry.up}, 'up ${index}')
		assert(plan.count == ${entry.steps.length}, 'count ${index}')${steps}
	end`;
	}).join('\n');
	const { cpu } = createCartlibProgramHarness(FSM_RETARGET_PATH_SOURCE + `
local fsm<const> = require('cartlib/fsm/fsm')
local definition<const> = fsm.state_definition.new('retarget.oracle', blueprint)
${checks}
return ${FSM_RETARGET_PATH_CASES.length}
`);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [FSM_RETARGET_PATH_CASES.length]);
});

test('a retargeted callback preserves live rebind identity, dispatch effects, guards and exit/entry ordering', () => {
	const resource = { domain: 0 as const, path: 'execution.lua', source: { type: 'lua' as const, resid: 'execution' } };
	const model = new EditorTextModel(resource, 'lua', FSM_RETARGET_EXECUTION_SOURCE);
	const document = buildBehaviorSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(FSM_RETARGET_EXECUTION_SOURCE, resource.path)));
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	const transition = definition.transitions[0];
	const check = new StateMachineRetargetAnalysis(document, transition, transition.outcomes[0])
		.checkTarget(definition.scopes[0].children.get('other')!);
	assert.ok(check.kind === 'available');
	model.pushEditOperations([createLuaStringValueEdit(model.buffer, check.literal, check.text)]);
	assert.equal(model.buffer.getText(), FSM_RETARGET_EXECUTION_SOURCE.replace("--[[chosen path]] 'active'", "--[[chosen path]] 'other'"));
	const { cpu } = createCartlibProgramHarness(`
local registry<const> = require('cartlib/registry')
local events<const> = require('cartlib/event_emitter')
local component<const> = require('cartlib/fsm/fsm_component')
local fsm<const> = require('cartlib/fsm/fsm')
local target<const> = {id='retarget-test', active=true, tags={}, allowed=false, calls=0, guards=0, exits=0, entries=0}
function target:_retain_tag(tag) self.tags[tag]=true end
function target:_release_tag(tag) self.tags[tag]=nil end
target.events = events.events_of(target)
do ${FSM_RETARGET_EXECUTION_SOURCE} end
local machines<const> = component.factory({'fixture.execution'})({parent=target})
machines.id='retarget-test-fsm'
machines:on_attach()
registry:register(machines)
registry:index(machines, component)
machines:start()
local machine<const> = machines:get_machine('fixture.execution')
local idle<const> = machine.current_state
local data<const> = machine.data
do ${model.buffer.getText()} end
assert(machines:get_machine('fixture.execution')==machine and machine.current_state==idle and machine.data==data and data.retained==73)
target.events:emit('choose')
assert(machine.current_state==idle and target.calls==1 and target.guards==1 and target.exits==0 and target.entries==0)
target.allowed=true
target.events:emit('choose')
assert(machine.current_id=='other' and target.calls==2 and target.guards==2 and target.exits==1 and target.entries==1)
local other<const> = machine.current_state
fsm.transition_state_path(other, fsm.bind_state_path(other.definition, '../'))
assert(machine.current_state==other and target.exits==1 and target.entries==1, 'upward traversal is not state re-entry')
return true
`);
	assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true]);
	model.undo(); assert.equal(model.buffer.getText(), FSM_RETARGET_EXECUTION_SOURCE);
	model.dispose();
});
