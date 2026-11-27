local interrupts<const> = require('kernel/interrupts')

local vblank<const> = {}

local bios_vblank_count<const>: *word = interrupts.vblank_count

function vblank.clear()
	*bios_vblank_count = 0
end

function vblank.wait()
	while *bios_vblank_count == 0 do
		halt_until_irq
	end
	*bios_vblank_count = *bios_vblank_count - 1
end

return vblank
