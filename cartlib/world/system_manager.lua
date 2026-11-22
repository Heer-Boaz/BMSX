local clock<const> = require('cartlib/clock')
local tick_schedule<const> = require('cartlib/world/tick_schedule')

local system_manager<const> = {}
system_manager.__index = system_manager

-- Configuration orders the concrete systems once and binds the two clock
-- schedules. Frame execution consumes only the retained group callbacks.

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
		_clock_resume_callbacks = {
			[clock.gameplay] = {},
			[clock.frame] = {},
		},
	}, system_manager)
end

function system_manager:configure(
	system_classes,
	gameplay_delta_milliseconds,
	frame_delta_milliseconds,
	gameplay_clock_rate
)
	local systems<const> = {}
	local tick_functions<const> = {}
	local clock_resume_callbacks<const> = self._clock_resume_callbacks
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
			local on_clock_resumed<const> = definition.on_clock_resumed
			if on_clock_resumed ~= nil then
				local callbacks<const> = clock_resume_callbacks[definition.clock_source]
				callbacks[#callbacks + 1] = on_clock_resumed
			end
		end
	end
	table.sort(tick_functions, tick_function_less)
	self._systems = systems
	local owner<const> = self._world
	local update_with_gameplay<const> = tick_schedule.bind(owner, systems, tick_functions,
		clock.gameplay | clock.frame, gameplay_delta_milliseconds, frame_delta_milliseconds)
	local update_without_gameplay<const> = tick_schedule.bind(owner, systems, tick_functions,
		clock.frame, gameplay_delta_milliseconds, frame_delta_milliseconds)
	if gameplay_clock_rate == nil then
		return update_with_gameplay, update_without_gameplay
	end

	-- Virtual gameplay time accumulates at an exact rational rate while each
	-- admitted simulation step retains the cart's fixed update quantum. Frame
	-- work remains admitted on every world update. Pausing bypasses this runner,
	-- which also freezes its accumulated phase.
	local numerator<const> = gameplay_clock_rate.numerator
	local denominator<const> = gameplay_clock_rate.denominator
	local phase = denominator - 1
	local update_at_gameplay_rate<const> = function()
		phase = phase + numerator
		if phase >= denominator then
			phase = phase - denominator
			return update_with_gameplay()
		end
		return update_without_gameplay()
	end
	return update_at_gameplay_rate, update_without_gameplay
end

-- Clock-bound systems publish resume ownership on their static tick-function
-- records. Dispatch is paid only at the explicit clock boundary; ordinary
-- frame execution only visits the bound schedule.
function system_manager:resume_clock(clock_source)
	local callbacks<const> = self._clock_resume_callbacks[clock_source]
	for callback_index = 1, #callbacks do
		callbacks[callback_index]()
	end
end

function system_manager:reset()
	local systems<const> = self._systems
	for system_index = 1, #systems do
		systems[system_index]:clear()
	end
end

return system_manager
