module<const>

local heap<const> = require('kernel/gc_full')
local startup<const> = require('bmsx/startup')
local storage<const> = require('kernel/thread_frame_storage')

local inhibit_reset<const> = 0x100

local enter<const> = function()
	cop0.status = cop0.status & ~inhibit_reset
	heap.collect_full()
	-- EXEC discards the old windows. Prepare its zero-based frame and
	-- one exception control slot after the collector can compact backing.
	storage.reserve_system_entry(startup.managed_entry_slots)
	cop0.exec = startup.managed_entry
end

return { enter = enter }
