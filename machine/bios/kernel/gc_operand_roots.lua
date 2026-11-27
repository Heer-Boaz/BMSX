module<const>

-- Source basis: 0c6a56e249865e6c71ed92d7c3b4b51186578f0c.
-- T/C = gc_heap.ts/.cpp, H = gc_heap.h, A/B = table.ts/.cpp,
-- V/W = value.ts/.h, S/R = string_pool.ts/.cpp, M = memory_map.ts.
-- Scoped CoroutineCreate basis: 08c4a76d41e49d689c13a47fed3de37cece84072.
-- L/N = LuaHeap, E/F = canonical reference decode (GcHeap).
local control_layout<const> = require('kernel/gc_control') -- T:27 H:24
local layout<const> = require('kernel/gc_runtime_layout') -- M:6
local mark<const> = require('kernel/gc_mark') -- T:324-325,345-352 C:77-92,297-298

-- The resolved receiver already has Table type. The other two roots arrive
-- as Value lanes, not as a second lookup through the mutating table.
struct table_operand_roots
	receiver: addr -- A:761,788,793 B:255 V:31 W:42
	key_tag: u32 -- A:758,788,793 B:249,255 V:10-11,23 W:29
	key_word: u32 -- A:758,788,793 B:249,255 V:24 W:30
	value_tag: u32 -- A:758,788,793 B:249,255 V:10-11,23 W:29
	value_word: u32 -- A:758,788,793 B:249,255 V:24 W:30
end

local table_kind<const> = 6 -- V:10-11 W:21-22
local closure_kind<const> = 7 -- V:10-11 W:21-22 E:173-175 F:253-256 L:174 N:186
local trace_head<const> = control_layout.internal.trace_head_offset -- T:27 H:24

-- Detached frame basis: 3f062191f262da02ea9cf8746b36481aa7e0c2a6.
-- D/I/J = native CPU/implicit call/GC; X/Y = TS CPU/GC;
-- U/K = native canonical Frame control and former prepared argument source.
-- The root scope is published by BIOS from its tagged exception arguments.
struct exception_argument_roots
	closure: addr -- U:41-42,124 I:17-20
	supplied: u32 -- K:84 I:16,20 X:606,612
	values: value[3] -- I:15-20 X:604-606,610-612
end
local detached_scope_tag<const> = 1 -- I:15-20; not a Table tuple or absolute Closure

-- Only synchronous Atomic marked the temporary method/argument scope;
-- ordinary Mark and major remark mark the explicit Closure alone.
local mark_detached_frame_roots<const> = function(control, arena, metadata, scope, atomic) -- I:15-20 X:604-612 J:724-730
	local source<const> = layout.ram_base + (scope & ~detached_scope_tag) -- I:15-20 K:84
	local roots<const>: *exception_argument_roots = source -- I:15-20 K:84
	local work = 0 -- J:717,730
	if atomic then -- J:724-730 Y:675-679; stored operand scope only at synchronous final mark
		mark.mark_record(control, arena, roots.closure, closure_kind, trace_head, 1) -- I:15 D:3259-3260 X:604,5395
		local inputs<const>: *value = source + offsetof(exception_argument_roots.values) -- I:16 X:604-605
		for slot = 0, roots.supplied - 1 do -- I:16 D:3259-3260 X:604-605,5395
			local address<const> = &inputs[slot] -- I:16 X:604-605
			local word<const>: *u32 = address -- I:16 X:604
			local tag<const>: *u8 = address + layout.value_cell_tag_offset -- I:16 X:604-605
			local _<const>, added<const> = mark.mark_value(control, arena, metadata, *tag, *word, trace_head, 1) -- J:727,730 I:16 D:3259-3260 X:604-605,5395
			work = work + added -- J:730 Y:679
		end
	end
	mark.mark_record(control, arena, roots.closure, closure_kind, trace_head, 1) -- I:18-20 X:610-612 J:678,729,1032 Y:630,678,964
	return work -- J:730,1033 Y:679,965
end

-- Borrowed String basis: e3774a03a44e94be4d9d8be73c7ce2de80a336c2.
-- InternSource: TS 365–368, C++ 355–359; LuaHeap passes that tagged root0.
-- An operation borrowing one Value publishes its raw tag and payload,
-- independent of whether that Value is a String, Table or another type.
struct single_value_roots
	tag: u32 -- V:23 W:29
	payload: u32 -- V:24 W:30
end

local single_value_scope_tag<const> = 2 -- Z:365-368; separate from the existing Table and argument descriptors

local single_value_scope<const> = function(management, tag, payload) -- Z:365-368
	-- No table planner can run while this activation borrows its roots.
	local offset<const> = management + layout.table_plan_offset -- Z:366-368; lifetime of the old root0 argument
	local root<const>: *single_value_roots = layout.ram_base + offset -- V:23-24 W:29-30
	root.tag = tag -- V:23 W:29 Z:368
	root.payload = payload -- V:24 W:30 Z:368
	return offset | single_value_scope_tag -- Z:368; encode the software scope, not a console register
end

-- This is the explicit operand suffix, not the ordinary root head or the
-- scope of an unrelated synchronous builtin. Mark invokes it after initial
-- banks, major remark on reaching Roots before its banks, and scoped Atomic
-- after the visits and before the final tail. The caller drains incoming
-- String work at the original phase boundary.
local mark_operand_roots<const> = function(control, arena, metadata, scope, atomic) -- T:656-657,710-711,1060-1061 C:677-678,734-735,1136-1137
	-- Issued Closure references are canonical absolute RAM addresses; the
	-- published Table tuple is a physical RAM offset. The caller handles
	-- absent scope (zero). Both are known machine representations.
	if scope >= layout.ram_base then -- M:6 E:164-168,173-175 F:253-256 L:174 N:186
		mark.mark_record(control, arena, scope, closure_kind, trace_head, 1) -- T:324-325,348,656,710,1060 C:81-82,100,677,734,1136
		return 0 -- L:174 N:186; Closure root and two nil roots produce no String work
	end
	if (scope & detached_scope_tag) ~= 0 then -- I:15-20; traverse the firmware's explicit operand scope
		local work<const> = mark_detached_frame_roots(control, arena, metadata, scope, atomic) -- J:724-730 I:15-20
		return work -- J:730,1033
	end
	if (scope & single_value_scope_tag) ~= 0 then -- T:656,710,1060 C:677,734,1136
		local root<const>: *single_value_roots = layout.ram_base + (scope & ~single_value_scope_tag) -- T:656,710,1060 C:677,734,1136
		local _<const>, work<const> = mark.mark_value(control, arena, metadata, root.tag, root.payload, trace_head, 1) -- T:345-352,656,710,1060 C:77-92,677,734,1136
		return work -- T:657,711,1061 C:678,735,1137
	end
	local roots<const>: *table_operand_roots = layout.ram_base + scope -- A:761,788,793 B:255 M:6; published operand lanes
	if roots.receiver ~= 0 then -- A:761 B:255; named namespace writes have no Table receiver
		mark.mark_record(control, arena, roots.receiver, table_kind, trace_head, 1) -- T:324-325,347,656,710,1060 C:81-82,100,297-298,677,734,1136
	end
	local _<const>, key_work<const> = mark.mark_value(control, arena, metadata, roots.key_tag, roots.key_word, trace_head, 1) -- T:345-352,656,710,1060 C:77-92,100,677,734,1136
	local _<const>, value_work<const> = mark.mark_value(control, arena, metadata, roots.value_tag, roots.value_word, trace_head, 1) -- T:345-352,656,710,1060 C:77-92,100,677,734,1136
	return key_work + value_work -- T:657,711,1061 C:678,735,1137 S:445,447-450 R:438,440
end

-- Table copy basis: 8cf6e61b2b8207a31ae7be9c7acb095910ff2793.
-- P/Q: Table copy calls admission. No rehash runs in this activation;
-- borrow the existing planner workspace for its admitted raw root tuple.
local table_copy_scope<const> = function(management, source) -- P:35-36 Q:71-72
	local offset<const> = management + layout.table_plan_offset -- P:35-36 Q:71-72; publish the formerly native argument tuple
	local scope<const>: *table_operand_roots = layout.ram_base + offset -- P:35-36 Q:71-72
	scope.receiver = source -- P:36 Q:72
	scope.key_tag = 0 -- P:36 Q:72
	scope.key_word = 0 -- P:36 Q:72
	scope.value_tag = 0 -- P:36 Q:72
	scope.value_word = 0 -- P:36 Q:72
	return offset -- P:35-36 Q:71-72
end

-- GlobalBank inserts a name with these two explicit admission roots.
local global_write_scope<const> = function(management, key, tag, payload)
	local offset<const> = management + layout.table_plan_offset
	local scope<const>: *table_operand_roots = layout.ram_base + offset
	scope.receiver = 0
	scope.key_tag = 5
	scope.key_word = key
	scope.value_tag = tag
	scope.value_word = payload
	return offset
end

return {
	internal = { mark_detached_frame_roots = mark_detached_frame_roots }, -- I:15-20
	exception_argument_scope = detached_scope_tag, -- I:15-20
	mark_operand_roots = mark_operand_roots, -- T:656-657 C:677-678
	single_value_scope = single_value_scope, -- Z:368
	global_write_scope = global_write_scope,
	table_copy_scope = table_copy_scope, -- P:35-36 Q:71-72
} -- I:15-20 P:35-36
