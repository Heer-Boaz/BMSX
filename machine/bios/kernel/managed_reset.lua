module<const>

local heap<const> = require('kernel/gc_full')
local startup<const> = require('bmsx/startup')

local inhibit_reset<const> = 0x100

local enter<const> = function()
	cop0.status = cop0.status & ~inhibit_reset
	heap.collect_full()
	cop0.exec = startup.managed_entry
end

return { enter = enter }
