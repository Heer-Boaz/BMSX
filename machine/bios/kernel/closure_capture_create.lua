module<const>

-- Source basis: 08c4a76d41e49d689c13a47fed3de37cece84072.
-- T/C: CPU capture preparation, search, and linking; L/R: LuaHeap reservation;
-- S/N: Closure words; U/V: Cell words; F/H: frame controls; P/Q: GC predicates;
-- D/I: descriptor format; M: RAM; E: faults; J: object words; K/B: C++ Closure ABI.
-- The CPU's mapped-bus descriptor sampling is not a private RAM read. The
-- preparation input is a sampled word plane; production must preserve the
-- bus fault vs descriptor-index fault order before admitting any reservation.
-- Both temporary address planes belong to the pinned caller, not the arena.
-- They survive a failed attempt and any collector work between attempts.
local allocator<const> = require('kernel/dlmalloc') -- L:248-255,269-270 R:255-261,275-276
local collector<const> = require('kernel/gc_control') -- L:260-264 R:266-270
local captures<const> = require('kernel/gc_capture_trace') -- P:159-168,176-178 Q:253-256,288-294 T:4108-4109 C:3046-3047
local layout<const> = require('kernel/gc_runtime_layout') -- L:260 R:265
local ram_size<const> = 0x00400000 -- M:7 T:4079 C:3021
local record_mask<const> = ram_size - 8 -- J:5-7 U:10
local object_prefix<const> = 8 -- J:6,9 L:247,250,254,256,267,269 R:254,257,260,262,273,275
local gray_bits<const> = 19 -- J:12 S:38,64 N:22-23
local closure_kind<const> = 7 -- S:63 N:21
local latched_shift<const> = 3 -- S:36,62 N:19-20; bit position of the latched-prototype field
local cell_kind<const> = 11 -- U:11 V:24
local cell_open<const> = 1 -- U:13,26,32 V:29,35
local cell_bytes<const> = 16 -- U:9,18 L:254 R:260
local chain_limit<const> = ram_size // cell_bytes -- T:570,583 C:2978,2991 U:18
local in_stack<const> = 0x80000000 -- D:44 I:50 T:4101,4117 C:3040,3055
local index_mask<const> = 0x7fffffff -- D:45 I:51 T:4100,4122 C:3039,3058
local frame_window_mask<const> = (ram_size >> 2) - 1 -- F:22,51-52 H:37,128
local invalid_argument<const> = 10 -- E:44 T:4102,4108 C:3041,3046
local out_of_memory<const> = 9 -- E:43 T:4079 C:3021

struct closure_binding
	prototype: addr -- S:73 N:24 T:4076 C:3003,3051
	domain: i32 -- S:62 N:19
	binding_flags: u32 -- T:1228,2985,4078 C:159,590,3005,3021 S:35-36,62 N:19-20
	code: addr -- S:76 N:27
	params: u32 -- S:77 N:28
	stack: u32 -- S:78 N:29
	flags: u32 -- S:79 N:30
	descriptors: addr -- S:80 T:4091 N:31 C:3029
	count: u32 -- S:81 T:4077 N:32 C:3021
end

struct closure_frame
	function_site: u32[2] -- F:19 H:33
	open_head: addr -- F:19,68 H:33 T:569,582 C:2977,2990
	preceding_closure: u32[8] -- F:19 H:33
	closure: addr -- F:19,69,106-108 H:33 T:4108-4109 C:3046-3047
	stack_base: u32 -- F:19,53 H:33,128 T:568,4122 C:2976,3057
	stack_capacity: u32 -- F:19,54 H:33,128 T:4102 C:3041
end

struct closure_record
	kind: u32 -- S:63 N:21-22
	gray: u32 -- S:64 N:23
	prototype: addr -- S:73 N:24
end

struct closure_tail
	code: addr -- S:76 N:27
	params: u32 -- S:77 N:28
	stack: u32 -- S:78 N:29
	flags: u32 -- S:79 N:30
	descriptors: addr -- S:80 N:31
	count: u32 -- S:81 N:32
end

struct open_cell
	kind_and_color: u32 -- U:20-21 V:23-24
	slot: u32 -- U:15,21,33 V:24,36
	owner: addr -- U:16,22,34 V:25,37
	next: addr -- U:17,22,35 V:25,38
end

-- Explicit owner aliases: allocator offsets (state/control/occupied), actual
-- caller frame backing, one sampled binding, and the operand aperture.
-- Plan words retain an existing Cell address or the sampled source slot for
-- a missing Cell. Its bit plane distinguishes them without narrowing either
-- word or re-reading a descriptor on the mapped bus after allocation.
struct closure_work
	resolved: u32[1024] -- T:4082,4085-4086,4104,4109 C:3022-3023,3043,3047; physical BIOS scratch
	new_cells: u32[1024] -- T:4111-4112,4121 L:256,262,269 C:3050-3051,3056 R:262,268,275
	missing: u32[32] -- T:4104-4105,4117 C:3043-3044,3055; compact transport of the source predicate
end

local capture_limit<const> = offsetof(closure_work.new_cells) >> 2 -- T:4085,4111 C:3023,3050; fixed pre-reservation workspace capacity

local cell_flags_offset<const> = 2 -- U:12 V:29,35
local non_capture_bytes<const> = sizeof(closure_record) -- S:40-43 N:24
local latched_bytes<const> = sizeof(closure_tail) -- S:41-43,74-81 N:25-32
local capture_bytes<const> = function(count, latched) -- S:42-43 L:244 R:251
	return non_capture_bytes + 4 * count + latched * latched_bytes -- S:42-43 L:244 R:251
end

local open_cell_address<const> = function(state, address) -- T:571,584 C:2979,2992 P:159-168,176-178 Q:253-256,288-294
	local cell<const> = captures.internal.cell_record_address(state, address) -- P:159-168,176-177 Q:253-256,288-293
	if cell == 0 then return 0 end -- P:177 Q:294
	local flags<const>: *u8 = cell + cell_flags_offset -- U:25-26 V:28-29
	return (*flags & cell_open) ~= 0 and cell or 0 -- P:178 Q:294 U:26 V:29
end

local find_open<const> = function(state, frame, slot) -- T:567-577 C:2975-2986
	local control<const>: *closure_frame = frame -- T:569 C:2977
	local address = control.open_head -- T:569 C:2977
	local remaining = chain_limit -- T:570 C:2978
	while address ~= 0 and remaining ~= 0 do -- T:570 C:2978
		local cell<const> = open_cell_address(state, address) -- T:571 C:2979
		if cell == 0 then break end -- T:572 C:2980
		local open<const>: *open_cell = cell -- T:573,575 C:2981,2983
		local current<const> = open.slot -- T:573 C:2981
		if (current ~ in_stack) <= (slot ~ in_stack) then return current == slot and cell or 0 end -- T:574 C:2982; unsigned slot
		address = open.next -- T:575 C:2983
		remaining = remaining - 1 -- T:570 C:2978
	end
	return 0 -- T:577 C:2985
end

local prepare_closure<const> = function(state, frame, binding, descriptor_address, workspace) -- T:4075-4111 C:3021-3050
	local proto<const>: *closure_binding = binding -- T:4076 C:3003
	local count<const> = proto.count -- T:4077 C:3021
	local latched<const> = (proto.binding_flags >> latched_shift) & 1 -- T:4078 S:36,62 C:159,3021 N:19-20
	if (count ~ in_stack) > (((ram_size - non_capture_bytes - latched * latched_bytes) >> 2) ~ in_stack) then -- T:4079 C:3021 K:61-62; compare before signed multiplication
		return -(out_of_memory + 1) -- T:4079 C:3021 E:43; private result, no allocation
	end
	local frame_view<const>: *closure_frame = frame -- T:4102,4108-4109 C:3041,3046-3047
	local work<const>: *closure_work = workspace -- T:4080-4086 C:3022-3024
	local descriptors<const>: *u32 = descriptor_address -- T:4084,4099 C:3024,3038; each load performs one mapped read
	local resolved<const>: *u32 = &work.resolved[0] -- T:4082,4085-4086 C:3022-3023
	local missing_bits<const>: *u32 = &work.missing[0] -- T:4104-4105,4117 C:3043-3044,3055
	local staged<const> = count <= capture_limit -- T:4085,4111 C:3023,3050; retain only if the fixed plan fits
	local missing, index, plan = 0, 0, 0 -- T:4088-4089 C:3026-3027
	while index < count do -- T:4089 C:3027
		local word<const> = descriptors[index] -- T:4099-4100 C:3038-3039
		local capture<const> = word & index_mask -- T:4100 C:3039
		local reference -- T:4104,4109 C:3043,3047
		if (word & in_stack) ~= 0 then -- T:4101 C:3040
			if capture >= (frame_view.stack_capacity & frame_window_mask) then return -(invalid_argument + 1) end -- T:4102 F:52 C:3041 H:128 E:44
			local cell<const> = find_open(state, frame, (frame_view.stack_base & frame_window_mask) + capture) -- T:568,4103 F:51 C:2976,3042 H:128
			if cell == 0 then -- T:4104-4105 C:3043-3044
				reference = capture -- T:4104,4117,4122 C:3043,3055,3058; retain original validated slot
				plan = plan | (1 << (index & 31)) -- T:4104-4105,4117 C:3043-3044,3055
				missing = missing + 1 -- T:4105 C:3044
			else -- T:4104-4105 C:3043-3044
				reference = cell -- T:4104 C:3043
			end
		else -- T:4107-4108 C:3045
			local parent<const> = frame_view.closure -- T:4108-4109 F:69,103,106-108 C:3046-3047 H:33
			if capture >= captures.internal.capture_count(parent) then return -(invalid_argument + 1) end -- T:4108 C:3046 E:44 S:37,50-53 B:68-71
			reference = captures.internal.capture_address(parent, capture) -- T:4109 C:3047 S:55-56 B:74-75
		end
		if staged then resolved[index] = reference end -- T:4104,4109 C:3043,3047
		index = index + 1 -- T:4089 C:3027
		if staged and (index & 31) == 0 then -- T:4089,4104-4105 C:3027,3043-3044; flush the complete predicate word
			missing_bits[(index >> 5) - 1] = plan -- T:4104-4105,4117 C:3043-3044,3055
			plan = 0 -- T:4104-4105 C:3043-3044
		end
	end
	if not staged then return -(out_of_memory + 1) end -- T:4079,4089-4112 C:3021,3027-3051; capacity refusal follows ordered validation
	if (index & 31) ~= 0 then missing_bits[index >> 5] = plan end -- T:4089,4104-4105,4117 C:3027,3043-3044,3055
	return missing -- T:4111-4112 C:3050-3051; source-prepared count, retained across retries
end

local link_open<const> = function(state, frame_address, cell, slot, owner) -- T:580-592 C:2988-3000
	local frame<const>: *closure_frame = frame_address -- T:582,590 C:2990,2999
	local previous, next = 0, frame.open_head -- T:581-582 C:2989-2990
	local remaining = chain_limit -- T:583 C:2991
	while next ~= 0 and remaining ~= 0 do -- T:583 C:2991
		local current<const> = open_cell_address(state, next) -- T:584 C:2992
		if current == 0 then break end -- T:585 C:2993
		local open<const>: *open_cell = current -- T:585,587 C:2993,2995
		if (open.slot ~ in_stack) <= (slot ~ in_stack) then break end -- T:585 C:2993
		previous = current -- T:586 C:2994
		next = open.next -- T:587 C:2995
		remaining = remaining - 1 -- T:583 C:2991
	end
	local body<const> = layout.ram_base + (cell & record_mask) -- U:29-31 V:32-34 T:589 C:2997
	local record<const>: *open_cell = body -- U:33-35 V:36-38
	local flags<const>: *u8 = body + cell_flags_offset -- U:32 V:35
	*flags = cell_open -- U:32 V:35
	record.slot = slot -- U:33 V:36
	record.owner = owner -- U:34 V:37
	record.next = next -- U:35 V:38; private STORE supplies write watches
	if previous ~= 0 then -- T:590-591 C:2998-2999
		local predecessor<const>: *open_cell = previous -- T:591 C:2998
		predecessor.next = cell -- T:591 C:2998
	else -- T:590 C:2999
		frame.open_head = cell -- T:590 C:2999
	end
end

local create_prepared_closure<const> = function(state, control, occupied, frame_address, owner, binding, workspace, missing) -- T:4112-4127 C:158-163,3051-3065 L:243,249-270 R:250,255-276
	local proto<const>: *closure_binding = binding -- T:4114 C:161,3051
	local count<const>, binding_flags<const> = proto.count, proto.binding_flags -- T:1228,2985,4077-4078 C:159,590,3005,3051 S:35-36,62 N:19-20
	local latched<const> = (binding_flags >> latched_shift) & 1 -- T:4078 S:36,62 C:159,3021 N:19-20
	local bytes<const> = capture_bytes(count, latched) -- L:244 R:251
	local charged<const> = bytes + missing * cell_bytes -- L:245 R:252; original single logical charge
	local base<const> = allocator.bmsx_dlmalloc_allocate(state, bytes + object_prefix, 1) -- L:250-251 R:257
	if base == 0 then return 0 end -- L:251,272 R:257,278; caller owns retry
	local work<const>: *closure_work = workspace -- T:4084-4085,4121 C:3038,3054-3056
	local cells<const>: *u32 = &work.new_cells[0] -- L:256,262 R:262,268
	local issued = 0 -- L:252 R:258
	while issued < missing do -- L:253 R:259
		local raw<const> = allocator.bmsx_dlmalloc_allocate(state, cell_bytes + object_prefix, 1) -- L:254 R:260
		if raw == 0 then break end -- L:255 R:261
		cells[issued] = raw + object_prefix -- L:256 R:262; the address plane uses offsets
		issued = issued + 1 -- L:253 R:259
	end
	if issued ~= missing then -- L:258,269 R:264,275
		while issued ~= 0 do -- L:269 R:275
			issued = issued - 1 -- L:269 R:275
			allocator.bmsx_dlmalloc_free(state, cells[issued] - object_prefix) -- L:269 R:275; LIFO and no payload writes
		end
		allocator.bmsx_dlmalloc_free(state, base) -- L:270 R:276
		return 0 -- L:272 R:278; next admitted attempt
	end
	local white<const>: *u8 = layout.ram_base + control + collector.internal.white_offset -- L:260 T:4114 R:267 C:161 P:102
	local color<const> = (*white & 1) << 8 -- L:260 U:21 R:267 V:24
	local index = 0 -- L:261 R:268
	while index < missing do -- L:261 R:268
		local address<const> = layout.ram_base + cells[index] -- L:262 R:268
		local cell<const>: *open_cell = address -- L:263 R:269 U:21-22 V:24-25
		cell.kind_and_color = cell_kind | color -- U:21 V:24
		cell.slot = 0 -- U:21 V:24
		cell.owner = 0 -- U:22 V:25
		cell.next = 0 -- U:22 V:25
		collector.publish_object(control, address) -- L:264 R:270 P:147-155 Q:235-244
		index = index + 1 -- L:261 R:268
	end
	local occupancy<const>: *u32 = layout.ram_base + occupied -- L:266,283-285 R:272,286-288
	*occupancy = *occupancy + charged -- L:266,283-285 R:272,286-288
	local offset<const> = base + object_prefix -- L:267 R:273
	local address<const> = layout.ram_base + offset -- T:4112-4114 C:160-161
	local closure<const>: *closure_record = address -- T:4114 S:61,63-65 C:161 N:18,21-24
	local flags<const> = (proto.domain + 1) | binding_flags -- T:1228,2985 S:35-36,62 C:590,3005 N:19-20
	closure.kind = closure_kind | ((*white & 1) << 8) | (flags << 16) | ((count >> (32 - gray_bits)) << 24) -- T:4114 S:63 C:161 N:21-22
	closure.gray = count << gray_bits -- S:64 N:23
	closure.prototype = proto.prototype -- S:39,65,72-73 N:24
	if latched ~= 0 then -- T:4078 S:74 C:159 N:25
		local tail<const>: *closure_tail = address + non_capture_bytes + 4 * count -- S:75 N:26
		tail.code = proto.code -- S:76 N:27
		tail.params = proto.params -- S:77 N:28
		tail.stack = proto.stack -- S:78 N:29
		tail.flags = proto.flags -- S:79 N:30
		tail.descriptors = proto.descriptors -- S:80 N:31
		tail.count = count -- S:81 N:32
	end
	-- Canonical shared order is the C++ mutation order. TS publishes only
	-- after the following loop (T:4125); the mutator is paused in both cases.
	collector.publish_object(control, address) -- T:4125 C:162 P:147-155 Q:235-244
	local frame<const>: *closure_frame = frame_address -- T:4122 C:3057
	local missing_bits<const>: *u32 = &work.missing[0] -- T:4104-4105,4117 C:3043-3044,3055
	local resolved<const>: *u32 = &work.resolved[0] -- T:4085,4117-4118 C:3043,3047,3054
	local edges<const>: *u32 = address + non_capture_bytes -- T:4118,4123 S:58-59 C:3060 K:85-86 B:78-79
	local next_cell, plan = 0, 0 -- T:4115 C:3052
	index = 0 -- T:4116 C:3053
	while index < count do -- T:4116 C:3053
		if (index & 31) == 0 then plan = missing_bits[index >> 5] end -- T:4116-4117 C:3053,3055
		local reference = resolved[index] -- T:4117-4118 C:3054
		if (plan & 1) ~= 0 then -- T:4117 C:3055
			local capture<const> = reference -- T:4122 C:3058; consumed from the prepared raw word
			reference = layout.ram_base + cells[next_cell] -- T:4121 C:3056
			next_cell = next_cell + 1 -- T:4121 C:3056
			link_open(state, frame_address, reference, (frame.stack_base & frame_window_mask) + capture, owner) -- T:4122 C:3057-3058
		end
		edges[index] = reference -- T:4118,4123 C:3060 S:58-59 K:85-86 B:78-79
		plan = plan >> 1 -- T:4116-4117 C:3053,3055
		index = index + 1 -- T:4116 C:3053
	end
	return offset -- T:4127 C:3065; capture instructions pay ordinary cycles
end

local capture_charge<const> = function(binding, missing) -- L:244-245 R:251-252
	local proto<const>: *closure_binding = binding -- T:4076 C:3003
	local latched<const> = (proto.binding_flags >> latched_shift) & 1 -- T:4078 S:36,62 C:159,3021 N:19-20
	return capture_bytes(proto.count, latched) + missing * cell_bytes -- L:244-245 R:251-252
end

return {
	internal = { cell_flags_offset = cell_flags_offset, capture_bytes = capture_bytes, open_cell_address = open_cell_address, find_open = find_open, link_open = link_open },
	prepare_closure = prepare_closure, create_prepared_closure = create_prepared_closure, capture_charge = capture_charge,
}
