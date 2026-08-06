-- Player-input frame system. The system owns when the ICU snapshots the next
-- host input frame; carts consume input actions and never program the
-- controller latch themselves.

local input<const> = require('cartlib/input/input')
local basesystem<const> = require('cartlib/world/basesystem')
local tickgroup<const> = require('cartlib/world/tickgroup')


local input_control<const>: *word = 0x08000064
local input_sample_next_vblank<const> = 0x00000001

local inputsystem<const> = {}
inputsystem.__index = inputsystem
setmetatable(inputsystem, { __index = basesystem })

function inputsystem.new()
	*input_control = input_sample_next_vblank
	return setmetatable(basesystem.new(tickgroup.input, -200), inputsystem)
end

function inputsystem:update()
	input.advance_frame()
	*input_control = input_sample_next_vblank
end

return inputsystem
