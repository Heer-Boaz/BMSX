local tick_group<const> = {
	input = 10,
	action_effects = 20,
	gameplay = 30,
	physics = 40,
	animation = 50,
}

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

return {
	tick_group = tick_group,
	system = system,
}
