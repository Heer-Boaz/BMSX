module<const>

-- Source basis: 0e7097869e82c2129fd4f5babfd4cecadba76d5d.
-- T = lua_heap.ts; C = lua_heap.cpp. Inputs and the result use RAM offsets.
-- T/C's HeapAllocator adds RAM_BASE to issued addresses, so the two
-- descriptors keep absolute pointers and preserve a zero for no backing.
local arena<const> = require('kernel/dlmalloc') -- T:94,271 C:112,278
local ram_base<const> = 0x08000000 -- T:95,97,102 C:113,115,120 A:58 B:56 M:6 N:12; allocator address translation
local gc_object_prefix<const> = 8 -- T:93 C:111 O:5-6,9 P:8-9,13; GC object alignment

local reserve_record<const> = function(state, bytes, object, backing_bytes, backing_field, charged, second_bytes, second_field, occupied_offset) -- T:92 C:110
	local prefix<const> = object ~= 0 and gc_object_prefix or 0 -- T:93 C:111
	local base<const> = arena.bmsx_dlmalloc_allocate(state, bytes + prefix, object) -- T:95 C:113 A:56-57 B:54-55
	if base == 0 then return 0 end -- T:96 C:114
	local backing = 0 -- T:97 C:115
	if backing_bytes ~= 0 then backing = arena.bmsx_dlmalloc_allocate(state, backing_bytes, 0) end -- T:97 C:115
	if backing_bytes ~= 0 and backing == 0 then -- T:98 C:116
		arena.bmsx_dlmalloc_free(state, base) -- T:99 C:117 A:61 B:59
		return 0 -- T:100 C:118
	end
	local second = 0 -- T:102 C:120
	if second_bytes ~= 0 then second = arena.bmsx_dlmalloc_allocate(state, second_bytes, 0) end -- T:102 C:120
	if second_bytes ~= 0 and second == 0 then -- T:103 C:121
		if backing ~= 0 then arena.bmsx_dlmalloc_free(state, backing) end -- T:104 C:122
		arena.bmsx_dlmalloc_free(state, base) -- T:105 C:123
		return 0 -- T:106 C:124
	end
	local address<const> = base + prefix -- T:108 C:126
	if backing_field ~= 0 then -- T:109 C:127
		arena.internal.store_word(address + backing_field, backing == 0 and 0 or ram_base + backing) -- T:109 C:127
	end
	if second_field ~= 0 then -- T:110 C:128
		arena.internal.store_word(address + second_field, second == 0 and 0 or ram_base + second) -- T:110 C:128
	end
	local occupied<const>: *u32 = ram_base + occupied_offset -- T:111,265-267 C:129,272-274
	*occupied = *occupied + charged -- T:111,267 C:129,274
	return address -- T:112 C:130
end

local release_record<const> = function(state, offset, bytes, occupied_offset) -- T:270 C:277
	arena.bmsx_dlmalloc_free(state, offset) -- T:271 C:278 A:61 B:59
	local occupied<const>: *u32 = ram_base + occupied_offset -- T:272 C:279
	*occupied = *occupied - bytes -- T:273 C:280
end

local release_object<const> = function(state, offset, bytes, occupied_offset) -- T:276 C:283
	local kind<const>: *u8 = ram_base + offset -- T:277 C:284
	*kind = 0 -- T:277 C:284
	release_record(state, offset - gc_object_prefix, bytes, occupied_offset) -- T:278 C:285
end

return {
	bmsx_dlmalloc_reserve_record = reserve_record,
	bmsx_dlmalloc_release_record = release_record,
	bmsx_dlmalloc_release_object = release_object,
}
