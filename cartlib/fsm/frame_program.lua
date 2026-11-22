local frame_program<const> = {}
local dormant_runner<const> = function() end

function frame_program.bind_component_runner(machines)
	local machine_count<const> = #machines
	if machine_count == 0 then return dormant_runner end
	local first<const> = machines[1]
	if machine_count == 1 then
		return function()
			if first.active_frame_work then first:update() end
		end
	end
	return function()
		for index = 1, machine_count do
			local machine<const> = machines[index]
			if machine.active_frame_work then machine:update() end
		end
	end
end

local current_only<const> = function(state)
	local current<const> = state.current_state
	if current.active_frame_work then current:frame_evaluator() end
end

-- Most evaluating states only visit their active child or run a local update.
-- Bind those paths directly; layered states keep their ordered child and input
-- lanes. These are cartridge functions, not templates compiled by the BIOS.
function frame_program.bind_state_evaluator(definition, no_op)
	local has_current_frame_work<const> = definition.has_current_frame_work
	local update_handler<const> = definition.update
	local input_handler_count<const> = definition.input_handler_count
	local frame_concurrent_state_count<const> = definition.frame_concurrent_state_count
	if frame_concurrent_state_count == 0 and input_handler_count == 0 then
		if update_handler == nil then return current_only end
		if has_current_frame_work then
			return function(state)
				local current<const> = state.current_state
				if current.active_frame_work then current:frame_evaluator() end
				local next_state<const> = update_handler(state.target, state)
				if next_state and next_state ~= no_op then state:transition_to(next_state) end
			end
		end
		return function(state)
			local next_state<const> = update_handler(state.target, state)
			if next_state and next_state ~= no_op then state:transition_to(next_state) end
		end
	end
	local input_eval_first<const> = definition.input_eval_first
	local transition_kinds<const> = definition.input_transition_kinds
	local transitions<const> = definition.input_transitions
	return function(state)
		if has_current_frame_work then
			local current<const> = state.current_state
			if current.active_frame_work then current:frame_evaluator() end
		end
		if frame_concurrent_state_count ~= 0 then
			local concurrent<const> = state.frame_concurrent_states
			for index = 1, frame_concurrent_state_count do
				local child<const> = concurrent[index]
				if child.active_frame_work then child:frame_evaluator() end
			end
		end
		if input_handler_count == 1 then
			if state.input_bindings[1]() then
				state:execute_transition(transition_kinds[1], transitions[1])
			end
		elseif input_handler_count ~= 0 then
			local bindings<const> = state.input_bindings
			for index = 1, input_handler_count do
				if bindings[index]() then
					state:execute_transition(transition_kinds[index], transitions[index])
					if input_eval_first then break end
				end
			end
		end
		if update_handler ~= nil then
			local next_state<const> = update_handler(state.target, state)
			if next_state and next_state ~= no_op then state:transition_to(next_state) end
		end
	end
end

return frame_program
