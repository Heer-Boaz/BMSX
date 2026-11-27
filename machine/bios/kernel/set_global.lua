module<const>

-- Source basis: f72579c7f15795cedbd00f71ed7edd94dda5aeb5.
-- C/T: CPU; B/G: GlobalBank; H: LuaHeap; F: fault values; M: machine namespace.
local layout<const> = require('kernel/gc_runtime_layout') -- M:15
local names<const> = require('kernel/global_bank') -- B:59-101 G:71-109
local admission<const> = require('kernel/boot_image_admission') -- B:85-92 G:97-104 H:101-109,172-178

local string_tag<const> = 5 -- C:1321 T:4652
local invalid_argument<const> = 10 -- F:61 C:1321 T:4652-4653
local out_of_memory<const> = 9 -- F:60 C:2718-2720

local set_global<const> = function(name, replacement) -- C:1320-1323 T:4651-4659
	local port<const>: *u32 = layout.management_address -- C:1320 T:4651; use the existing ordinary CALL activation
	local fault<const>: *u32 = layout.call_fault_address -- F:60-61 C:1321,2718-2720
	local management<const> = *port -- C:637 T:2970; existing address of the bank owner
	local state<const> = layout.ram_base + management -- M:13-16 B:80-81
	local cell<const>: *value = state + layout.value_cell_offset -- C:1321-1322 T:4652-4657; use the existing tagged exchange
	local word<const>: *u32 = state + layout.value_cell_offset -- C:1322 T:4655
	local tag<const>: *u8 = state + layout.value_cell_offset + layout.value_cell_tag_offset -- C:1321 T:4652
	*cell = name -- C:1321-1322 T:4652-4655
	if *tag ~= string_tag then -- C:1321 T:4652-4654
		*fault = invalid_argument -- C:1321 T:4653
		return -- C:1321 T:4653
	end
	local key<const> = *word -- C:1322 T:4655
	*cell = replacement -- C:1322 T:4656-4657; an omitted argument is Nil
	local value_tag<const>, payload<const> = *tag, *word -- C:1322 T:4656-4657 G:22-24
	local bank<const> = state + layout.ordinary_global_bank_offset -- M:15 B:80-81 G:90-92
	local slot = names.find_name(bank, key) -- C:637 T:2970 B:82 G:93-94
	if slot < 0 then -- B:82-85 G:94-97
		local capacity<const> = names.growth_capacity(bank) -- B:85-86 G:97-98
		local allowance<const>: *u32 = layout.call_cycles_address -- H:84-90; retain the source grant's original policy budget
		local accepted<const>, offset<const> = admission.reserve(management, 0, key, names.name_charge, -- B:85-93 G:97-105 H:101-109,172-178
			names.backing_slot_bytes * capacity, false, *allowance, value_tag, payload)
		if not accepted then -- H:95-106,175-177 C:2718-2720
			*fault = out_of_memory -- F:60 C:2718-2720
			return -- C:2718-2720 H:175-177
		end
		slot = names.commit_name(management, bank, key, layout.ram_base + offset, capacity) -- B:88-101 G:100-113
	end
	names.write_slot(management, bank, slot, value_tag, payload) -- C:638 T:2971 G:22-26
end

return { set_global = set_global }
