module<const>

-- Source basis: 04c10f896545d453bd50fe27ccb619b269966607.
-- C/H: C++ collector; S: StringPool; O: object layout; R: CPU roots;
-- M: RAM. The caller publishes the ordinary roots, limit and pending String
-- work once. Only a resolved Table operation supplies explicit operands.
local allocator<const> = require('kernel/dlmalloc') -- C:1008,1257
local layout<const> = require('kernel/gc_runtime_layout') -- C:1189; post-retirement fixed-work latch
local control_layout<const> = require('kernel/gc_control') -- H:93,213-229
local epoch<const> = require('kernel/gc_epoch') -- C:1008,1045,1072-1082,1116-1117,1252-1258
local trace<const> = require('kernel/gc_trace') -- C:546-555,1154
local remark<const> = require('kernel/gc_remark') -- C:645-670,1104,1197
local operands<const> = require('kernel/gc_operand_roots') -- C:677-678,1138-1139
local banks<const> = require('kernel/gc_root_banks') -- C:619-642,681,1135
local ram_base<const> = 0x08000000 -- M:6
local phase_offset<const> = control_layout.internal.phase_offset -- H:93,229
local remark_state_offset<const> = control_layout.internal.remark_visit_state_offset -- H:39,214,217
local root_cursor_offset<const> = control_layout.internal.root_cursor_offset -- C:682,1127 H:43
local remark_stage_shift<const> = 19 -- H:214,217 O:17
local mark<const> = 1 -- H:20
local mark_again<const> = 2 -- H:20
local atomic<const> = 3 -- H:20
local threads<const> = 1 -- H:157
local root_stage<const> = 3 -- H:157
local concat_operands<const> = 7 -- H:21 C:681,1135
-- This common entry fixes the C++ issuance/read/recolor order; no
-- mutable policy selector is part of the ABI.
local cpp_policy<const> = 1 -- C:1266 H:160-163

struct mark_context
	work: u32 -- C:546,1272
	limit: u32 -- C:546,1264
	atomic: u32 -- C:546,1265
	pending_string_work: u32 -- S:438-440; retained across native String latch drains
end

local remark_stage<const> = function(control) -- H:213-214
	local state<const>: *u32 = ram_base + control + remark_state_offset -- H:214
	return *state >> remark_stage_shift -- H:214
end

local visit_and_remark_roots<const> = function(control, arena, metadata, head, descriptor, quantum, work, limit, scope) -- C:673,1104-1107,1197-1199
	local state<const>: *mark_context = ram_base + quantum -- C:1262
	local pending<const>: *u32 = ram_base + head -- C:666 S:438-440; remark head's first field
	*pending = state.pending_string_work -- C:666 S:438-440
	local visits<const> = remark.remark_visits(control, arena, metadata, head, limit - work, cpp_policy) -- C:1104,1197
	work = work + visits -- C:1104,1197
	state.pending_string_work = *pending -- C:666 S:438-440; keep credit if visits stopped
	if remark_stage(control) ~= root_stage then return work end -- C:1105,1198
	if scope ~= 0 then -- C:677; mark the operation's explicit operands
		local added<const> = operands.mark_operand_roots(control, arena, metadata, scope, false) -- C:677
		work = work + added -- C:678; new String work joins the existing latch drain
	end
	work = work + state.pending_string_work -- C:678
	state.pending_string_work = 0 -- C:678 S:438-440
	if work < limit then work = banks.trace_root_banks(control, arena, metadata, descriptor, limit, work, concat_operands, cpp_policy) end -- C:681
	local root_cursor<const>: *u32 = ram_base + control + root_cursor_offset -- C:682
	if *root_cursor == 0 then -- C:682
		local remark_state<const>: *u32 = ram_base + control + remark_state_offset -- C:683 H:217
		*remark_state = 0 -- C:683 H:157,217; major remark returns to None
		local phase<const>: *u8 = ram_base + control + phase_offset -- C:684 H:229
		*phase = mark_again -- C:684
	end
	return work -- C:686
end

local mark_quantum<const> = function(control, arena, metadata, head, descriptor, quantum, mode_key, capacity, scope) -- C:1006-1008,1015,1085-1087
	local occupied<const> = allocator.bmsx_dlmalloc_occupied_bytes(arena) -- C:1008
	local state<const>: *mark_context = ram_base + quantum -- C:1262
	local limit<const> = state.limit -- C:1086
	local work = 0 -- C:1092
	if remark_stage(control) ~= 0 then -- C:1093
		work = visit_and_remark_roots(control, arena, metadata, head, descriptor, quantum, work, limit, scope) -- C:1104-1106
		if control_layout.internal.phase(control) == mark then -- C:1105,1107
			local accounted<const> = epoch.finish_step(control, arena, occupied, work) -- C:1045,1072-1082
			return accounted -- C:1105,1107
		end
	else -- C:1108; only Pause, Mark and MarkAgain enter this operation
		if epoch.begin_mark(control, metadata) ~= 0 then -- C:1112,1116-1117
			local pending<const>: *u32 = ram_base + head -- C:1123-1124 S:438-440
			*pending = state.pending_string_work -- C:1123-1124 S:438-440
			remark.mark_root_head(control, arena, metadata, head, 1, cpp_policy) -- C:1123-1124 R:3200-3210
			state.pending_string_work = *pending -- C:1126-1128 S:438-440
			epoch.begin_initial_banks(control, arena, capacity) -- C:1125,1252-1258
		end
		local root_cursor<const>: *u32 = ram_base + control + root_cursor_offset -- C:1127
		if *root_cursor ~= 0 then -- C:1127
			work = work + state.pending_string_work -- C:1128 S:438-440
			state.pending_string_work = 0 -- C:1128 S:438-440
			if work < limit then work = banks.trace_root_banks(control, arena, metadata, descriptor, limit, work, concat_operands, cpp_policy) end -- C:1129,1135
		end
		if scope ~= 0 then -- C:1138; no guard on the remaining root-bank allowance
			local added<const> = operands.mark_operand_roots(control, arena, metadata, scope, false) -- C:1138
			work = work + added -- C:1139; new String work joins the existing latch drain
		end
		work = work + state.pending_string_work -- C:1139
		state.pending_string_work = 0 -- C:1139 S:438-440
	end
	while work < limit do -- C:1141,1157
		state.work = work -- C:546,1154,1272
		state.atomic = 0 -- C:1154; this entry stops at Atomic admission
		work = trace.trace_quantum(control, arena, metadata, quantum, mode_key, 0, 0, cpp_policy) -- C:1154
		if work >= limit then break end -- C:1157,1185-1187
		if control_layout.internal.phase(control) == mark_again then -- C:1188
			local phase<const>: *u8 = ram_base + control + phase_offset -- C:1189 H:229
			*phase = atomic -- C:1189
			-- Post work now, but admit it only after this activation has
			-- committed its results and made the receiving roots visible.
			local pending<const>: *u32 = ram_base + control - layout.control_offset + layout.fixed_work_offset -- C:1189; CPU continuation boundary
			*pending = layout.stopped_final_mark_work -- C:1189; posts the work formerly inferred from the phase
			break -- C:1190
		end
		local remark_state<const>: *u32 = ram_base + control + remark_state_offset -- C:1192 H:217
		*remark_state = threads << remark_stage_shift -- C:1192 H:157,217
		work = visit_and_remark_roots(control, arena, metadata, head, descriptor, quantum, work, limit, scope) -- C:1156,1197-1199
		if control_layout.internal.phase(control) ~= mark_again then break end -- C:1157-1158
	end
	epoch.finish_step(control, arena, occupied, work) -- C:1045,1072-1082
	return work -- C:1045
end

return {
	internal = {
		remark_stage = remark_stage,
		visit_and_remark_roots = visit_and_remark_roots,
	},
	mark_quantum = mark_quantum,
}
