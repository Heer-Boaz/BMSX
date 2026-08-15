local clock<const> = require('cartlib/clock')
local system_schedule_syntax<const> = require('cartlib/world/system_schedule_syntax')

local system_manager<const> = {}
system_manager.__index = system_manager
local compile_syntax<const> = lua_compiler.compile_syntax

-- Configuration instantiates and sorts concrete system classes once, then
-- compiles that fixed composition into a straight-line runner. The frame path
-- retains each system directly and opens one structural barrier per group; it
-- does not rediscover group ranges or index the system table.

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

	for system_index = 1, #systems do
		systems[system_index]._configuration_index = nil
	end
	self._systems = systems
	local factory<const> = compile_syntax(
		system_schedule_syntax.build(systems, clock.frame_milliseconds()),
		'[world.system_schedule]'
	)()
	return factory(self._world, systems)
end

function system_manager:reset()
	local systems<const> = self._systems
	for system_index = 1, #systems do
		systems[system_index]:clear()
	end
end

return system_manager
