module<entry>
local gx_display<const> = require('cartlib/gx/display')
gx_display.reset_320x240()
require('cartlib/irq')

local irq_mask<const>: *word = 0x08000008
local irq_vblank<const> = 0x0004

*irq_mask = irq_vblank
print('MONITOR FAULT PROBE BOOTED')

local nothing<const> = nil
nothing()
