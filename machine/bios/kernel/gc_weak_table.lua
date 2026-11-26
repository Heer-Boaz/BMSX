module<const>

-- Source basis: 5c40682c88a6786933d7d651023d5d8b485655af.
-- T/D/E: Table storage (TS, C++ header, C++ implementation); G/C/H:
-- GcHeap; V/W: Value; O/P: record layout; I/J: Thread; M: RAM map.
local allocator<const> = require('kernel/dlmalloc') -- G:151 C:256
local marking<const> = require('kernel/gc_mark') -- G:171,173 H:105,146
local strings<const> = require('kernel/gc_strings') -- G:178 C:88 H:120

local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9
local record_mask<const> = 0x003ffff8 -- O:5-7 P:8-10 M:7
local object_prefix<const> = 8 -- O:5-6,9 P:8-9,13
local color_offset<const> = 1 -- O:3 P:6
local thread_kind<const> = 4 -- I:33 J:18 G:167 C:269
local nil_tag<const> = 0 -- V:9-11 W:21-22
local integer_tag<const> = 3 -- V:9-11 W:21-22
local string_tag<const> = 5 -- V:9-11 W:21-22
local table_tag<const> = 6 -- V:9-11 W:21-22
local closure_tag<const> = 7 -- V:9-11 W:21-22
local thread_tag<const> = 9 -- V:9-11 W:21-22
local dead_key_tag<const> = 10 -- V:9-11 W:21-22
local new_index_absent<const> = 2 -- T:34 D:31
local hash_storage_offset<const> = 12 -- T:34 D:27
local array_capacity_offset<const> = 16 -- T:34 D:27
local hash_size_offset<const> = 20 -- T:34 D:27
local array_storage_offset<const> = 32 -- T:34 D:27
local census_limit<const> = 64 -- T:95 D:45
local byte_link_capacity<const> = 128 -- T:94,97 D:44
local band_capacity<const> = 1024 -- T:96 D:46
local weak_keys_bit<const> = 1 -- G:737 C:67,789
local weak_values_bit<const> = 2 -- G:737 C:67,789

-- The record-port projection reads the kind lane before testing allocator
-- issuance. This private routine expects the projected lane in its BIOS RAM
-- aperture; a caller admitting wider raw aliases must preserve that read port.
local value_is_alive<const> = function(control, arena, tag, word) -- G:100-102 C:355-356
	local kind -- G:103-114 C:357-368; object tag maps to the raw record kind
	if tag == table_tag then -- G:103,153 C:361,284
		kind = table_tag -- G:104,154 C:362,285,68
	elseif tag == closure_tag then -- G:107,159 C:365,276
		kind = closure_tag -- G:108,160 C:366,277 H:207
	elseif tag == thread_tag then -- G:111,166 C:357,268
		kind = thread_kind -- G:112,167 C:358,269
	else return 1 end -- G:115 C:369-370; Strings are not tested for liveness here
	local offset<const> = word & record_mask -- G:148-149 C:253-254
	local header<const>: *u8 = ram_base + offset -- G:150-151 C:255-256
	if *header ~= kind then return 0 end -- G:150 C:255
	if allocator.bmsx_dlmalloc_is_object(arena, offset - object_prefix) == 0 then return 0 end -- G:151 C:256
	local color<const>: *u8 = ram_base + offset + color_offset -- G:171 H:105
	return (not marking.internal.unmarked(control, *color)) and 1 or 0 -- G:105,109,113,171,173 C:359,363,367 H:105,146
end

local write_slot<const> = function(word_plane, tag_plane, slot, tag, word) -- T:180 D:251-252
	local words<const>: *u32 = word_plane -- T:181 D:245,252
	local tags<const>: *u8 = tag_plane -- T:182 D:245,254
	words[slot] = word -- T:181 D:253,255; ordinary private write invalidates tracked RAM
	tags[slot] = tag -- T:182 D:254-255
end

-- Both mirrors keep the collision chain and free cursor. The key's
-- tag/word snapshot is in a separate plane from value and census writes;
-- the TS rereads in markHashNodeDead retrieve those same unchanged lanes.
local mark_hash_node_dead<const> = function(record, words, tags, hash, slot, tag, word, new_index_id) -- T:645-646,648,174-178,184 E:663-665
	local value_slot<const> = hash + slot -- T:648,184 D:219 E:670,672
	if hash > census_limit then -- T:647,105-106 E:666
		local node_bytes<const> = hash * (hash <= byte_link_capacity and 11 or 14) -- T:97,107 D:47,262,306
		local live<const>: *u32 = words + node_bytes -- T:107 D:262 E:666
		*live = *live - 1 -- T:108 D:263-264 E:666
		if hash >= band_capacity and tag == integer_tag and word > 0 then -- T:649-650,99-100 E:666 D:265-266 W:49,64
			local rest<const> = word - 1 -- T:101 D:267
			local bin<const> = rest == 0 and 0 or allocator.internal.highest_bit(rest) + 1 -- T:101 D:267; 32 - clz32
			local count<const>: *u32 = words + node_bytes + 4 * (1 + bin) -- T:102 D:268
			*count = *count - 1 -- T:103 D:269 E:666
		end
	end
	if tag == table_tag or tag == thread_tag or tag == closure_tag then -- T:651-652 E:667-668
		write_slot(words, tags, slot, nil_tag, tag) -- T:653,176-178 E:669 W:27-34
		write_slot(words, tags, value_slot, dead_key_tag, word) -- T:653,176-178 E:670 W:21-22,31-33
	else -- T:654 E:671
		write_slot(words, tags, value_slot, nil_tag, 0) -- T:655,176-178 E:672 W:34
		if tag == string_tag and word == new_index_id then -- T:656 E:673
			local absent<const>: *u8 = record + new_index_absent -- T:657 E:673 D:31
			*absent = 1 -- T:657 E:673
		end
	end
end

-- The caller owns the published cursor, mode probe, and extent charge.
-- first/end are its bounded logical slot range (array then hash entries).
-- Return only the newly marked String work instead of charging a host latch.
local clear_weak_entries<const> = function(control, arena, metadata, record, mode, first, last, new_index_id) -- T:1173-1175 G:737-738 D:166-167 C:789-791
	local weak_keys<const> = (mode & weak_keys_bit) ~= 0 -- G:737 C:789
	local weak_values<const> = (mode & weak_values_bit) ~= 0 -- G:737 C:789
	local array_field<const>: *u32 = record + array_capacity_offset -- T:1176,132 D:168,57,240
	local hash_field<const>: *u32 = record + hash_size_offset -- T:1176,133 D:168,58,240
	local array<const>, hash<const> = *array_field, *hash_field -- T:1176 D:168
	local array_storage<const>: *u32 = record + array_storage_offset -- T:136,1177 D:56,169,331
	local array_words<const>: *u32 = ram_base + (*array_storage & ram_word_mask) -- T:1177 D:169,331
	local array_tags<const>: *u8 = array_words + 4 * array -- T:1177 D:169,332
	local array_end<const> = array < last and array or last -- T:1178 D:170
	local work = 0 -- G:738 C:791; explicit String work accumulator
	for slot = first, array_end - 1 do -- T:1178 D:170
		local tag<const> = array_tags[slot] -- T:1179 D:171,248-249
		if tag ~= nil_tag then -- T:1180 D:172
			local word<const> = array_words[slot] -- T:1181 D:171,248-249
			if weak_values and value_is_alive(control, arena, tag, word) == 0 then -- T:1182 D:173 V:18 W:31-33
				write_slot(array_words, array_tags, slot, nil_tag, 0) -- T:1183 D:173 W:34
			elseif tag == string_tag then -- T:1184 D:174 V:41 W:57
				work = work + strings.mark(metadata, word) -- T:1184 G:178,738 D:174 C:88,791 H:120
			end
		end
	end
	local hash_storage<const>: *u32 = record + hash_storage_offset -- T:1186,137 D:176,55,300-304
	local hash_words<const>: *u32 = ram_base + (*hash_storage & ram_word_mask) -- T:1186 D:176,305
	local hash_tags<const>: *u8 = hash_words + 8 * hash -- T:1186 D:176,306
	local hash_first<const> = first > array and first - array or 0 -- T:1187 D:177-178
	local hash_end<const> = hash < last - array and hash or last - array -- T:1187 D:177
	for key = hash_first, hash_end - 1 do -- T:1187 D:177
		local value<const> = key + hash -- T:1188 D:179
		local kt<const>, vt<const> = hash_tags[key], hash_tags[value] -- T:1189 D:178-180,248-249
		if kt ~= nil_tag and vt ~= nil_tag then -- T:1190 D:180-182
			local kw<const>, vw<const> = hash_words[key], hash_words[value] -- T:1191 D:178-179,248-249
			if (weak_keys and value_is_alive(control, arena, kt, kw) == 0) -- T:1192 D:183 V:18 W:31-33
				or (weak_values and value_is_alive(control, arena, vt, vw) == 0) then -- T:1192 D:183 V:18 W:31-33
				mark_hash_node_dead(record, hash_words, hash_tags, hash, key, kt, kw, new_index_id) -- T:1193 D:184
			else -- T:1194 D:185
				if kt == string_tag then work = work + strings.mark(metadata, kw) end -- T:1195 G:178,738 D:186 C:791 H:120
				if vt == string_tag then work = work + strings.mark(metadata, vw) end -- T:1196 G:178,738 D:187 C:791 H:120
			end
		end
	end
	return work -- G:738 C:791
end

return {
	internal = { mark_hash_node_dead = mark_hash_node_dead, write_slot = write_slot },
	value_is_alive = value_is_alive,
	clear_weak_entries = clear_weak_entries,
}
