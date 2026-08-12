local base_system<const> = {}
base_system.__index = base_system

function base_system.new(group, priority)
	return setmetatable({
		group = group,
		priority = priority,
	}, base_system)
end

function base_system:clear()
end

return base_system
