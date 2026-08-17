local base_system<const> = {}
base_system.__index = base_system

function base_system.new(primary_tick_function)
	return setmetatable({
		tick_functions = { primary_tick_function },
	}, base_system)
end

-- Systems may own several independently scheduled work units, matching the
-- tick-function model rather than forcing one clock policy onto the owner.
-- Static tick-function records are also their prerequisite identity; the
-- system manager resolves that graph once and emits direct calls.
function base_system:add_tick_function(tick_function)
	local tick_functions<const> = self.tick_functions
	tick_functions[#tick_functions + 1] = tick_function
end

function base_system:clear()
end

return base_system
