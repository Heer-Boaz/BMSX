module<const>

-- Source basis: 04c10f896545d453bd50fe27ccb619b269966607.
-- T/C/H: mirrored collector owners; L/B: logical budget; A/N: arena;
-- S/R: String pool; M: RAM spec. The BIOS caller owns the epoch. The
-- sampled capacity is the arena extent, not a host admission decision.
local gc<const> = require('kernel/gc_control') -- T:76-92,761-770,992-1016 C:788-795,1072-1082,1202-1213
local pace<const> = require('kernel/gc_pace') -- T:768,1000-1002,1155 C:793,1079-1080,1257
local strings<const> = require('kernel/gc_strings') -- T:768,1008,1012,1041 C:793,1117,1205,1209 S:445,454-460 R:438,443-450
local allocator<const> = require('kernel/dlmalloc') -- T:998-1002,1155 C:1079,1257 A:51 N:50
local budget<const> = require('kernel/heap_admission') -- T:1014 C:1211 L:314-318 B:324-328
local ram_base<const> = 0x08000000 -- M:6
local pause<const> = 0 -- T:70 H:20
local mark<const> = 1 -- T:70 H:20
local sweep<const> = 4 -- T:70 H:20
local string_sweep<const> = 5 -- T:70 H:20
local system_globals<const> = 1 << 20 -- T:60,71,1151 H:21 C:72,1253

local begin_mark<const> = function(control, metadata) -- T:1037-1042 C:1111-1118
	if gc.internal.phase(control) ~= pause then return 0 end -- T:1039 C:1112; return whether the original start transition ran
	local phase<const>: *u8 = ram_base + control + gc.internal.phase_offset -- T:103 H:93
	*phase = mark -- T:1041 C:1116
	strings.begin_reachability_epoch(metadata) -- T:1041 C:1117 S:445 R:438
	return 1 -- T:1042 C:1118; the calling quantum performs the fixed roots
end

local begin_initial_banks<const> = function(control, arena, capacity) -- T:1150 C:1252
	local base<const> = ram_base + control -- T:1151-1154 C:1253-1256 M:6
	local roots<const>: *u32 = base + gc.internal.root_cursor_offset -- T:1151 C:1253
	*roots = system_globals -- T:1151 C:1253
	local previous<const>: *u32 = base + gc.internal.last_epoch_work_offset -- T:1154 C:1256
	local occupied<const> = allocator.bmsx_dlmalloc_occupied_bytes(arena) -- T:1155 C:1257 A:51 N:50; stable across these reads
	local estimate = *previous -- T:1154-1155 C:1256-1257
	if estimate == 0 then -- T:1155 C:1257
		estimate = occupied >> 2 -- T:1155 C:1257
		if estimate == 0 then estimate = 1 end -- T:1155 C:1257
	end
	pace.begin_pace_credit(control, occupied, capacity, estimate, 1) -- T:1155 C:1257
end

local finish_step<const> = function(control, arena, occupied_before, work) -- T:992 C:1072
	if gc.internal.active(control) then -- T:993 C:1073
		local base<const> = ram_base + control -- T:997-1002 C:1077-1080 M:6
		local basis<const>: *u32 = base + pace.internal.basis_offset -- T:996 C:1077
		local paid<const>: *u32 = base + pace.internal.paid_offset -- T:997 C:1078
		local estimate<const>: *u32 = base + pace.internal.estimate_offset -- T:999 C:1080
		local runway<const>: *u32 = base + pace.internal.runway_offset -- T:1000 C:1080
		local occupied<const> = allocator.bmsx_dlmalloc_occupied_bytes(arena) -- T:998 C:1079 A:51 N:50
		pace.update_pace_credit(control, *basis + occupied - occupied_before, *paid + work, *estimate, *runway) -- T:998-1000 C:1079-1080
	end
	local accounted<const> = gc.account_epoch_work(control, work) -- T:1002 C:1082
	return accounted -- T:1002 C:1082; keep the fixed one-result call
end

local finish_atomic_collection<const> = function(control, arena, metadata, capacity, work) -- T:761 C:787
	local base<const> = ram_base + control -- T:762-766 C:788-791 M:6
	local trace<const>: *u32 = base + gc.internal.trace_record_offset -- T:762 C:788
	if *trace ~= 0 or gc.internal.index_word(control, gc.internal.weak_visits_offset) ~= 0 then return work end -- T:762 C:788
	local white<const>: *u8 = base + gc.internal.white_offset -- T:763 C:789
	*white = (*white & 1) ~ 1 -- T:86,763 H:91 C:789
	local link<const>: *addr = base + gc.internal.sweep_link_offset -- T:764 C:790
	*link = control + gc.internal.object_head_offset -- T:764 C:790; inventory head is an offset, as in the source
	local remark<const>: *u32 = base + gc.internal.remark_visit_state_offset -- T:628-629,765 C:791
	*remark = 0 -- T:67,629,765 C:791
	local count<const>: *u32 = base + gc.internal.object_count_offset -- T:768 C:793
	local estimate<const> = *count + strings.estimate_sweep_work(metadata) -- T:768 C:793 S:460 R:450
	local occupied<const> = allocator.bmsx_dlmalloc_occupied_bytes(arena) -- T:767,916 C:793,960 A:51 N:50
	pace.begin_pace_credit(control, occupied, capacity, estimate, 0) -- T:768 C:793
	local phase<const>: *u8 = base + gc.internal.phase_offset -- T:86,769 C:794
	*phase = sweep -- T:769 C:794
	return work -- T:770 C:795
end

local begin_strings<const> = function(control, metadata) -- T:1005 C:1202
	local base<const> = ram_base + control -- T:1006-1007 C:1203-1204 M:6
	local changed<const>: *u32 = base + gc.internal.changed_head_offset -- T:1006 C:1203
	*changed = 0 -- T:1006 C:1203
	local phase<const>: *u8 = base + gc.internal.phase_offset -- T:86,1007 C:1204
	*phase = string_sweep -- T:1007 C:1204
	strings.begin_sweep(metadata) -- T:1008 C:1205 S:454-458 R:443-447
end

local finish_strings<const> = function(control, metadata, arena) -- T:1011 C:1208
	if not strings.sweeping(metadata) then -- T:1012 C:1209 S:459 R:448
		local phase<const>: *u8 = ram_base + control + gc.internal.phase_offset -- T:86,1013 C:1210 M:6
		*phase = pause -- T:1013 C:1210
		budget.finish_collection(arena) -- T:1014 C:1211 L:314-318 B:324-328
	end
end

return {
	begin_mark = begin_mark,
	begin_initial_banks = begin_initial_banks,
	finish_step = finish_step,
	finish_atomic_collection = finish_atomic_collection,
	begin_strings = begin_strings,
	finish_strings = finish_strings,
}
