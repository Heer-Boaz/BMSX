module<const>

-- Source basis: 027fe97a6495926028a4cea6ef8cd15af8f5d191.
-- C/H: C++ collector; A: native arena; S: String latch; O: object layout.
-- The stopped, nil-scoped final mark consumes one allowance. The caller
-- supplies a stable root publication, not a choice of collector phase.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1261-1262,1270
local control_layout<const> = require('kernel/gc_control') -- C:713,764-767
local allocator<const> = require('kernel/dlmalloc') -- C:793 A:49-50
local remark<const> = require('kernel/gc_remark') -- C:725-726
local banks<const> = require('kernel/gc_root_banks') -- C:748,681
local trace<const> = require('kernel/gc_trace') -- C:759
local weak<const> = require('kernel/gc_weak_quantum') -- C:784
local epoch<const> = require('kernel/gc_epoch') -- C:784,787-795
local remark_shift<const> = 19 -- H:214,217 O:17
local thread_visits<const> = 1 -- H:157
local weak_visits<const> = 2 -- H:157
local roots<const> = 3 -- H:157
local gray<const> = 4 -- H:157
local clear_weak<const> = 5 -- H:157
local end_bank<const> = 8 -- H:21 C:681,748
local trace_head<const> = 4 -- C:765 H:23
local cpp_policy<const> = 1 -- C:740,1266 H:160-163

struct atomic_arguments
	mode_key: u32 -- C:781,1276
	new_index_key: u32 -- C:781
	active_thread: addr -- C:1277
	pending_top: u32 -- C:1274-1277
end

struct atomic_context
	work: u32 -- C:546,770,1272
	limit: u32 -- C:546,771,1264
	atomic: u32 -- C:546,1265
	pending_string_work: u32 -- C:772,1273 S:438-440
end

local atomic_quantum<const> = function(state, limit) -- C:705-715
	local control<const>, arena<const> = state + layout.control_offset, state + layout.arena_offset -- C:1270,1276
	local metadata<const>, context<const> = state + layout.metadata_offset, state + layout.trace_context_offset -- C:1262,1276
	local quantum<const>: *atomic_context = layout.ram_base + context -- C:718,1264-1265
	local remark_state<const>: *u32 = layout.ram_base + control + control_layout.internal.remark_visit_state_offset -- H:214,217
	local stage = *remark_state >> remark_shift -- C:719 H:214
	local work = 0 -- C:717
	if stage == 0 then -- C:719
		*remark_state = thread_visits << remark_shift -- C:719 H:217
		stage = thread_visits -- C:720
	end
	if stage <= weak_visits then -- C:720
		local head<const> = state + layout.remark_head_offset -- C:1300,1303
		local mark_work<const>: *u32 = layout.ram_base + head -- C:1303,1313
		*mark_work = quantum.pending_string_work -- C:1300-1303 S:438-440
		work = remark.remark_visits(control, arena, metadata, head, limit, cpp_policy) -- C:725
		quantum.pending_string_work = *mark_work -- C:1313-1315 S:438-440
		stage = *remark_state >> remark_shift -- C:726 H:214
		if stage ~= roots then -- C:726
			local accounted<const> = control_layout.account_epoch_work(control, work) -- C:713
			return accounted -- C:713,726
		end
	end
	if work < limit and stage == roots then -- C:742-743
		work = work + quantum.pending_string_work -- C:678,748 S:438-440
		quantum.pending_string_work = 0 -- C:678 S:440; scoped host roots are absent in this entry
		if work < limit then -- C:681
			work = banks.trace_root_banks(control, arena, metadata, state + layout.root_banks_offset, limit, work, end_bank, cpp_policy) -- C:681,748
		end
		local cursor<const>: *u32 = layout.ram_base + control + control_layout.internal.root_cursor_offset -- C:682
		if *cursor ~= 0 then -- C:682,749
			local accounted<const> = control_layout.account_epoch_work(control, work) -- C:713
			return accounted -- C:713,749
		end
		*remark_state = gray << remark_shift -- C:683 H:217
		stage = gray -- C:751
	end
	local arguments<const>: *atomic_arguments = layout.ram_base + state + layout.arguments_offset -- C:1274-1277,781
	if work < limit and stage == gray then -- C:742,749,751
		quantum.work = work -- C:759,1272
		quantum.limit = limit -- C:759,1264
		quantum.atomic = 1 -- C:759,1265
		work = trace.trace_quantum(control, arena, metadata, context, arguments.mode_key, -- C:759,1276
			arguments.active_thread, arguments.pending_top, cpp_policy) -- C:759,1274-1277
		local frontier<const>: *u32 = layout.ram_base + control + control_layout.internal.trace_record_offset -- C:765
		if *frontier ~= 0 or control_layout.internal.index_word(control, trace_head) ~= 0 then -- C:765
			local accounted<const> = control_layout.account_epoch_work(control, work) -- C:713
			return accounted -- C:713,766
		end
		*remark_state = clear_weak << remark_shift -- C:767 H:217
	end
	if work < limit then -- C:742,749,761,768
		quantum.work = work -- C:770
		quantum.limit = limit -- C:771
		work = weak.clear_weak_step(control, arena, metadata, context, arguments.mode_key, arguments.new_index_key, cpp_policy) -- C:784
		local floor<const> = allocator.bmsx_dlmalloc_floor(arena) -- C:793 A:49-50
		work = epoch.finish_atomic_collection(control, arena, metadata, state - floor, work) -- C:784,787-795 A:50
	end
	local accounted<const> = control_layout.account_epoch_work(control, work) -- C:713
	return accounted -- C:713
end

return { atomic_quantum = atomic_quantum }
