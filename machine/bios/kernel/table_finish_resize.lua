module<const>

-- Source basis: c36fafd44eea29507af392041fda24f433709f18.
-- T/C/H: Table; V/W: Value; U/N: logical heap; A/B: arena; M: RAM.
-- The general immediate path after header publication. Immediate large
-- hash-only rebuilds (T:835-839 C:391-395) and staged rebuilds are separate.
local arena<const> = require('kernel/dlmalloc') -- T:854,856,868 C:410,412,423 U:305-307 N:308-310 A:61,66-68 B:59,64-66
local slots<const> = require('kernel/table_reinsert') -- T:845-846,862-866 C:404,418,420
local table_create<const> = require('kernel/table_create') -- T:144-151,853 C:409,483-491
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9 T:841 H:305 C:400
local nil_tag<const> = 0 -- V:9-11 W:21-23
local integer_tag<const> = 3 -- V:9-11,27 W:21-23,37
local census_limit<const> = 64 -- T:95,867 H:45 C:421
local byte_link_capacity<const> = 128 -- T:94,97 H:44,47,262

struct immediate_resize_table
	before_hash: u32[3] -- T:33-34 H:26-27
	hash_storage: addr -- T:34,137,832 H:27,55 C:388
	array_slots: u32 -- T:34,132,831 H:27,57 C:387
	hash_slots: u32 -- T:34,133,832 H:27,58 C:388
	length: u32 -- T:34 H:27
	free: i32 -- T:34,135 H:27,60 C:422
	array_storage: addr -- T:34,52,136,833 H:27,43,56 C:389
end

struct immediate_resize_context
	key_tag: u32 -- T:801,866 C:380,420 V:23 W:29
	key_word: u32 -- T:801,866 C:380,420 V:24 W:30
	value_tag: u32 -- T:801,866 C:380,420 V:23 W:29
	value_word: u32 -- T:801,866 C:380,420 V:24 W:30
	previous_charge: u32 -- T:801,868 C:380,423
	requested_charge: u32 -- T:801,868 C:380,423
	keep_hash: u32 -- T:802,860,867-868 C:381,416,421,423
end

-- Both tag planes are word-aligned. Their ranges may overlap on close
-- growth or shrink; copy in the same alias-safe direction as memmove.
local move_array_tags<const> = function(words, array, old_array, keep) -- T:850-851 C:406-407
	local old_tags<const>, tags<const> = words + old_array * 4, words + array * 4 -- T:851 C:400-401,407
	local source<const>: *u8 = old_tags -- T:851 C:407
	local target<const>: *u8 = tags -- T:851 C:407
	local source_words<const>: *u32 = old_tags -- T:851 C:407; aligned whole words
	local target_words<const>: *u32 = tags -- T:851 C:407
	local count<const> = keep >> 2 -- T:851 C:407
	local whole<const> = count << 2 -- T:851 C:407
	if tags > old_tags and tags < old_tags + keep then -- T:851 C:407; choose backwards only when the high destination would clobber source
		for byte = keep - 1, whole, -1 do target[byte] = source[byte] end -- T:851 C:407
		for word = count - 1, 0, -1 do target_words[word] = source_words[word] end -- T:851 C:407
	else -- T:851 C:407
		for word = 0, count - 1 do target_words[word] = source_words[word] end -- T:851 C:407
		for byte = whole, keep - 1 do target[byte] = source[byte] end -- T:851 C:407
	end
end

local resize_array<const> = function(state, record_address, base, words, array, old_array) -- T:849-859 C:399,406-415
	local keep<const> = array < old_array and array or old_array -- T:850 C:406
	move_array_tags(words, array, old_array, keep) -- T:851 C:407
	if array ~= 0 then -- T:852 C:408
		local physical<const> = words - ram_base -- T:147,841 C:400,485 M:6
		local tags<const> = physical + 4 * array -- T:148-149 C:487-488
		table_create.internal.fill_backing(physical + keep * 4, tags, 0) -- T:147-148,150,853 C:409,485,487,490
		table_create.internal.fill_backing(tags + keep, physical + 5 * array, 0) -- T:149-150,853 C:409,488,490
		if array < old_array then -- T:854 C:410
			arena.bmsx_dlmalloc_resize_backing(state, base - ram_base, array * 5) -- T:854 C:410 A:66-68 B:64-66
		end
	else -- T:855 C:411
		arena.bmsx_dlmalloc_free(state, base - ram_base) -- T:856 C:412 A:61 B:59
		local record<const>: *immediate_resize_table = record_address -- T:121,857 H:241 C:413
		record.array_storage = 0 -- T:857 C:413
	end
end

local finish_table_resize<const> = function(state, occupied, table_address, old_array, old_hash, old_storage, context_offset, cpp_mirror) -- T:801-805,840 C:380-386,396-398
	local record_address<const> = ram_base + (table_address & ram_word_mask) -- T:120-121 H:240-241 M:9
	local record<const>: *immediate_resize_table = record_address -- T:830-834,841 H:55-60 C:387-390
	local context<const>: *immediate_resize_context = ram_base + context_offset -- T:801-802 C:380-381; suspended native locals
	local array<const>, hash<const>, keep_hash<const> = record.array_slots, record.hash_slots, context.keep_hash -- T:802,831-832 H:57-58 C:381,387-388
	local storage<const>, base<const> = record.hash_storage, record.array_storage -- T:832-833 H:55-56 C:388-389
	local words<const> = ram_base + (storage & ram_word_mask) -- T:841 H:305 M:9
	local tags<const> = words + hash * 8 -- T:841 H:306
	local array_words_address<const> = ram_base + (base & ram_word_mask) -- T:841 C:400 M:9
	local live, free = 0, hash - 1 -- T:840,142 C:396-398
	if array < old_array then -- T:842 C:399,402
		local old_tags<const>: *u8 = array_words_address + old_array * 4 -- T:844 C:400-403 H:248-249
		local array_words<const>: *u32 = array_words_address -- T:846 C:400-403 H:248-249
		for index = array, old_array - 1 do -- T:843 C:402
			local tag<const> = old_tags[index] -- T:844 C:403 H:248-249
			if tag ~= nil_tag then -- T:845 C:404; unused words are not part of a mapping
				local slot<const>, next_free<const> = slots.internal.reinsert_mapping(record_address, array_words_address, array, words, tags, hash, integer_tag, index + 1, tag, array_words[index], free, cpp_mirror) -- T:845-846 C:404 V:27 W:37
				free = next_free -- T:609 C:396-397,596; C++ defers its Free publication
				if slot >= 0 then live = live + 1 end -- T:845-846 C:404
			end
		end
	end
	if array ~= old_array then -- T:849 C:399
		resize_array(state, record_address, base, array_words_address, array, old_array) -- T:850-858 C:406-414
	end
	local old_words<const>: *u32 = ram_base + (old_storage & ram_word_mask) -- T:804,863-864 H:305 C:384-385,417
	local old_tags<const>: *u8 = old_words + 8 * old_hash -- T:804,861 H:306 C:385,417
	local count<const> = keep_hash ~= 0 and 0 or old_hash -- T:860 C:416
	for index = 0, count - 1 do -- T:860 C:416
		local value_index<const> = index + old_hash -- T:861,864 C:417
		local kt<const>, vt<const> = old_tags[index], old_tags[value_index] -- T:861 C:417 H:248-249
		if kt ~= nil_tag and vt ~= nil_tag then -- T:862 C:418
			local slot<const>, next_free<const> = slots.internal.reinsert_mapping(record_address, array_words_address, array, words, tags, hash, kt, old_words[index], vt, old_words[value_index], free, cpp_mirror) -- T:862-864 C:417-418 H:248-249
			free = next_free -- T:609 C:396-397,596
			if slot >= 0 then live = live + 1 end -- T:862-864 C:418
		end
	end
	local slot<const>, next_free<const> = slots.internal.reinsert_mapping(record_address, array_words_address, array, words, tags, hash, context.key_tag, context.key_word, context.value_tag, context.value_word, free, cpp_mirror) -- T:866 C:420
	if keep_hash == 0 and hash > census_limit then -- T:867 C:421
		local census<const>: *u32 = words + hash * (hash <= byte_link_capacity and 11 or 14) -- T:97,867 H:47,262-264
		*census = live + (slot >= 0 and 1 or 0) -- T:867 C:421 H:264
	end
	if cpp_mirror ~= 0 and next_free ~= hash - 1 then record.free = next_free end -- C:396,422; TS already wrote every consumed cursor
	if keep_hash == 0 and old_storage ~= 0 then -- T:868 U:305-306 C:423 N:308-309
		arena.bmsx_dlmalloc_free(state, old_storage - ram_base) -- U:306 N:309 A:61 B:59
	end
	local previous<const>, requested<const> = context.previous_charge, context.requested_charge -- T:868 U:307,310-311 C:423 N:310,313-314
	if previous ~= requested then -- U:311 N:314
		local charged<const>: *u32 = ram_base + occupied -- U:289-291 N:315-316 M:6
		*charged = *charged + requested - previous -- U:289-291,311 N:316
	end
	return slot -- T:869 C:424
end

return { internal = { move_array_tags = move_array_tags, resize_array = resize_array },
	finish_table_resize = finish_table_resize }
