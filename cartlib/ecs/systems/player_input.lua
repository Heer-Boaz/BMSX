-- Player-input frame system. The system owns when the ICU snapshots the next
-- host input frame; carts consume PlayerInput actions and never program the
-- controller latch themselves.

local ecs<const> = require('cartlib/ecs')
local player_input<const> = require('cartlib/input/player')

local input_control<const>: *word = 0x08000064
local input_sample_next_vblank<const> = 0x00000001

local player_input_system<const> = {}
player_input_system.__index = player_input_system
setmetatable(player_input_system, { __index = ecs.system })

function player_input_system.new(priority)
	*input_control = input_sample_next_vblank
	return setmetatable(ecs.system.new(ecs.tick_group.input, priority or -200), player_input_system)
end

function player_input_system:update()
	player_input.advance_frame()
	*input_control = input_sample_next_vblank
end

return player_input_system.new
