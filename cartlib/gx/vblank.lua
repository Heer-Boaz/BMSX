local vblank<const> = {}

vblank.irq_mask = 0x0004

local sequence = 0

function vblank.on_irq()
	sequence = sequence + 1
end

function vblank.wait()
	local current<const> = sequence
	repeat
		halt_until_irq
	until sequence ~= current
end

return vblank
