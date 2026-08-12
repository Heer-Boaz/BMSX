-- Player-input frame system. The system owns when the ICU snapshots the next
-- host input frame; carts consume input actions and never program the
-- controller latch themselves.

local input<const> = require('cartlib/input/input')
local base_system<const> = require('cartlib/world/base_system')
local tick_group<const> = require('cartlib/world/tick_group')


local input_control<const>: *word = 0x08000064
local input_sample_next_vblank<const> = 0x00000001

local input_system<const> = {}
input_system.__index = input_system
setmetatable(input_system, { __index = base_system })

function input_system.new()
	*input_control = input_sample_next_vblank
	return setmetatable(base_system.new(tick_group.input, -200), input_system)
end

function input_system:update()
	input.advance_frame()
	*input_control = input_sample_next_vblank
end

return input_system
