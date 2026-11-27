module<const>

-- Source basis 57945b221: CPU image binding resolves String constants in pool
-- order (TS cpu.ts:997-1010,1155-1161; C++ cpu.cpp:290-305). It also publishes
-- just the resolved RAM ids in that same order (TS:5392-5394,5465-5469;
-- C++:3286-3289,3363-3364). Both projections now share the original backing.
local strings<const> = require('kernel/string_record')
local ordinal_ram_bit<const> = 1 -- image_format.{h,ts}: String records align to 8 bytes

struct installed_image_binding
	base: addr
	bytes: u32
	strings: addr
	ram_strings: u32
end

local store_binding<const> = function(base, count, slot, ram_count, id)
	local words<const>: *u32 = base
	local ram<const> = strings.is_ram_string_id(id) and ordinal_ram_bit or 0
	local right<const> = count - 1 - (slot - ram_count)
	local destination<const> = ram ~= 0 and ram_count or right
	if destination == slot then
		-- The source and destination writes coincide.
		words[slot] = id | ram
	else
		-- A processed ordinal owns the low bit of its physical word, even
		-- if that word's payload belongs to a different String.
		local ordinal_bit<const> = destination < slot and (words[destination] & ordinal_ram_bit) or 0
		words[destination] = id | ordinal_bit
		-- Read a source payload only if an earlier ordinal has placed it.
		-- Unwritten allocation bytes are never read, including on reuse.
		local placed<const> = (slot < ram_count or slot > right) and (words[slot] & ~ordinal_ram_bit) or 0
		words[slot] = placed | ram
	end
	return ram_count + ram
end

return { store_binding = store_binding, ordinal_ram_bit = ordinal_ram_bit }
