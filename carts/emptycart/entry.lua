local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240_pal()
require('cartlib/prelude')
local irq_mask_register<const>: *word = 0x0800010c
local inp_ctrl_register<const>: *word = 0x08000194
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0

function init()
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
end

function new_game()
end

local update_cart<const> = function()
end

local draw_cart<const> = function()
	gx_clear_color(0xff000000)
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

init()
*irq_mask_register = irq_vblank | irq_apu
new_game()
*inp_ctrl_register = 0x00000001
wait_vblank()

while true do
	update_cart()
	*inp_ctrl_register = 0x00000001
	wait_vblank()
	draw_cart()
end
