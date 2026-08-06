local clock<const> = require('cartlib/clock')

local system_manager<const> = {}
system_manager.__index = system_manager

local system_priority_less<const> = function(a, b)
	if a.group ~= b.group then
		return a.group < b.group
	end
	if a.priority ~= b.priority then
		return a.priority < b.priority
	end
	return a._configuration_index < b._configuration_index
end

function system_manager.new(world)
	return setmetatable({
		_world = world,
		_systems = {},
		_tick_groups = {},
		_systems_by_tick_group = {},
		_system_counts = {},
		_tick_group_count = 0,
		_delta_time = clock.frame_milliseconds(),
	}, system_manager)
end

function system_manager:configure(system_classes)
	local systems<const> = {}
	for system_index = 1, #system_classes do
		local instance<const> = system_classes[system_index].new(self._world)
		instance._configuration_index = system_index
		systems[system_index] = instance
	end
	table.sort(systems, system_priority_less)

	local tick_groups<const> = self._tick_groups
	local configured_systems_by_tick_group<const> = self._systems_by_tick_group
	local system_counts<const> = self._system_counts
	local configured_tick_group_count = 0
	for system_index = 1, #systems do
		local instance<const> = systems[system_index]
		local group<const> = instance.group
		if tick_groups[configured_tick_group_count] ~= group then
			configured_tick_group_count = configured_tick_group_count + 1
			tick_groups[configured_tick_group_count] = group
			configured_systems_by_tick_group[configured_tick_group_count] = {}
			system_counts[configured_tick_group_count] = 0
		end
		local tick_group_systems<const> = configured_systems_by_tick_group[configured_tick_group_count]
		local system_count<const> = system_counts[configured_tick_group_count] + 1
		tick_group_systems[system_count] = instance
		system_counts[configured_tick_group_count] = system_count
	end
	self._systems = systems
	self._tick_group_count = configured_tick_group_count
end

function system_manager:update()
	local world<const> = self._world
	for tick_group_index = 1, self._tick_group_count do
		world:_begin_tick_group(self._tick_groups[tick_group_index])
		local systems<const> = self._systems_by_tick_group[tick_group_index]
		for system_index = 1, self._system_counts[tick_group_index] do
			systems[system_index]:update(self._delta_time)
		end
		if world:_commit_tick_group() then
			return
		end
	end
end

function system_manager:reset()
	local systems<const> = self._systems
	for system_index = 1, #systems do
		systems[system_index]:clear()
	end
end

return system_manager
