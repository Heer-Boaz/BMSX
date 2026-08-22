-- Player-input clock owner. The frame tick samples the next raw ICU snapshot;
-- the gameplay tick advances only that action-evaluation boundary. Carts consume
-- explicitly clock-bound actions and never program the controller latch.

local input<const> = require('cartlib/input/input')
local icu<const> = require('cartlib/input/icu')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')


local input_control<const>: *word = icu.control_address

local input_system<const> = {}
input_system.__index = input_system
setmetatable(input_system, { __index = base_system })
input_system.frame_tick = {
	group = tick_group.input,
	priority = -200,
	clock_source = clock.frame,
	method = 'update_frame',
}
input_system.gameplay_tick = {
	group = tick_group.input,
	priority = -199,
	clock_source = clock.gameplay,
	method = 'update_gameplay',
	prerequisites = { input_system.frame_tick },
	on_clock_resumed = input.synchronize_gameplay_clock,
}

function input_system.new()
	*input_control = icu.sample_next_vblank
	local self<const> = setmetatable(base_system.new(input_system.frame_tick), input_system)
	self:add_tick_function(input_system.gameplay_tick)
	return self
end

function input_system:update_frame()
	input.advance_frame()
	*input_control = icu.sample_next_vblank
end

function input_system:update_gameplay()
	input.advance_gameplay()
end

return input_system
