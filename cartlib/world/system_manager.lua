local clock<const> = require('cartlib/clock')
local system_schedule_syntax<const> = require('cartlib/world/system_schedule_syntax')
local tick_schedule<const> = require('cartlib/world/tick_schedule')

local system_manager<const> = {}
system_manager.__index = system_manager
local compile_syntax<const> = lua_compiler.compile_syntax

-- Configuration instantiates the concrete systems once, orders their static
-- tick functions, then compiles that fixed composition into straight-line
-- runners. Each runner retains every system directly and opens one structural
-- barrier per group; it does not rediscover group ranges or index the system
-- table.

local tick_function_less<const> = function(a, b)
	local a_definition<const> = a.definition
	local b_definition<const> = b.definition
	if a_definition.group ~= b_definition.group then
		return a_definition.group < b_definition.group
	end
	if a_definition.priority ~= b_definition.priority then
		return a_definition.priority < b_definition.priority
	end
	if a.system_index ~= b.system_index then
		return a.system_index < b.system_index
	end
	return a.function_index < b.function_index
end

function system_manager.new(world)
	return setmetatable({
		_world = world,
		_systems = {},
	}, system_manager)
end

function system_manager:configure(system_classes)
	local systems<const> = {}
	local tick_functions<const> = {}
	for system_index = 1, #system_classes do
		local instance<const> = system_classes[system_index].new(self._world)
		systems[system_index] = instance
		local instance_tick_functions<const> = instance.tick_functions
		for function_index = 1, #instance_tick_functions do
			local definition<const> = instance_tick_functions[function_index]
			tick_functions[#tick_functions + 1] = {
				definition = definition,
				system_index = system_index,
				function_index = function_index,
			}
		end
	end
	table.sort(tick_functions, tick_function_less)
	local update_with_gameplay<const> = tick_schedule.compile(
		tick_functions,
		clock.gameplay | clock.frame
	)
	local update_without_gameplay<const> = tick_schedule.compile(tick_functions, clock.frame)
	self._systems = systems
	local factory<const> = compile_syntax(
		system_schedule_syntax.build(
			systems,
			update_with_gameplay,
			update_without_gameplay,
			clock.frame_milliseconds()
		),
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
