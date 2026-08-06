local basesystem<const> = {}
basesystem.__index = basesystem

function basesystem.new(group, priority)
	return setmetatable({
		group = group,
		priority = priority,
	}, basesystem)
end

function basesystem:clear()
end

return basesystem
