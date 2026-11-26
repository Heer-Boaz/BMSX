module<const>

-- Source basis: 04c10f896545d453bd50fe27ccb619b269966607.
-- T/C/H: mirrored GcHeap and C++ declarations; L: policy constants;
-- A/B/D: allocator; M: RAM. Consumes the existing VBlank opportunity;
-- dispatch and the admitted collector quantum are separate owners.
local gc<const> = require('kernel/gc_control') -- T:891,893-901 C:931,933-942 H:44-47,57,97
local admission<const> = require('kernel/heap_admission') -- T:905 C:947 A:50,52 B:29-31 D:49
local arena<const> = require('kernel/dlmalloc') -- T:892 C:932 A:51 D:50
local wide<const> = require('kernel/word_arithmetic') -- T:905 C:946-947; widen the projected demand before comparing
local ram_base<const> = 0x08000000 -- M:6
local mark<const> = 1 -- T:70,908 H:20 C:951
local mark_again<const> = 2 -- T:70,908 H:20 C:951
local atomic<const> = 3 -- T:70,896 H:20 C:937
local step_words<const> = 4096 -- T:904,909 H:18 L:16 C:946,952
local step_shift<const> = 12 -- T:904 H:18 C:946; log2(GC_STEP_WORDS)
local sign_bit<const> = 0x80000000 -- T:898,902,905 C:939,943,947; unsigned word order

local admit_vblank_collection<const> = function(state, waiting, rebuilding) -- T:889 C:929
	if rebuilding ~= 0 then return 0 end -- T:890 C:930; active Table rebuild owns its backing
	local control<const> = state + admission.internal.control_delta -- A:8,10,25 B:13 D:20
	local base<const> = ram_base + control -- T:893-894,897,900-901 C:933-934,938,942 H:97
	local full_epochs<const>: *u8 = base + gc.internal.full_epochs_offset -- T:57-58,891,1128 C:931 H:57,97
	if *full_epochs ~= 0 then return 0 end -- T:891 C:931
	local occupied<const> = arena.bmsx_dlmalloc_occupied_bytes(state) -- T:892 C:932 A:51 D:50
	local sample<const>: *u32 = base + gc.internal.physical_occupied_at_tick_offset -- T:48,893-894 C:933-934 H:46
	local previous_occupied<const> = *sample -- T:893 C:933
	if occupied ~= previous_occupied then *sample = occupied end -- T:894 C:934
	local current<const> = gc.internal.phase(control) -- T:895 C:936
	if current == atomic then return 0 end -- T:896 C:937
	local assist<const>: *u32 = base + gc.internal.physical_assist_offset -- T:49,897 C:938 H:47
	if *assist == 0 then -- T:897 C:938
		if (occupied ~ sign_bit) <= (previous_occupied ~ sign_bit) then return 0 end -- T:898 C:939
		local demand<const> = occupied - previous_occupied -- T:899 C:940
		local epoch_work<const>: *u32 = base + gc.internal.epoch_work_offset -- T:46,900 C:908-909,941 H:44
		local last_epoch_work<const>: *u32 = base + gc.internal.last_epoch_work_offset -- T:47,901 C:942 H:45
		local completed<const>, previous<const> = *epoch_work, *last_epoch_work -- T:900-901 C:941-942
		local remaining<const> = (previous ~ sign_bit) > (completed ~ sign_bit) and previous - completed or 0 -- T:902 C:943
		local partial<const> = (remaining & (step_words - 1)) ~= 0 and 1 or 0 -- T:904 C:946; C++ ceil without word overflow
		local quanta<const> = (remaining >> step_shift) + partial + 3 -- T:903-904 C:944-946
		local free<const> = admission.heap_capacity(state) - occupied -- T:905 C:947 A:52 B:31
		local high<const>, low<const> = wide.multiply_add_words(demand, quanta, 0) -- T:905 C:947
		if high == 0 and (free ~ sign_bit) > (low ~ sign_bit) then return 0 end -- T:905 C:947
		*assist = 1 -- T:906 C:948
	end
	-- Waiting is the interrupted CPU state, not the IRQ handler's own state.
	local idle_mark<const> = (current == mark or current == mark_again) and waiting ~= 0 -- T:908 C:951
	return idle_mark and 4 * step_words or step_words -- T:909-910 C:952-953; the caller runs this quantum
end

return { admit_vblank_collection = admit_vblank_collection }
