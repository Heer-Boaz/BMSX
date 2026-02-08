local constants = require('constants.lua')

local level = {}

function level.create_level()
	return {
		world_width = constants.world.width,
		world_height = constants.world.height,
		spawn = { x = constants.player.start_x, y = constants.player.start_y },
		goal = { x = constants.world.width - 92, y = 118, w = 32, h = 82 },
		solids = {
			-- Flat measurement lane for deterministic physics tuning.
			{ x = 0, y = 200, w = constants.world.width, h = 40 },
		},
		decor_far = {
			{ x = -120, y = 132, w = 340, h = 108 },
			{ x = 300, y = 142, w = 300, h = 98 },
			{ x = 700, y = 130, w = 360, h = 110 },
			{ x = 1180, y = 138, w = 320, h = 102 },
			{ x = 1620, y = 129, w = 370, h = 111 },
			{ x = 2100, y = 140, w = 310, h = 100 },
			{ x = 2510, y = 132, w = 360, h = 108 },
			{ x = 2970, y = 142, w = 280, h = 98 },
		},
		decor_mid = {
			{ x = -40, y = 166, w = 220, h = 74 },
			{ x = 250, y = 170, w = 190, h = 70 },
			{ x = 540, y = 160, w = 230, h = 80 },
			{ x = 860, y = 168, w = 190, h = 72 },
			{ x = 1130, y = 162, w = 210, h = 78 },
			{ x = 1430, y = 170, w = 190, h = 70 },
			{ x = 1720, y = 160, w = 220, h = 80 },
			{ x = 2030, y = 168, w = 190, h = 72 },
			{ x = 2300, y = 162, w = 210, h = 78 },
			{ x = 2600, y = 170, w = 190, h = 70 },
			{ x = 2880, y = 160, w = 230, h = 80 },
		},
	}
end

return level
