-- The cartlib producer binds different topology into ROM-backed evaluator code.
local frame_program<const> = require('cartlib/fsm/frame_program')
local no_op<const> = 'stay'
local child_update<const> = function(child)
	child.calls = child.calls + 1
end
local update<const> = function(target, state)
	target.updates = target.updates + 1
	if target.updates % 16 == 0 then return 'advance' end
	return no_op
end
local definition<const> = {
	has_current_frame_work = true,
	update = update,
	input_handler_count = 1,
	input_eval_first = false,
	frame_concurrent_state_count = 1,
	input_transition_kinds = { 'input' },
	input_transitions = { 'next' },
}
fsm_state = {
	target = { updates = 0 },
	transitions = 0,
	current_state = { active_frame_work = true, calls = 0, frame_evaluator = child_update },
	frame_concurrent_states = {
		{ active_frame_work = true, calls = 0, frame_evaluator = child_update },
		{ active_frame_work = true, calls = 0, frame_evaluator = child_update },
	},
	input_bindings = { function() return fsm_state.target.updates % 8 == 0 end },
	execute_transition = function(state, kind, target)
		assert(kind == 'input' and target == 'next')
		state.transitions = state.transitions + 3
	end,
	transition_to = function(state, target)
		assert(target == 'advance')
		state.transitions = state.transitions + 5
	end,
}
local exercise<const> = function(evaluator, calls)
	for _ = 1, calls do evaluator(fsm_state) end
end
-- Every sixteen updates dispatch two input transitions (+3 each) and one
-- update transition (+5). Only the new evaluator fans out to the second child.
local check<const> = function(updates, second_child_calls)
	assert(fsm_state.target.updates == updates)
	assert(fsm_state.transitions == (updates >> 4) * 11)
	assert(fsm_state.current_state.calls == updates)
	assert(fsm_state.frame_concurrent_states[1].calls == updates)
	assert(fsm_state.frame_concurrent_states[2].calls == second_child_calls)
end
check(0, 0)
fsm_phase = 0
halt_until_irq
fsm_evaluator = frame_program.bind_state_evaluator(definition, no_op)
check(0, 0)
fsm_phase = 1
halt_until_irq
-- Warm through promotion and region merges before testing retained identity.
exercise(fsm_evaluator, 256)
check(256, 0)
fsm_phase = 2
halt_until_irq
exercise(fsm_evaluator, 16)
check(272, 0)
fsm_phase = 3
halt_until_irq
fsm_bindings = {}
for index = 1, 3 do
	local evaluator<const> = frame_program.bind_state_evaluator(definition, no_op)
	fsm_bindings[index] = evaluator
	exercise(evaluator, 16)
end
check(320, 0)
fsm_phase = 4
halt_until_irq
definition.frame_concurrent_state_count = 2
fsm_other = frame_program.bind_state_evaluator(definition, no_op)
check(320, 0)
fsm_phase = 5
halt_until_irq
exercise(fsm_other, 256)
check(576, 256)
fsm_phase = 6
halt_until_irq
exercise(fsm_other, 16)
check(592, 272)
fsm_phase = 7
halt_until_irq

-- A state update first visits the selected child and active concurrent lane.
-- First-match input never evaluates the later predicate; the update is last.
local order<const> = {}
local all<const> = {
	has_current_frame_work = true, input_handler_count = 2, input_eval_first = false,
	frame_concurrent_state_count = 1,
	input_transition_kinds = { 1, 2 }, input_transitions = { 'first', 'second' },
	update = function() order[#order + 1] = 'update' end,
}
local subject<const> = {
	current_state = { active_frame_work = true,
		frame_evaluator = function() order[#order + 1] = 'current' end },
	frame_concurrent_states = { { active_frame_work = true,
		frame_evaluator = function() order[#order + 1] = 'concurrent' end } },
	input_bindings = { function() return true end, function() order[#order + 1] = 'tested'; return true end },
	execute_transition = function(_, _, dest) order[#order + 1] = dest end,
}
frame_program.bind_state_evaluator(all, no_op)(subject)
assert(table.concat(order, ',') == 'current,concurrent,first,tested,second,update')
for index = 1, #order do order[index] = nil end
all.input_eval_first = true
frame_program.bind_state_evaluator(all, no_op)(subject)
assert(table.concat(order, ',') == 'current,concurrent,first,update')
return true
