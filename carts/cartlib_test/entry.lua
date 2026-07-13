local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240_pal()
require('cartlib/prelude')

local irq_mask_register<const>: *word = 0x08000010
local input_control_register<const>: *word = 0x0800006c
local irq_vblank<const> = 0x0004
local vblank_count = 0
cartlib_test_ready = false

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

reset()
add_space('main')
set_space('main')
*irq_mask_register = irq_vblank
*input_control_register = 0x00000001
wait_vblank()
cartlib_test_ready = true

while true do
	update_world()
	wait_vblank()
	gx_clear_color(0xff000000)
	draw_world()
	*input_control_register = 0x00000001
end
