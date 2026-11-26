module<const>

-- Source basis: 9b002adf22c0a496d45fac0bca5cab2030cda3b9.
-- T/D/E: Table storage (TS, C++ header, C++ implementation); G/C/H:
-- GcHeap; V/W: Value; S/I: String record alignment; M: RAM map.
local ram_base<const> = 0x08000000 -- M:6
local ram_word_mask<const> = 0x003ffffc -- M:7-9
local mode_meta_offset<const> = 0x4c -- G:39-42 H:38-41
local hash_storage_offset<const> = 12 -- T:34 D:27
local hash_count_offset<const> = 20 -- T:34 D:27
local byte_link_capacity<const> = 128 -- T:110-112 D:44,273
local string_tag<const> = 5 -- V:8-11 W:20-22
local nil_tag<const> = 0 -- V:8-11 W:20-22
local string_id_shift<const> = 3 -- V:101-102 W:123-124 S:54-55 I:60-61
local sign_bit<const> = 0x80000000 -- T:317 E:875; unsigned allowance ordering

struct mode_probe_cursor -- G:39-42 H:38-41
	meta: addr -- G:40,356,366,372 H:39 C:330,339,344,349
	node: i32 -- G:41,360,366,372 H:40 C:334,339,344,349
	remaining: u32 -- G:42,361,367,373 H:41 C:335,340,345,350
end

local advance_string_probe<const> = function(meta, key, node, remaining, limit) -- T:315,319-320 E:873,116
	local count_field<const>: *u32 = meta + hash_count_offset -- T:133,316 D:58,240 E:874
	local storage<const>: *u32 = meta + hash_storage_offset -- T:137,316 D:55,240,300-304 E:874
	local count<const> = *count_field -- T:316 E:874
	local words<const>: *u32 = ram_base + (*storage & ram_word_mask) -- T:316 D:305 E:874
	local tags<const>: *u8 = words + 8 * count -- T:317 D:306
	local link_bytes<const>: *u8 = tags + 2 * count -- T:321 D:272,306
	local link_words<const>: *u32 = link_bytes -- T:112 D:274
	local allowance<const> = (limit ~ sign_bit) < (remaining ~ sign_bit) and limit or remaining -- T:317 E:875
	local left = allowance -- T:322 E:876
	while node >= 0 and left ~= 0 do -- T:323 E:117,877
		left = left - 1 -- T:324 E:118-119
		if tags[node] == string_tag and words[node] == key then -- T:325-326,344-347 D:246-247,288-290 E:120
			local slot<const> = count + node -- T:327-328,347 E:122,877-878
			local tag<const>, word<const> = tags[slot], words[slot] -- T:328 D:248-249 E:878
			local inspected<const> = allowance - left -- T:324,333 E:879
			return -1, remaining - inspected, tag, word, inspected -- T:329-334 E:121-122,878-881
		end
		if count <= byte_link_capacity then -- T:110-111,335 D:271-273 E:124
			node = (link_bytes[node] ~ 0x80) - 0x80 -- T:111,335 D:273 E:124; sign extend the i8 link
		else -- T:111-112 D:273-274
			node = link_words[node] -- T:112,335 D:274 E:124; the loaded word is already a signed Integer
		end
	end
	local inspected<const> = allowance - left -- T:322,324,342 E:879
	return node, remaining - inspected, nil_tag, 0, inspected -- T:337-342 D:33-37 E:126,877-881 W:34
end

-- The caller supplies the already resolved private metatable (or zero).
-- The native tableRecordAddress resolution uses the raw record port, which
-- can project onto public RAM even for zero; this lane does not widen it.
-- Once ready, StringPool owns interpreting the raw value in RAM or either
-- ROM bank. No decoding or string storage read belongs in this hash probe.
-- Result: pending (1/0), complete raw Value tag/payload, inspected work.
local probe_table_mode<const> = function(control, meta, mode_key, limit) -- G:354-355,375 C:328-329,343,346,352
	local cursor<const>: *mode_probe_cursor = ram_base + control + mode_meta_offset -- G:356,360-361 C:330,334-335
	local current<const> = cursor.meta -- G:356 C:330
	local work, tag, word = 0, nil_tag, 0 -- G:357,362,370,375 D:36 C:333-336,352 W:34
	if meta ~= 0 then -- G:358 C:331-332
		local node, remaining -- G:359-363 C:333-336
		if meta == current then -- G:359 C:333
			node = cursor.node -- G:360 C:334
			remaining = cursor.remaining -- G:361 C:335
		else -- G:363 C:336 T:309 E:868
			local count_field<const>: *u32 = meta + hash_count_offset -- T:133,310 D:58,240 E:869
			local count<const> = *count_field -- T:310 E:869
			node = count == 0 and -1 or (mode_key >> string_id_shift) & (count - 1) -- T:311 E:870 V:102 W:124
			remaining = count -- T:312-313 D:36-37 E:870
		end
		node, remaining, tag, word, work = advance_string_probe(meta, mode_key, node, remaining, limit) -- G:364 C:337
		if node >= 0 and remaining ~= 0 then -- G:365 C:338
			cursor.meta = meta -- G:366 C:339
			cursor.node = node -- G:366 C:339
			cursor.remaining = remaining -- G:367 C:340
			return 1, nil_tag, 0, work -- G:368 C:341; pending is separate from the mode Value
		end
	end
	if current ~= 0 then -- G:371 C:343,348
		cursor.meta = 0 -- G:372 C:344,349
		cursor.node = 0 -- G:372 C:344,349
		cursor.remaining = 0 -- G:373 C:345,350
	end
	return 0, tag, word, work -- G:370,375 C:343,346,352; terminal Value leaves the probe unnormalized
end

return {
	internal = { advance_string_probe = advance_string_probe },
	probe_table_mode = probe_table_mode,
}
