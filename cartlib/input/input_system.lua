-- Player-input frame system. The system owns when the ICU snapshots the next
-- host input frame; carts consume input actions and never program the
-- controller latch themselves.

local input<const> = require('cartlib/input/input')
local icu<const> = require('cartlib/input/icu')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')


local input_control<const>: *word = icu.control_address

local input_system<const> = {}
input_system.__index = input_system
setmetatable(input_system, { __index = base_system })
input_system.tick = {
	group = tick_group.input,
	priority = -200,
	clock_source = clock.frame,
	method = 'update',
}

function input_system.new()
	*input_control = icu.sample_next_vblank
	return setmetatable(base_system.new(input_system.tick), input_system)
end

function input_system:update()
	input.advance_frame()
	*input_control = icu.sample_next_vblank
end

return input_system
