module<const>

-- Source basis: fb40f64327849066a7b676350b4c9e6e6f6d685d. A/B: HeapAllocator TS/C++; L/H: LuaHeap
-- TS/C++; S/T: StringPool TS/C++; C: shared dlmalloc; M: installed RAM.
-- The hardware reset establishes the physical floor, not allocator state.
-- This cold entrance owns the String/GC metadata prefix and arena;
-- it must not erase the live CPU/bootstrap/fixed call context.
local layout<const> = require('kernel/gc_runtime_layout') -- A:6-10 B:19-20
local allocator<const> = require('kernel/dlmalloc') -- A:36 B:33 C:462-473
local admission<const> = require('kernel/heap_admission').internal -- L:13,26-31 H:22-27
local strings<const> = require('kernel/gc_strings').internal -- S:20-22,126-139 T:20-22,136-153

local initialize_heap<const> = function(management, floor) -- A:32-37 B:29-35 L:26-31 H:22-27 S:130-139 T:141-153
	local metadata<const>: *u32 = layout.ram_base + management + layout.metadata_offset -- A:6,33-34 B:30-31 M:6
	for index = 0, ((layout.arena_offset - layout.metadata_offset) >> 2) - 1 do -- A:33-34 B:30-31; cold metadata, not CPU or allocator-owned words
		metadata[index] = 0 -- A:33-34 B:30-31 S:126-129 T:136-139; empty String RAM buckets and GC Pause/white zero
	end
	allocator.bmsx_dlmalloc_reset(management + layout.arena_offset, floor, management) -- A:35-36 B:32-33 C:462-473
	local target<const>: *u32 = layout.ram_base + management + admission.target_offset -- L:27,35 H:23,33-35 M:6
	*target = admission.min_collection_bytes -- L:13,31,38-39 H:22-27,33-35
end

local publish_system_directory<const> = function(management, system_buckets, system_bucket_count) -- S:130-139 T:141-153
	-- The linked System directory already has the System-domain ROM id.
	-- Hardware/image loading admits its bounds; the guest publishes its words.
	local directory<const>: *u32 = layout.ram_base + management + layout.metadata_offset + strings.rom_tables_offset -- S:20-21,136-138 T:21-22,149-152 M:6
	directory[0] = system_buckets -- S:136-137 T:150-151
	directory[1] = system_bucket_count -- S:138 T:152
end

return { initialize_heap = initialize_heap, publish_system_directory = publish_system_directory }
