module<const>

-- Source basis: eac0ec35704ad84157f19ec0ed692838324f367b.
-- T/C: GlobalBank; H: state; V/W: Value planes; L/N: logical ledger.
-- K: tags; G/J: collector; S/R: StringPool.
-- The namespace owns this descriptor in RAM. The allocating caller supplies
-- admitted backing before publication. Use C++ plane-copy and barrier order.
local layout<const> = require('kernel/gc_runtime_layout') -- L:24-29,283-286 N:20-24,302-310
local arena<const> = require('kernel/dlmalloc') -- T:106 C:99 N:302-304
local barrier<const> = require('kernel/gc_barrier') -- T:107 C:98
local collector<const> = require('kernel/gc_control') -- G:191-192 J:112-113
local strings<const> = require('kernel/gc_strings') -- S:447-449 R:438-439
local hashes<const> = require('kernel/table_reinsert') -- T:61 C:48

local name_charge<const> = 9 -- T:10 C:9
local backing_slot_bytes<const> = 17 -- T:95 C:86
local integer_tag<const> = 3 -- T:61 C:48 K:9
local mark_phase<const> = 1 -- G:68
local atomic_phase<const> = 3 -- G:68

struct namespace_bank
	base: addr -- T:9,15 H:10
	capacity: u32 -- T:9,16 H:11
	count: u32 -- T:9,17 H:12
end

local bucket_for<const> = function(base, capacity, key) -- T:56-69 C:37-57
	local names<const>: *u32 = base -- T:32 H:34
	local slots<const>: *u32 = base + 4 * capacity -- T:56-57 C:37-42
	local mask<const> = 2 * capacity - 1 -- T:60 C:46-47
	local start<const> = hashes.internal.hash_canonical_table_key(integer_tag, key) & mask -- T:61 C:48
	local bucket = start -- T:62 C:49
	repeat -- T:63 C:50
		local stored<const> = slots[bucket] -- T:64 C:51
		if stored == 0 or names[(stored - 1) & (capacity - 1)] == key then return bucket end -- T:65 C:52
		bucket = (bucket + 1) & mask -- T:66 C:53
	until bucket == start -- T:67 C:54
	return start -- T:68 C:56
end

local find_name<const> = function(address, key) -- T:71-76 C:59-64
	local bank<const>: *namespace_bank = address -- T:72-75 C:60-63
	local base<const>, capacity<const> = bank.base, bank.capacity -- T:72-75 C:60-63
	if capacity == 0 then return -1 end -- T:72 C:60; signed missing ordinal
	local names<const>: *u32 = base -- T:32 H:34
	local slots<const>: *u32 = base + 4 * capacity -- T:56 C:37-39
	local bucket<const> = bucket_for(base, capacity, key) -- T:73 C:61
	local stored<const> = slots[bucket] -- T:73 C:61
	local slot<const> = (stored - 1) & (capacity - 1) -- T:74 C:62
	return stored ~= 0 and names[slot] == key and slot or -1 -- T:75 C:63
end

local grow<const> = function(address, backing, capacity) -- T:78-87 C:66-79
	local bank<const>: *namespace_bank = address -- T:79,82,84 C:67,75
	local count<const>, old<const>, prior<const> = bank.count, bank.base, bank.capacity -- T:79,82,85 C:67-68
	local names<const>: *u32 = backing -- T:79,81-82 C:69-72
	for index = 0, 3 * capacity - 1 do names[index] = 0 end -- T:81 C:70
	if count ~= 0 then -- T:82 C:71
		local source<const>: *u32 = old -- T:79,82 C:67,72
		for index = 0, count - 1 do names[index] = source[index] end -- T:82 C:72
	end
	bank.base = backing -- T:84 C:75,13
	bank.capacity = capacity -- T:84 C:75,13
	local words<const>: *u32 = backing + 12 * capacity -- T:85 C:75-77,18-19
	local tags<const>: *u8 = backing + 16 * capacity -- T:85 V:42-44 C:75-77,18-19
	local old_words<const>: *u32 = old + 12 * prior -- T:85 V:49 C:68,76,18-19
	local old_tags<const>: *u8 = old + 16 * prior -- T:85 V:49 C:68,76,18-19
	for index = 0, count - 1 do words[index] = old_words[index] end -- T:85 V:49 C:76 W:158-164
	for index = 0, count - 1 do tags[index] = old_tags[index] end -- T:85 V:49 C:76 W:158-164
	for index = count, capacity - 1 do words[index] = 0 end -- T:85 V:50 C:77 W:166-172
	for index = count, capacity - 1 do tags[index] = 0 end -- T:85 V:51 C:77 W:166-172
	local slots<const>: *u32 = backing + 4 * capacity -- T:57 C:41-42
	for slot = 0, count - 1 do -- T:86 C:78
		local bucket<const> = bucket_for(backing, capacity, names[slot]) -- T:86 C:78
		slots[bucket] = slot + 1 -- T:57 C:42
	end
end

local growth_capacity<const> = function(address) -- T:93-100 C:84-91; called on a miss
	local bank<const>: *namespace_bank = address -- T:93-94 C:84-85
	local size<const> = bank.capacity -- T:93-94 C:84-85
	if bank.count ~= size then return 0 end -- T:93,98-99 C:84,89-90; only logical admission
	return size == 0 and 8 or 2 * size -- T:94 C:85
end

local commit_name<const> = function(management, address, key, backing, capacity) -- T:92-108 C:83-100; admission and lookup belong to the caller
	local bank<const>: *namespace_bank = address -- T:93-104 C:84-96
	local old = 0 -- T:92 C:83
	if capacity ~= 0 then -- T:93 C:84
		old = bank.base -- T:96 C:87
		grow(address, backing, capacity) -- T:97 C:88
	end
	local slot<const>, base<const>, size<const> = bank.count, bank.base, bank.capacity -- T:101 C:92
	local bucket<const> = bucket_for(base, size, key) -- T:101 C:93
	local names<const>: *u32 = base -- T:102 C:94
	names[slot] = key -- T:102 C:94
	local words<const>: *u32 = base + 12 * size -- T:103 C:95,18-19
	local tags<const>: *u8 = base + 16 * size -- T:103 C:95,18-19
	words[slot] = 0 -- T:103 C:95 W:46-58
	tags[slot] = 0 -- T:103 C:95 W:46-58
	local slots<const>: *u32 = base + 4 * size -- T:57,104 C:42,96
	slots[bucket] = slot + 1 -- T:57,104 C:42,96
	bank.count = slot + 1 -- T:105 C:97

	local control<const> = management + layout.control_offset -- T:107 C:98 G:191 J:112
	local phase<const> = collector.internal.phase(control) -- G:191 J:112
	if phase >= mark_phase and phase <= atomic_phase then -- G:192-193 J:113-114; name is already a String
		local marked<const> = strings.mark(management + layout.metadata_offset, key) -- G:194 J:115 S:447-448 R:438-439
		local latch<const>: *u32 = layout.ram_base + management + layout.string_mark_work_offset -- G:185 J:108 S:449,453 R:439,443
		if marked ~= 0 then *latch = *latch + marked end -- S:449 R:439
		local work<const> = *latch -- S:453 R:443
		if work ~= 0 then -- G:185-186 J:108 S:454 R:444
			*latch = 0 -- S:454 R:444
			barrier.internal.credit_barrier_marks(control, work) -- G:186,195 J:108,116
		end
	end
	if old ~= 0 then arena.bmsx_dlmalloc_free(management + layout.arena_offset, old - layout.ram_base) end -- T:106 L:299-300 C:99 N:302-303
	local occupied<const>: *u32 = layout.ram_base + management + layout.occupied_offset -- L:285 N:24
	*occupied = *occupied + name_charge -- T:106 L:299-304 C:99 N:302-310
	return slot -- T:108 C:100
end

return {
	internal = { bucket_for = bucket_for, grow = grow },
	find_name = find_name, growth_capacity = growth_capacity, commit_name = commit_name,
	name_charge = name_charge, backing_slot_bytes = backing_slot_bytes,
}
