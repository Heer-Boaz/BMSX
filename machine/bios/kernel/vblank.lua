local interrupts<const> = require('kernel/interrupts')
local irq<const> = require('kernel/vblank_irq')

local vblank<const> = {}

bss bios_vblank_count: word

interrupts.on(irq.source, function()
	*bios_vblank_count = *bios_vblank_count + 1
end)

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
