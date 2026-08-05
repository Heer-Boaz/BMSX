-- Player-input frame system. The system owns when the ICU snapshots the next
-- host input frame; carts consume PlayerInput actions and never program the
-- controller latch themselves.

local player_input<const> = require('cartlib/input/player')
local system_module<const> = require('cartlib/world/system')

local system<const> = system_module.system
local tick_group<const> = system_module.tick_group

local input_control<const>: *word = 0x08000064
local input_sample_next_vblank<const> = 0x00000001

local player_input_system<const> = {}
player_input_system.__index = player_input_system
setmetatable(player_input_system, { __index = system })

function player_input_system.new()
	*input_control = input_sample_next_vblank
	return setmetatable(system.new(tick_group.input, -200), player_input_system)
end

function player_input_system:update()
	player_input.advance_frame()
	*input_control = input_sample_next_vblank
end

return player_input_system
