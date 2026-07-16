local system<const> = require('bios/system')

local vblank<const> = {}
local irq_vblank<const> = 0x0004

bss bios_vblank_count: word

system.on_irq(irq_vblank, function()
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
