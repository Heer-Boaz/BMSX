module<const>

-- Source basis: 7adffc6751300300166f0188f367ff7bab224a13.
-- T/C: CPU warm reset and roots; F: C++ mark-credit publication;
-- S/R: the String work owner. Hardware already stopped the old context.
-- The stopped producer reads its ordinary RAM once; no firmware effects
-- or projected load selectors are consulted while owning this recovery.
local layout<const> = require('kernel/gc_runtime_layout') -- T:4148-4157 C:3273-3299 F:327-337
local root_inputs<const> = require('kernel/gc_root_inputs') -- T:4153 F:332 S:452-455 R:442-445

local publish<const> = function(management, previous_root) -- T:858-880,893-929,950-955 C:187-219,627-632,3273-3299
	local state<const> = layout.ram_base + management -- M:6
	local head<const>: *root_head_input = state + layout.remark_head_offset -- T:5322-5339 C:3217-3234
	-- Keep the pinned Mode/Index/NewIndex/Length/Error/FaultIds published by
	-- diagnostic setup. Only the old stopped operands have ceased to be roots.
	head.comparison_remaining = 0 -- T:903,5326 C:198,3221
	head.has_pending_assignment = 0 -- T:910,5337 C:197,3232

	local roots<const>: *root_descriptors = state + layout.root_banks_offset -- T:5384 C:3275
	roots.root = previous_root -- T:5472 C:3368
	roots.active = previous_root -- T:876,5472 C:3187,3369 F:337; stack cleanup has already returned the active root
	roots.completion_thread = previous_root -- T:879,5472 C:3190,3370
	roots.halted = 0 -- T:897-899,5473 C:191-193,3371
	-- Both namespace records are already retired by warm_bindings.
	-- Literal roots are still visible in the installed operand records.

	roots.banks[0].count = 0 -- T:893,5440 C:187,3336; no prior completion values
	roots.banks[1].count = 0 -- T:909,5441 C:199,3337; no in-flight concatenation
	root_inputs.borrow_string_work(management) -- T:4153 F:332 S:452-455 R:442-445
	local pending_top<const>: *u32 = state + layout.pending_top_offset -- T:4157,909 F:334,337 C:199
	*pending_top = 0 -- T:4157,909 F:334,337 C:199
end

return { publish = publish }
