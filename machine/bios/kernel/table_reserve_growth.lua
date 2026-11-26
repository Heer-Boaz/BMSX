module<const>

-- Source basis: 9d878caf4ee677bdff65b798b51f97b253e9740b.
-- T/C/H Table; A/B allocator binding; M RAM. The admitted plan and
-- collector assist belong to the caller. The two success words transport
-- the original local addresses, without publishing Table fields or charge.
local arena<const> = require('kernel/dlmalloc') -- T:805-806,811-814 C:255,262-265 A:56-68 B:54-66
local ram_base<const> = 0x08000000 -- A:58,61-68 B:56,59-66 M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9 T:120 C:255,257; record-port address decode
local sign_bit<const> = 0x80000000 -- T:810 C:260; unsigned order of the record capacity

struct growth_table_header
	before_hash: u32[3] -- T:33-34 H:26-27
	hash_storage: addr -- T:34,137 H:27,55
	array_slots: u32 -- T:34,132 H:27,57
	before_array_storage: u32[3] -- T:33-34 H:26-27
	array_storage: addr -- T:34,52,136 H:27,43,56
end

struct table_growth_result
	hash_storage: addr -- T:806,823 C:255,274,280; retained/allocated local
	array_storage: addr -- T:809,824 C:258,274,280; retained/allocated local
end

local reserve_table_growth<const> = function(state, table_address, array_slots, hash_slots, hash_bytes, keep_hash, staged_growth, result_offset) -- T:801-802 C:248-250
	local record<const>: *growth_table_header = ram_base + (table_address & ram_word_mask) -- T:120,803-804,808 C:255,257 M:9
	local storage = 0 -- T:806 C:255
	if keep_hash ~= 0 then -- T:806 C:255
		storage = record.hash_storage -- T:804,806,137 H:55 C:255
	elseif hash_slots ~= 0 then -- T:806 C:255
		local reserved<const> = arena.bmsx_dlmalloc_allocate(state, hash_bytes, 0) -- T:98,806 C:255 H:48 A:56-57 B:54-55; caller's hashStorageBytes extent
		if reserved ~= 0 then storage = ram_base + reserved end -- T:806 C:255 A:58 B:56
	end
	if hash_slots ~= 0 and storage == 0 then return 0 end -- T:807 C:256
	-- TS samples the old array extent before reserving hash; C++ reads it
	-- here. The admitted Table record is disjoint from allocator mutations.
	local old_slots<const> = record.array_slots -- T:803,132 C:257 H:57
	local old_base<const> = record.array_storage -- T:808,136 C:257 H:56
	local base = old_base -- T:809 C:258
	if (array_slots ~ sign_bit) > (old_slots ~ sign_bit) then -- T:808,810 C:259-260; caller already computed the original stagedGrowth selector
		local bytes<const> = array_slots * 5 -- T:811-812 C:261
		local reserved = 0 -- T:811-812 C:262-263; allocator returns a RAM offset or zero
		if old_base == 0 then -- T:811 C:262
			reserved = arena.bmsx_dlmalloc_allocate(state, bytes, 0) -- T:811 C:262 A:56-57 B:54-55
		elseif staged_growth ~= 0 then -- T:808,811-812 C:259,262-263
			reserved = arena.bmsx_dlmalloc_reserve_backing(state, old_base - ram_base, bytes) -- T:812 C:263 A:62-63 B:60-61
		else -- T:812 C:263
			reserved = arena.bmsx_dlmalloc_resize_backing(state, old_base - ram_base, bytes) -- T:812 C:263 A:66-67 B:64-65
		end
		if reserved == 0 then -- T:813 C:264
			if storage ~= 0 and keep_hash == 0 then -- T:814 C:265
				arena.bmsx_dlmalloc_free(state, storage - ram_base) -- T:814 C:265 A:61 B:59
			end
			return 0 -- T:815 C:266
		end
		base = ram_base + reserved -- T:811-812 C:262-263 A:58,64,68 B:56,62,66
	end
	local result<const>: *table_growth_result = ram_base + result_offset -- T:823-824 C:274,280; caller's continuation stores the original locals
	result.hash_storage = storage -- T:823 C:274,280
	result.array_storage = base -- T:824 C:274,280
	return 1 -- T:818,828-829 C:269,277,280; the caller owns the next algorithmic step
end

return { reserve_table_growth = reserve_table_growth }
