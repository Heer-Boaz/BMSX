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

-- This is the explicit operand suffix, not the ordinary root head or the
-- scope of an unrelated synchronous builtin. Mark invokes it after initial
-- banks, major remark on reaching Roots before its banks, and scoped Atomic
-- after the visits and before the final tail. The caller drains incoming
-- String work at the original phase boundary.
local mark_operand_roots<const> = function(control, arena, metadata, scope) -- T:656-657,710-711,1060-1061 C:677-678,734-735,1136-1137
	-- Issued Closure references are canonical absolute RAM addresses; the
	-- published Table tuple is a physical RAM offset. The caller handles
	-- absent scope (zero). Both are known machine representations.
	if scope >= layout.ram_base then -- M:6 E:164-168,173-175 F:253-256 L:174 N:186
		mark.mark_record(control, arena, scope, closure_kind, trace_head, 1) -- T:324-325,348,656,710,1060 C:81-82,100,677,734,1136
		return 0 -- L:174 N:186; Closure root and two nil roots produce no String work
	end
	local roots<const>: *table_operand_roots = layout.ram_base + scope -- A:761,788,793 B:255 M:6; published operand lanes
	mark.mark_record(control, arena, roots.receiver, table_kind, trace_head, 1) -- T:324-325,347,656,710,1060 C:81-82,100,297-298,677,734,1136
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

return { mark_operand_roots = mark_operand_roots, table_copy_scope = table_copy_scope }
