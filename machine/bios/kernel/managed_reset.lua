module<const>

local heap_control<const> = require('kernel/heap_control_ids')
local startup<const> = require('bmsx/startup')

local inhibit_reset<const> = 0x100

local enter<const> = function()
	cop0.status = cop0.status & ~inhibit_reset
	blua32.svc(heap_control.collect_full)
	-- EXEC discards the old windows. Prepare its zero-based frame and
	-- one exception control slot after the collector can compact backing.
	blua32.svc_value(heap_control.reserve_entry, startup.managed_entry_slots)
	cop0.exec = startup.managed_entry
end

return { enter = enter }
