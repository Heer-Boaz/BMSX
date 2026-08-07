local clock<const> = require('cartlib/clock')

local systemmanager<const> = {}
systemmanager.__index = systemmanager

local system_priority_less<const> = function(a, b)
	if a.group ~= b.group then
		return a.group < b.group
	end
	if a.priority ~= b.priority then
		return a.priority < b.priority
	end
	return a._configuration_index < b._configuration_index
end

function systemmanager.new(world)
	return setmetatable({
		_world = world,
		_systems = {},
		_group_count = 0,
		_delta_time = clock.frame_milliseconds(),
	}, systemmanager)
end

function systemmanager:configure(system_classes)
	local systems<const> = {}
	for system_index = 1, #system_classes do
		local instance<const> = system_classes[system_index].new(self._world)
		instance._configuration_index = system_index
		systems[system_index] = instance
	end
	table.sort(systems, system_priority_less)

	local system_count<const> = #systems
	local group_end_indices<const> = {}
	local group_count = 0
	if system_count ~= 0 then
		local group = systems[1].group
		for system_index = 1, system_count do
			local instance<const> = systems[system_index]
			if instance.group ~= group then
				group_count = group_count + 1
				group_end_indices[group_count] = system_index - 1
				group = instance.group
			end
			instance._configuration_index = nil
		end
		group_count = group_count + 1
		group_end_indices[group_count] = system_count
	end
	self._systems = systems
	self._group_end_indices = group_end_indices
	self._group_count = group_count
end

function systemmanager:update()
	local world<const> = self._world
	local systems<const> = self._systems
	local first_system_index = 1
	for group_index = 1, self._group_count do
		world:_open_mutation_barrier()
		local last_system_index<const> = self._group_end_indices[group_index]
		for system_index = first_system_index, last_system_index do
			systems[system_index]:update(self._delta_time)
		end
		if world:_commit_mutation_barrier() then
			return
		end
		first_system_index = last_system_index + 1
	end
end

function systemmanager:reset()
	local systems<const> = self._systems
	for system_index = 1, #systems do
		systems[system_index]:clear()
	end
end

return systemmanager
