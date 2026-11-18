-- The real cartlib producer owns syntax, topology caching and closure binding.
local frame_program<const> = require('cartlib/fsm/frame_program')
local no_op<const> = 'stay'
local child_update<const> = function(child)
	child.calls = child.calls + 1
end
local update<const> = function(target, state)
	target.updates = target.updates + 1
	target.checksum = (target.checksum * 17 + state.transitions) & 0xffff
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
	target = { updates = 0, checksum = 0 },
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
local exercise<const> = function(evaluator)
	for _ = 1, 256 do evaluator(fsm_state) end
end
fsm_phase = 0
halt_until_irq
fsm_evaluator = frame_program.compile_state_evaluator(definition, no_op)
fsm_phase = 1
halt_until_irq
exercise(fsm_evaluator)
fsm_phase = 2
halt_until_irq
exercise(fsm_evaluator)
fsm_phase = 3
halt_until_irq
fsm_bindings = {}
for index = 1, 32 do
	local evaluator<const> = frame_program.compile_state_evaluator(definition, no_op)
	fsm_bindings[index] = evaluator
	exercise(evaluator)
end
fsm_phase = 4
halt_until_irq
definition.frame_concurrent_state_count = 2
fsm_other = frame_program.compile_state_evaluator(definition, no_op)
fsm_phase = 5
halt_until_irq
exercise(fsm_other)
fsm_phase = 6
halt_until_irq
exercise(fsm_other)
fsm_phase = 7
halt_until_irq
assert(fsm_state.target.updates == 9216)
assert(fsm_state.transitions == 6336)
assert(fsm_state.current_state.calls == 9216)
assert(fsm_state.frame_concurrent_states[1].calls == 9216)
assert(fsm_state.frame_concurrent_states[2].calls == 512)
return true
