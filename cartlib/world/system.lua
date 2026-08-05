local system<const> = {}
system.__index = system

function system.new(group, priority)
	return setmetatable({
		group = group,
		priority = priority,
	}, system)
end

function system:clear()
end

return system
