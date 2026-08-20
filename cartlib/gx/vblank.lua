local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')

local vblank<const> = {}

local sequence = 0

local on_vblank_irq<const> = function()
	sequence = sequence + 1
end

local function init_vblank_irq<init>()
	irq.register(irq_source.vblank, on_vblank_irq)
end
init_vblank_irq()

function vblank.wait()
	local current<const> = sequence
	repeat
		halt_until_irq
	until sequence ~= current
end

return vblank
