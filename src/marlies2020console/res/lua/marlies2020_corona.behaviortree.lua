local MIN_CORONA_MOVE = 16
local MAX_CORONA_MOVE = 72
local CORONA_SPEED = 55

local directions = {
	{ x = -1, y = 0 },
	{ x = 1, y = 0 },
	{ x = 0, y = -1 },
	{ x = 0, y = 1 },
}

local function bootstrap(self, blackboard)
	if blackboard:get('ready') then
		return 'SUCCESS'
	end
	blackboard:set('ready', true)
	blackboard:set('timer', 0)
	blackboard:set('index', 1)
	local state = self:getcomponentbyid('corona_state').vars
	state.move_x = -1
	state.move_y = 0
	return 'SUCCESS'
end

local function choose_direction(self, blackboard)
	local timer = (blackboard:get('timer') or 0) - delta_seconds()
	if timer <= 0 then
		local choice = math.random(1, #directions)
		blackboard:set('index', choice)
		local distance = math.random(MIN_CORONA_MOVE, MAX_CORONA_MOVE)
		blackboard:set('timer', distance / CORONA_SPEED)
		local selected = directions[choice]
		local state = self:getcomponentbyid('corona_state').vars
		state.move_x = selected.x
		state.move_y = selected.y
	else
		blackboard:set('timer', timer)
	end
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
