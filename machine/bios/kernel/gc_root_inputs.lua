module<const>

-- Source basis: 7263db50b65a103805921517491bcbb1ce758cd9.
-- T/C: CPU root publication. S/R: native StringPool mark credit.
local layout<const> = require('kernel/gc_runtime_layout') -- T:4150-4156 C:330-337

local borrow_string_work<const> = function(management) -- T:4152 C:332 S:452-455 R:442-445
	local state<const> = layout.ram_base + management -- T:4150-4152 C:330-332
	local canonical<const>: *u32 = state + layout.string_mark_work_offset -- S:453-454 R:443-444
	local trace<const>: *u32 = state + layout.trace_context_offset + layout.trace_string_work_offset -- T:4151-4152 C:331-332
	local work<const> = *canonical -- S:453 R:443
	if work ~= 0 then *canonical = 0 end -- S:454 R:444
	*trace = work -- T:4152 C:332
end

local release_string_work<const> = function(management) -- T:4159-4162 C:340-343 S:457-459 R:447-449
	local state<const> = layout.ram_base + management -- T:4160 C:341
	local canonical<const>: *u32 = state + layout.string_mark_work_offset -- S:458 R:448
	local trace<const>: *u32 = state + layout.trace_context_offset + layout.trace_string_work_offset -- T:4160-4161 C:341-342
	local work<const> = *trace -- T:4161 C:342
	if work ~= 0 or *canonical ~= 0 then *canonical = work end -- S:458 R:448
end

-- System exception entry latches the suspended Thread; the BIOS has
-- installed the root Thread. Completed tool results are not guest roots.
local publish<const> = function(management)
	local state<const> = layout.ram_base + management
	local interrupted<const>: *addr = layout.interrupted_context_address
	local roots<const>: *root_descriptors = state + layout.root_banks_offset
	roots.active = *interrupted
	roots.completion_thread = 0
	roots.halted = 0
	roots.banks[0].count = 0 -- no completed host observations
	local head<const>: *root_head_input = state + layout.remark_head_offset
	head.comparison_remaining = 0
	head.has_pending_assignment = 0
	borrow_string_work(management)
end

return { publish = publish, borrow_string_work = borrow_string_work, release_string_work = release_string_work }
