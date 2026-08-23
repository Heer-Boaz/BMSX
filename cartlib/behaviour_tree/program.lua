local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local execution_layout<const> = require('cartlib/behaviour_tree/execution_layout')
local node_program<const> = require('cartlib/behaviour_tree/node_program')
local observer_program<const> = require('cartlib/behaviour_tree/observer_program')
local result<const> = require('cartlib/behaviour_tree/result')
local service_program<const> = require('cartlib/behaviour_tree/service_program')

-- A compiled tree program owns the root scheduling policy. Node lowering has
-- already produced the retained evaluator graph; this boundary fuses the
-- exact Service, Blackboard-observer and latent-task capabilities used by
-- that graph. The 50 Hz path therefore contains no generic feature dispatch.

local program<const> = {}
local result_waiting<const> = result.waiting

-- Authored definitions are admission input. The retained program contains
-- only the evaluator graph, immutable operands, its reset path and a factory
-- for component-owned evaluator slots and node-memory records.
function program.compile(tree_id, definition)
	local blackboard_definition<const> = definition.blackboard
	local blackboard_layout<const> = blackboard_definition and blackboard.compile(blackboard_definition)
	local layout<const> = execution_layout.new(blackboard_layout)
	local evaluate, operand, reset<const> = node_program.compile(definition.root, layout)
	local notifications<const>, process_execution_requests<const> = observer_program.compile_runtime(layout)
	local tick_active_services<const> = service_program.compile_runtime(layout)
	if blackboard_layout ~= nil then
		blackboard_layout.notifications = notifications
	end
	-- Select one fused root runner at admission. Service, observer and latent
	-- capabilities never become feature branches on the 50 Hz execution path.
	if layout.event_driven_task_count > 0 then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		if tick_active_services ~= nil and process_execution_requests ~= nil then
			local evaluate_waiting_with_services_and_requests<const> = function(target, execution)
				tick_active_services(target, execution)
				local request_pending<const> = execution._execution_request_pending
				if execution._execution_waiting then
					if not request_pending then
						return result_waiting
					end
					execution._execution_waiting = false
				end
				if request_pending then
					execution._execution_request_pending = false
					process_execution_requests(target, execution, execution._execution_state)
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_services_and_requests
		elseif tick_active_services ~= nil then
			local evaluate_waiting_with_services<const> = function(target, execution)
				tick_active_services(target, execution)
				if execution._execution_waiting then
					return result_waiting
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_services
		elseif process_execution_requests ~= nil then
			local evaluate_waiting_with_requests<const> = function(target, execution)
				local request_pending<const> = execution._execution_request_pending
				if execution._execution_waiting then
					if not request_pending then
						return result_waiting
					end
					execution._execution_waiting = false
				end
				if request_pending then
					execution._execution_request_pending = false
					process_execution_requests(target, execution, execution._execution_state)
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting_with_requests
		else
			local evaluate_waiting<const> = function(target, execution)
				if execution._execution_waiting then
					return result_waiting
				end
				local status<const> = evaluate_root(target, execution, root_operand)
				if status == result_waiting then
					execution:_wait_for_latent_task()
				end
				return status
			end
			evaluate = evaluate_waiting
		end
		operand = nil
	elseif tick_active_services ~= nil and process_execution_requests ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_services_and_requests<const> = function(target, execution)
			tick_active_services(target, execution)
			if execution._execution_request_pending then
				execution._execution_request_pending = false
				process_execution_requests(target, execution, execution._execution_state)
			end
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_services_and_requests
		operand = nil
	elseif tick_active_services ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_services<const> = function(target, execution)
			tick_active_services(target, execution)
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_services
		operand = nil
	elseif process_execution_requests ~= nil then
		local evaluate_root<const> = evaluate
		local root_operand<const> = operand
		local evaluate_with_requests<const> = function(target, execution)
			if execution._execution_request_pending then
				execution._execution_request_pending = false
				process_execution_requests(target, execution, execution._execution_state)
			end
			return evaluate_root(target, execution, root_operand)
		end
		evaluate = evaluate_with_requests
		operand = nil
	end
	return {
		id = tree_id,
		blackboard_layout = blackboard_layout,
		evaluate = evaluate,
		operand = operand,
		reset = reset,
		create_execution_state = execution_layout.compile_state_factory(layout),
	}
end

return program
