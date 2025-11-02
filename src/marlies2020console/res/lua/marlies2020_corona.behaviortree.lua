local directions = {
	{ x = -1, y = 0 },
	{ x = 1, y = 0 },
	{ x = 0, y = -1 },
	{ x = 0, y = 1 },
}

local function corona_state(owner)
	return owner.lua_instance
end

local function bootstrap(self, blackboard)
	if blackboard:get('ready') then
		return 'SUCCESS'
	end
	blackboard:set('ready', true)
	blackboard:set('index', 1)
	local context = corona_state(self)
	context.move_x = -1
	context.move_y = 0
	return 'SUCCESS'
end

local function choose_direction(self, blackboard)
	local choice = math.random(1, #directions)
	blackboard:set('index', choice)
	local selected = directions[choice]
	local context = corona_state(self)
	context.move_x = selected.x
	context.move_y = selected.y
	return 'SUCCESS'
end

return {
	id = 'marlies2020_corona_bt',
	definition = {
		root = {
			type = 'Sequence',
			children = {
				{ type = 'Action', action = bootstrap },
				{ type = 'Action', action = choose_direction },
			},
		},
	},
}
