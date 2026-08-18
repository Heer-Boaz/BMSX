-- Compiler-owned execution storage layout. Composite cursors, task activity,
-- Service scheduling, observer state and per-agent node-memory records share
-- one dense state table. Tickable Services additionally receive a retained,
-- preallocated active lane owned by the execution component; authored
-- definitions never observe either representation.

local execution_layout<const> = {}

local create_no_state<const> = function()
	return nil
end

local create_plain_state<const> = function()
	return {}
end

function execution_layout.new(blackboard_layout)
	return {
		state_slot_count = 0,
		execution_index_count = 0,
		flag_slots = {},
		record_slots = {},
		service_count = 0,
		blackboard_layout = blackboard_layout,
		blackboard_observers_by_slot = {},
		execution_requests = {},
	}
end

function execution_layout.allocate_slot(layout)
	local slot<const> = layout.state_slot_count + 1
	layout.state_slot_count = slot
	return slot
end

function execution_layout.allocate_slots(layout, count)
	local first_slot<const> = layout.state_slot_count + 1
	layout.state_slot_count = layout.state_slot_count + count
	return first_slot
end

function execution_layout.allocate_flag(layout)
	local slot<const> = execution_layout.allocate_slot(layout)
	local flag_slots<const> = layout.flag_slots
	flag_slots[#flag_slots + 1] = slot
	return slot
end

function execution_layout.allocate_execution_index(layout)
	local execution_index<const> = layout.execution_index_count + 1
	layout.execution_index_count = execution_index
	return execution_index
end

function execution_layout.allocate_node_memory(layout)
	local slot<const> = execution_layout.allocate_slot(layout)
	local record_slots<const> = layout.record_slots
	record_slots[#record_slots + 1] = slot
	return slot
end

function execution_layout.compile_state_factory(layout)
	local create_state
	if layout.state_slot_count == 0 then
		create_state = create_no_state
	else
		local flag_slots<const> = layout.flag_slots
		local flag_count<const> = #flag_slots
		local record_slots<const> = layout.record_slots
		local record_count<const> = #record_slots
		if flag_count == 0 and record_count == 0 then
			create_state = create_plain_state
		else
			create_state = function()
				local state<const> = {}
				for index = 1, flag_count do
					state[flag_slots[index]] = false
				end
				for index = 1, record_count do
					state[record_slots[index]] = {}
				end
				return state
			end
		end
	end
	local service_count<const> = layout.service_count
	if service_count == 0 then
		return create_state
	end
	return function()
		local active_services<const> = {}
		for index = 1, service_count do
			active_services[index] = false
		end
		return create_state(), active_services
	end
end

return execution_layout
