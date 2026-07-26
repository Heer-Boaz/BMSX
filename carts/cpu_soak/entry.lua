local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240()
require('cartlib/prelude')

local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0

cpu_soak_checksum = 0

local state<const> = {
	0x13579bdf,
	0x2468ace0,
	0x10203040,
	0x55667788,
}

local mix<const> = function(left, right)
	local value<const> = (left ~ (right << 7)) + 0x9e3779b9
	return ((value << 11) ~ (value >> 9)) & 0x7fffffff
end

local run_round<const> = function()
	local a<const> = mix(state[1], state[4])
	local b<const> = mix(state[2], a)
	local c<const> = mix(state[3], b)
	local d<const> = mix(state[4], c)
	state[1] = b
	state[2] = c
	state[3] = d
	state[4] = a
	return a ~ b ~ c ~ d
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)
*irq_mask_register = irq_vblank
*input_control_register = 0x00000001

while true do
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1

	local round = 0
	while round < 1024 do
		cpu_soak_checksum = run_round()
		round = round + 1
	end
	*input_control_register = 0x00000001
end
