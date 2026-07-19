local gx_gpu<const> = require('system/gx_gpu')
local gx_gte<const> = require('system/gx_gte')
local gx_gte_plus<const>: *word[10] = gx_gte.plus
gx_gpu.reset_320x240()
require('cartlib/prelude')

local gx_gte_plus_vmad3<const> = gx_gte.plus_opcode_vmad3
gx_gte_plus[0] = 0x00020001
gx_gte_plus[1] = 3
gx_gte_plus[2] = 0
gx_gte_plus[3] = 0
gx_gte_plus[4] = 0
gx_gte_plus[8] = gx_gte_plus_vmad3
gx_gte_plus[0] = 0xfff50015
gx_gte_plus[8] = gx_gte_plus_vmad3
while (gx_gte_plus[9] & 0x80000000) ~= 0 do
end
assert(gx_gte_plus[5] == 0xfff50015 and gx_gte_plus[6] == 3, 'GTE+ blocked command retry mismatch')
cartlib_test_gte_plus_interlock_ready = true

cartlib_test_gte_plus_x, cartlib_test_gte_plus_y, cartlib_test_gte_plus_z = gx_gte.vmad3(10, -20, 30, 8, 12, -4, -0x0800)
assert(cartlib_test_gte_plus_x == 6 and cartlib_test_gte_plus_y == -26 and cartlib_test_gte_plus_z == 32, 'GTE+ firmware VMAD3 result mismatch')
assert(gx_gte_plus[5] == 0xffe60006 and gx_gte_plus[6] == 32, 'GTE+ result latches mismatch')
assert(gx_gte_plus[7] == 0 and gx_gte_plus[9] == 5, 'GTE+ completion latches mismatch')
cartlib_test_gte_plus_ready = true

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
