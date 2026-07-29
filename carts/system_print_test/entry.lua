module<entry>
local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240()
require('cartlib/prelude')

local irq_mask<const>: *word = 0x08000008
local irq_vblank<const> = 0x0004
local vblank_count = 0

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

*irq_mask = irq_vblank
print('CART PRINT')

while true do
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
	gx_clear_color(0xff281408)
end
