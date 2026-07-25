local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240()
require('cartlib/prelude')

local irq_mask<const>: *word = 0x08000010
local irq_vblank<const> = 0x0004

*irq_mask = irq_vblank
print('MONITOR FAULT PROBE BOOTED')

local nothing<const> = nil
nothing()
