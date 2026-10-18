local state<const> = require('results')
local result<const>: *modules_manual_result = state.result
result.counter_loads = result.counter_loads + 1

local value = 10
local advance<const> = function(delta)
	value = value + delta * modules_manual_step
	return value
end
return { advance = advance }
