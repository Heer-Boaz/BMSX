-- Tick prerequisites are static system-composition data. Admission filters the
-- selected clock lanes and resolves their dependency graph once; frame
-- execution consumes only the resulting dense order.
local tick_schedule<const> = {}

local insert_ready<const> = function(ready, ready_head, ready_count, index)
	local position = ready_count + 1
	while position > ready_head and ready[position - 1] > index do
		ready[position] = ready[position - 1]
		position = position - 1
	end
	ready[position] = index
	return ready_count + 1
end

local append_group<const> = function(
	ordered,
	selected,
	selected_index_by_definition,
	first,
	last
)
	local group_count<const> = last - first + 1
	local prerequisite_counts<const> = {}
	local dependents<const> = {}
	for group_index = 1, group_count do
		prerequisite_counts[group_index] = 0
		local tick_function<const> = selected[first + group_index - 1]
		local definition<const> = tick_function.definition
		local prerequisites<const> = definition.prerequisites
		if prerequisites ~= nil then
			for prerequisite_index = 1, #prerequisites do
				local selected_index<const> = selected_index_by_definition[
					prerequisites[prerequisite_index]
				]
				if selected_index ~= nil then
					local prerequisite<const> = selected[selected_index]
					local prerequisite_group<const> = prerequisite.definition.group
					if prerequisite_group > definition.group then
						error('tick prerequisite belongs to a later tick group')
					end
					if prerequisite_group == definition.group then
						prerequisite_counts[group_index] = prerequisite_counts[group_index] + 1
						local prerequisite_group_index<const> = selected_index - first + 1
						local dependent_indices = dependents[prerequisite_group_index]
						if dependent_indices == nil then
							dependent_indices = {}
							dependents[prerequisite_group_index] = dependent_indices
						end
						dependent_indices[#dependent_indices + 1] = group_index
					end
				end
			end
		end
	end

	local ready<const> = {}
	local ready_count = 0
	for group_index = 1, group_count do
		if prerequisite_counts[group_index] == 0 then
			ready_count = ready_count + 1
			ready[ready_count] = group_index
		end
	end
	local ready_head = 1
	for _ = 1, group_count do
		if ready_head > ready_count then
			error('tick prerequisite cycle')
		end
		local group_index<const> = ready[ready_head]
		ready_head = ready_head + 1
		ordered[#ordered + 1] = selected[first + group_index - 1]
		local dependent_indices<const> = dependents[group_index]
		if dependent_indices ~= nil then
			for dependent_index = 1, #dependent_indices do
				local dependent_group_index<const> = dependent_indices[dependent_index]
				local count<const> = prerequisite_counts[dependent_group_index] - 1
				prerequisite_counts[dependent_group_index] = count
				if count == 0 then
					ready_count = insert_ready(
						ready,
						ready_head,
						ready_count,
						dependent_group_index
					)
				end
			end
		end
	end
end

function tick_schedule.compile(tick_functions, active_clocks)
	local selected<const> = {}
	local selected_index_by_definition<const> = {}
	for tick_index = 1, #tick_functions do
		local tick_function<const> = tick_functions[tick_index]
		if (tick_function.definition.clock_source & active_clocks) ~= 0 then
			local selected_index<const> = #selected + 1
			selected[selected_index] = tick_function
			selected_index_by_definition[tick_function.definition] = selected_index
		end
	end

	local ordered<const> = {}
	local first = 1
	while first <= #selected do
		local group<const> = selected[first].definition.group
		local last = first
		while last < #selected and selected[last + 1].definition.group == group do
			last = last + 1
		end
		append_group(ordered, selected, selected_index_by_definition, first, last)
		first = last + 1
	end
	return ordered
end

return tick_schedule
