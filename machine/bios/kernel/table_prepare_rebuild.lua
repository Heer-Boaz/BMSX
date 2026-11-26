module<const>

-- Source basis: edfe988ff624b541b9162691b5d8bdae295b70bc.
-- T/C: TableRecords.advanceRebuild and TableRecord::advanceRebuild;
-- H/J: Table and rebuild layouts; V/W: Values; M: RAM.
-- The allowance is the original rebuilding policy's work budget, not
-- an instruction quota. The caller still owns both placement passes,
-- the deferred shrink, and final publication.
local fill<const> = require('kernel/table_create') -- T:954,958,968,981-982,992 C:31,35,44,57-58,68
local slots<const> = require('kernel/table_reinsert') -- T:997,999-1000 C:63,74-75 H:258-262
local allocator<const> = require('kernel/dlmalloc') -- T:102,994 C:70 H:274
local ram_base<const> = 0x08000000 -- T:932 M:6; private record port
local ram_word_mask<const> = 0x003ffffc -- M:7-9 T:942-943 H:247,312
local integer_tag<const> = 3 -- V:9-11 W:21-23
local census_limit<const> = 64 -- T:96,987-989 H:45 C:64-65
local byte_link_capacity<const> = 128 -- T:95,98 H:44,47
local band_capacity<const> = 1024 -- T:97,990 H:46 C:66

struct rebuild_array_header
	before_array: u32[4] -- T:35-36 H:26-27
	array_slots: u32 -- T:36,133,935 H:27,57 C:10
	before_array_storage: u32[3] -- T:35-36 H:26-27
	array_storage: addr -- T:36,137,936 H:27,56 C:14
end

struct rebuild_prepare_job
	source: addr -- T:43,988 J:13 C:8,65
	count: u32 -- T:43,988-989 J:13 C:8,65
	storage: addr -- T:43,980 J:13 C:8,59
	capacity: u32 -- T:43,934 J:13 C:9
	array_storage: addr -- T:44,936 J:14 C:11,15
	array_slots: u32 -- T:44,935 J:14 C:10
	array_cleared: u32 -- T:44,940,973 J:14 C:19,49
	cleared: u32 -- T:45,977,984 J:15 C:53,60
	key_tag: u32 -- T:46,994,999 J:16 C:13,63,74 V:23 W:29
	key_word: u32 -- T:46,994,999 J:16 C:13,63,74 V:24 W:30
	value_tag: u32 -- T:46,1000 J:16 C:75 V:23 W:29
	value_word: u32 -- T:46,1000 J:16 C:75 V:24 W:30
end

local transfer_extent<const> = function(left, allowance) -- T:941,978 C:20-21,54
	if allowance >= (left + 15) >> 4 then return left end -- T:941,978 C:21,54; compare before multiplying the policy allowance
	return allowance << 4 -- T:941,978 C:21,54
end

-- Both addresses have the same alignment: their displacement is either
-- a word-plane change or an integral number of words in a tag plane.
local move_extent<const> = function(target, source, bytes) -- T:953,964,967 C:30,41,43
	if target > source and target - source < bytes then -- T:953 C:30; overlap in an in-place tag batch
		local at = bytes -- T:953 C:30
		while at > 0 and ((target + at) & 3) ~= 0 do -- T:953 C:30
			at = at - 1 -- T:953 C:30
			local from<const>: *u8 = ram_base + source + at -- T:953 C:30
			local to<const>: *u8 = ram_base + target + at -- T:953 C:30
			*to = *from -- T:953,955 C:30,32; track the changed byte
		end
		while at >= 4 do -- T:953 C:30
			at = at - 4 -- T:953 C:30
			local from<const>: *u32 = ram_base + source + at -- T:953 C:30
			local to<const>: *u32 = ram_base + target + at -- T:953 C:30
			*to = *from -- T:953,955 C:30,32
		end
		for i = at - 1, 0, -1 do -- T:953 C:30
			local from<const>: *u8 = ram_base + source + i -- T:953 C:30
			local to<const>: *u8 = ram_base + target + i -- T:953 C:30
			*to = *from -- T:953,955 C:30,32
		end
	else -- T:953,964,967 C:30,41,43
		local at = 0 -- T:953,964,967 C:30,41,43
		while at < bytes and ((target + at) & 3) ~= 0 do -- T:953,964,967 C:30,41,43
			local from<const>: *u8 = ram_base + source + at -- T:953,964,967 C:30,41,43
			local to<const>: *u8 = ram_base + target + at -- T:953,964,967 C:30,41,43
			*to = *from -- T:953,955,964,967,972 C:30,32,41,43,48
			at = at + 1 -- T:953,964,967 C:30,41,43
		end
		while at + 4 <= bytes do -- T:953,964,967 C:30,41,43
			local from<const>: *u32 = ram_base + source + at -- T:953,964,967 C:30,41,43
			local to<const>: *u32 = ram_base + target + at -- T:953,964,967 C:30,41,43
			*to = *from -- T:953,955,964,967,972 C:30,32,41,43,48
			at = at + 4 -- T:953,964,967 C:30,41,43
		end
		for i = at, bytes - 1 do -- T:953,964,967 C:30,41,43
			local from<const>: *u8 = ram_base + source + i -- T:953,964,967 C:30,41,43
			local to<const>: *u8 = ram_base + target + i -- T:953,964,967 C:30,41,43
			*to = *from -- T:953,955,964,967,972 C:30,32,41,43,48
		end
	end
end

local transfer_array<const> = function(target, source, old_array, array, in_place, transfer, first, last) -- T:942-971 C:22-47
	if in_place then -- T:944 C:23
		local payload_end<const> = transfer - (array - old_array) -- T:946 C:25
		local at = first -- T:947 C:26
		while at < last do -- T:947 C:26
			local boundary<const> = at < old_array and old_array or (at < payload_end and payload_end or transfer) -- T:948 C:27
			local next<const> = last < boundary and last or boundary -- T:948 C:27
			local dest<const> = target + (at < old_array and 4 * array + old_array - next -- T:949 C:28
				or (at < payload_end and 4 * old_array + at - old_array or 4 * array + old_array + at - payload_end)) -- T:950 C:29
			if at < old_array then -- T:951 C:30
				local from<const> = target + 5 * old_array - next -- T:952 C:30
				move_extent(dest, from, next - at) -- T:953,955 C:30,32
			else -- T:954 C:31
				fill.internal.fill_backing(dest, dest + next - at, 0) -- T:954-955 C:31-32
			end
			at = next -- T:956 C:33
		end
	elseif old_array == 0 then -- T:958 C:35
		fill.internal.fill_backing(target + first, target + last, 0) -- T:958,972 C:35,48
	else -- T:959-960 C:36-37
		local at = first -- T:961 C:38
		while at < last do -- T:961 C:38
			local boundary<const> = at < old_array * 4 and old_array * 4 or (at < array * 4 and array * 4 -- T:962 C:39
				or (at < array * 4 + old_array and array * 4 + old_array or 5 * array)) -- T:963 C:40
			local next<const> = last < boundary and last or boundary -- T:962-963 C:39-40
			if at < old_array * 4 then -- T:964 C:41
				move_extent(target + at, source + at, next - at) -- T:964,972 C:41,48
			elseif at >= array * 4 and at < array * 4 + old_array then -- T:965 C:42
				local tag<const> = source + old_array * 4 + (at - array * 4) -- T:966 C:43
				move_extent(target + at, tag, next - at) -- T:967,972 C:43,48
			else -- T:968 C:44
				fill.internal.fill_backing(target + at, target + next, 0) -- T:968,972 C:44,48
			end
			at = next -- T:969 C:45
		end
	end
end

local initialize_hash_trigger<const> = function(job_address, array, storage, capacity, bytes) -- T:987-1001 C:63-76
	local job<const>: *rebuild_prepare_job = job_address -- T:988-1000 C:63-75
	local kt<const>, kw<const> = job.key_tag, job.key_word -- T:936,994,997,999 C:13,63,70,74
	local in_array<const> = kt == integer_tag and kw > 0 and kw - 1 < array -- T:188-191,936,989,1003 C:13,65,73 H:200-202; native absent index is UINT32_MAX
	if capacity > census_limit then -- T:987 C:64
		local count<const> = job.count -- T:988-989 C:65
		local live = 0 -- T:989 C:65
		if count > census_limit then -- T:989 C:65
			local source<const>: *u32 = ram_base + (job.source & ram_word_mask) + count * (count <= byte_link_capacity and 11 or 14) -- T:98,988-989 C:8,65 H:47,269-270,312
			live = *source -- T:989 C:65 H:270
		end
		local live_word<const>: *u32 = ram_base + storage + bytes -- T:989 C:65 H:269,271
		*live_word = live + (in_array and 0 or 1) -- T:989 C:65 H:271
		if capacity >= band_capacity then -- T:990 C:66
			local band_base<const> = storage + bytes + 4 -- T:991 C:67
			fill.internal.fill_backing(band_base, band_base + 32 * 4, 0) -- T:992-993 C:68-69
			if not in_array and kt == integer_tag and kw > 0 then -- T:101,994 C:70 H:273
				local remainder<const> = kw - 1 -- T:102 C:70 H:274
				local bin<const> = remainder == 0 and 0 or allocator.internal.highest_bit(remainder) + 1 -- T:102 C:70 H:274
				local band<const>: *u32 = ram_base + band_base + 4 * bin -- T:103 C:70 H:275
				*band = *band + 1 -- T:104 C:70 H:276
			end
		end
	end
	local home<const> = slots.internal.hash_canonical_table_key(kt, kw) & (capacity - 1) -- T:934,997 C:9,63; pure calculation precedes census in C++
	if not in_array then -- T:998 C:73
		local words<const> = ram_base + storage -- T:933,980,999-1000 C:8,74-75 H:312-313
		local tags<const> = words + 8 * capacity -- T:933,999-1000 C:8,74-75 H:313
		slots.internal.write_slot(words, tags, home, kt, kw) -- T:181-183,999 C:74 H:258-262
		slots.internal.write_slot(words, tags, capacity + home, job.value_tag, job.value_word) -- T:181-183,1000 C:75 H:258-262
	end
end

local prepare_table_rebuild<const> = function(record, job_offset, allowance) -- T:930-931 C:6-7
	if allowance <= 0 then return allowance end -- T:931 C:7
	local job_address<const> = ram_base + job_offset -- T:41-46 C:6 J:12-16; fixed transport of the original job
	local job<const>: *rebuild_prepare_job = job_address -- T:930,935 C:6,10
	local table<const>: *rebuild_array_header = ram_base + (record & ram_word_mask) -- T:121,133,137,935-936 C:10,14 H:247 M:9
	local old_array<const>, old_base<const> = table.array_slots, table.array_storage -- T:935-936 C:10,14
	local array_storage<const> = job.array_storage -- T:935-937 C:10-11,15
	local array<const> = array_storage ~= 0 and job.array_slots or old_array -- T:935 C:10
	local in_place<const> = array_storage ~= 0 and array_storage == old_base -- T:937 C:15
	local transfer<const> = array < old_array and 0 or 5 * job.array_slots - (in_place and 4 * old_array or 0) -- T:938-939 C:16,18
	local capacity<const> = job.capacity -- T:933-934 C:8-9
	local bytes<const> = capacity * (capacity <= byte_link_capacity and 11 or 14) -- T:98,934 C:9 H:47
	local first<const> = job.array_cleared -- T:940-941 C:19-20
	if first < transfer then -- T:940 C:19
		local n<const> = transfer_extent(transfer - first, allowance) -- T:941 C:20-21
		local last<const> = first + n -- T:943 C:22
		transfer_array(array_storage & ram_word_mask, old_base & ram_word_mask, old_array, array, in_place, transfer, first, last) -- T:942-972 C:11,22-48
		job.array_cleared = last -- T:973 C:49
		allowance = allowance - ((n + 15) >> 4) -- T:974 C:50
		if last < transfer or (allowance == 0 and job.cleared < bytes) then return allowance end -- T:975 C:51
	end
	local cleared<const> = job.cleared -- T:977-979 C:53-55
	if cleared < bytes then -- T:977 C:53
		local n<const> = transfer_extent(bytes - cleared, allowance) -- T:978 C:54
		local last<const> = cleared + n -- T:979 C:55
		local payload_end<const> = 10 * capacity -- T:979 C:56
		local split<const> = payload_end < cleared and cleared or (payload_end < last and payload_end or last) -- T:979 C:56
		local storage<const> = job.storage & ram_word_mask -- T:980 C:59 H:312
		fill.internal.fill_backing(storage + cleared, storage + split, 0) -- T:981,983 C:57,59
		fill.internal.fill_backing(storage + split, storage + last, 0xffffffff) -- T:982-983 C:58-59
		job.cleared = last -- T:984 C:60
		allowance = allowance - ((n + 15) >> 4) -- T:985 C:61
		if last < bytes then return allowance end -- T:986 C:62
		initialize_hash_trigger(job_address, array, storage, capacity, bytes) -- T:987-1001 C:63-76
	end
	return allowance -- T:975,986,1003 C:51,62,94; caller resumes at placement
end

return {
	internal = { transfer_extent = transfer_extent, move_extent = move_extent,
		transfer_array = transfer_array, initialize_hash_trigger = initialize_hash_trigger },
	prepare_table_rebuild = prepare_table_rebuild,
}
