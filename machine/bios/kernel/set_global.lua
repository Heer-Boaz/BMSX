module<const>

-- Source basis: f72579c7f15795cedbd00f71ed7edd94dda5aeb5.
-- C/T: CPU; B/G: GlobalBank; H: LuaHeap; F: fault values; M: machine namespace.
local layout<const> = require('kernel/gc_runtime_layout') -- M:15
local names<const> = require('kernel/global_bank') -- B:59-101 G:71-109
local admission<const> = require('kernel/boot_image_admission') -- B:85-92 G:97-104 H:101-109,172-178

local string_tag<const> = 5 -- C:1321 T:4652
local invalid_argument<const> = 10 -- F:61 C:1321 T:4652-4653
local out_of_memory<const> = 9 -- F:60 C:2718-2720

local assign_name<const> = function(key, key_tag, payload, value_tag) -- C:1320,1322-1323 T:4651,4655-4659; System vector uses original payload and tag planes, CALL fills absent formals with Nil
	if key_tag ~= string_tag then return invalid_argument end -- C:1321 T:4652-4654
	local management<const> = layout.management_offset -- C:637 T:2970
	local state<const> = layout.ram_base + management -- M:13-16 B:80-81
	local bank<const> = state + layout.ordinary_global_bank_offset -- M:15 B:80-81 G:90-92
	local slot = names.find_name(bank, key) -- C:637 T:2970 B:82 G:93-94
	if slot < 0 then -- B:82-85 G:94-97
		local capacity<const> = names.growth_capacity(bank) -- B:85-86 G:97-98
		local accepted<const>, offset<const> = admission.reserve(management, 0, key, names.name_charge, -- B:85-93 G:97-105 H:84-90,101-109,172-178
			names.backing_slot_bytes * capacity, false, cop0.event_cycles, value_tag, payload)
		if not accepted then return out_of_memory end -- H:95-106,175-177 C:2718-2720
		slot = names.commit_name(management, bank, key, layout.ram_base + offset, capacity) -- B:88-101 G:100-113
	end
	names.write_slot(management, bank, slot, value_tag, payload) -- C:638 T:2971 G:22-26
end

return { assign_name = assign_name }
