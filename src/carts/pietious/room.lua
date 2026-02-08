local constants = require('constants.lua')

local room = {}

function room.create_room()
	return {
		world_width = constants.room.width,
		world_height = constants.room.height,
		spawn = { x = constants.player.start_x, y = constants.player.start_y },
		solids = {
			{ x = 0, y = 216, w = 320, h = 24 },
			{ x = 24, y = 166, w = 140, h = 12 },
			{ x = 210, y = 182, w = 62, h = 10 },
		},
		windows = {
			{ x = 36, y = 72, w = 14, h = 24 },
			{ x = 96, y = 72, w = 14, h = 24 },
			{ x = 156, y = 72, w = 14, h = 24 },
			{ x = 216, y = 72, w = 14, h = 24 },
			{ x = 276, y = 72, w = 14, h = 24 },
		},
	}
end

return room
