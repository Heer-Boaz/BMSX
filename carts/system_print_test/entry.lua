module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
gx_display.reset_320x240()
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch

local irq_mask<const>: *word = 0x08000008
local irq_vblank<const> = 0x0004
local framebuffer_size<const> = 320 | (240 << 16)
local vblank_count = 0

irq_module.register(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

*irq_mask = irq_vblank
print('CART PRINT')

while true do
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
	gx_gpu.clear_color(0, framebuffer_size, 0xff281408)
end
