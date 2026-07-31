module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
gx_gpu.reset_320x240()
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch
local irq_mask_register<const>: *word = 0x08000008
local inp_ctrl_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0

function init()
	irq_module.register(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
end

function new_game()
end

local update_cart<const> = function()
end

local draw_cart<const> = function()
	gx_gpu.clear_color(0xff000000)
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

init()
*irq_mask_register = irq_vblank
new_game()
*inp_ctrl_register = 0x00000001
wait_vblank()

while true do
	update_cart()
	*inp_ctrl_register = 0x00000001
	wait_vblank()
	draw_cart()
end
