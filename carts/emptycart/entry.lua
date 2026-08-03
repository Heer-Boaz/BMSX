module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
gx_display.reset_320x240()
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch
local irq_mask_register<const>: *word = 0x08000008
local inp_ctrl_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local framebuffer_size<const> = 320 | (240 << 16)
local vblank_count = 0

local on_vblank_irq<const> = function()
	vblank_count = vblank_count + 1
end

local update_cart<const> = function()
end

local draw_cart<const> = function()
	gx_gpu.clear_color(0, framebuffer_size, 0xff000000)
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

local function bind_vblank_irq<init>()
	irq_module.register(irq_vblank, on_vblank_irq)
end
*irq_mask_register = irq_vblank
*inp_ctrl_register = 0x00000001
wait_vblank()

while true do
	update_cart()
	*inp_ctrl_register = 0x00000001
	wait_vblank()
	draw_cart()
end
