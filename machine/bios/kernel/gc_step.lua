module<const>

-- Source basis: 027fe97a6495926028a4cea6ef8cd15af8f5d191.
-- C/H: gc_heap.cpp/.h; T/L: gc_heap.ts and lua_heap.ts.
-- Work is collector policy credit. CPU cycles belong to the instructions
-- that execute these functions, not to the returned work count.
local layout<const> = require('kernel/gc_runtime_layout') -- C:1026,1261-1262,1270 T:1319
local gc<const> = require('kernel/gc_control') -- C:1019,1229,1241-1244 T:956,1111
local admission<const> = require('kernel/heap_admission') -- C:1257
local mark<const> = require('kernel/gc_mark_quantum') -- C:1093-1158
local atomic<const> = require('kernel/gc_atomic_quantum') -- C:705-714,1241
local sweep<const> = require('kernel/gc_sweep_quantum') -- C:1019-1042 T:973-986
local atomic_phase<const> = 3 -- H:20
local step_words<const> = 4096 -- H:18 L:16 C:1229

struct mark_quantum_context
	work: u32 -- C:1272
	limit: u32 -- C:1264
end

local step<const> = function(management, limit, growing_thread, compact_threads) -- C:1006-1010,1229,1241-1242
	local control<const> = management + layout.control_offset -- C:1270
	local current<const> = gc.internal.phase(control) -- C:1008,1019,1093,1108
	if current == atomic_phase then -- C:1008,1241
		local work<const> = atomic.atomic_quantum(management, limit) -- C:705-714,1241
		return work -- C:713-714
	end
	if current > atomic_phase then -- C:1019-1042
		local work<const> = sweep.sweep_quantum(management, limit, growing_thread, compact_threads) -- C:1027-1042,1166-1176
		return work -- C:1045
	end
	local arena<const> = management + layout.arena_offset -- C:1257
	local trace<const>: *mark_quantum_context = layout.ram_base + management + layout.trace_context_offset -- C:1261-1262
	local mode_key<const>: *u32 = layout.ram_base + management + layout.arguments_offset -- C:1276; first projected word
	local capacity<const> = admission.heap_capacity(arena) -- C:1257
	trace.limit = limit -- C:1264
	local work<const> = mark.mark_quantum(control, arena, management + layout.metadata_offset, management + layout.remark_head_offset,
		management + layout.root_banks_offset, management + layout.trace_context_offset, *mode_key, capacity) -- C:1093-1158,1250-1258
	return work -- C:1045
end

local finish_epoch<const> = function(management, limit, growing_thread, compact_threads) -- C:1225-1229,911,918
	local work = 0 -- C:911,915-918
	repeat -- C:1229
		work = work + step(management, limit, growing_thread, compact_threads) -- C:1229; keep work, not the former synthetic charge
	until not gc.internal.active(management + layout.control_offset) -- C:1229
	return work -- C:911; unsigned difference between the final and initial epoch counters
end

return { step = step, finish_epoch = finish_epoch, step_words = step_words }
