local constants = require('constants.lua')

local level = {}

function level.create_level()
	local world_width = constants.world.width
	local world_height = constants.world.height
	local ground_y = 192

	return {
		world_width = world_width,
		world_height = world_height,
		spawn = { x = constants.player.start_x, y = constants.player.start_y },
		goal = { x = world_width - 236, y = 120, w = 78, h = 72 },
		solids = {
			{ x = 0, y = ground_y, w = world_width, h = world_height - ground_y },
		},
		decor_far = {
			{ x = -160, y = 118, w = 420, h = 122 },
			{ x = 320, y = 122, w = 370, h = 118 },
			{ x = 760, y = 116, w = 430, h = 124 },
			{ x = 1290, y = 120, w = 390, h = 120 },
			{ x = 1760, y = 114, w = 450, h = 126 },
			{ x = 2310, y = 120, w = 400, h = 120 },
			{ x = 2790, y = 116, w = 430, h = 124 },
			{ x = 3320, y = 120, w = 410, h = 120 },
			{ x = 3810, y = 114, w = 420, h = 126 },
		},
		decor_mid = {
			{ x = -40, y = 152, w = 220, h = 88 },
			{ x = 250, y = 158, w = 190, h = 82 },
			{ x = 520, y = 150, w = 220, h = 90 },
			{ x = 820, y = 156, w = 210, h = 84 },
			{ x = 1110, y = 148, w = 230, h = 92 },
			{ x = 1420, y = 156, w = 200, h = 84 },
			{ x = 1690, y = 150, w = 230, h = 90 },
			{ x = 2000, y = 156, w = 210, h = 84 },
			{ x = 2290, y = 148, w = 230, h = 92 },
			{ x = 2600, y = 156, w = 200, h = 84 },
			{ x = 2880, y = 150, w = 230, h = 90 },
			{ x = 3190, y = 156, w = 210, h = 84 },
			{ x = 3480, y = 148, w = 230, h = 92 },
			{ x = 3790, y = 156, w = 200, h = 84 },
		},
		trunks = {
			{ x = 180, y = 90, w = 30, h = 102 },
			{ x = 700, y = 84, w = 28, h = 108 },
			{ x = 1280, y = 86, w = 32, h = 106 },
			{ x = 1750, y = 82, w = 28, h = 110 },
			{ x = 2310, y = 88, w = 32, h = 104 },
			{ x = 2890, y = 84, w = 30, h = 108 },
			{ x = 3450, y = 88, w = 32, h = 104 },
		},
	}
end

return level
