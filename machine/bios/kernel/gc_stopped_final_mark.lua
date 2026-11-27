module<const>

-- Source basis: e0c23289f0726a6df2db394188471de4ea3d37fb.
-- G: C++ GcHeap; E: C++ Direct executor; F: C++ frame admission;
-- R: CPU run kind. The paused CPU supplies the admission, not a phase or
-- an allowance. The complete final pass runs before the mutator can resume.
local root_inputs<const> = require('kernel/gc_root_inputs') -- G:1261-1262,1291,1300,1353
local collector<const> = require('kernel/gc_step') -- G:689-712
local scheduled<const> = 2 -- R:15 F:61-63 E:155

local stopped_final_mark<const> = function(management, run_kind) -- F:61-67 E:155,204
	root_inputs.publish(management) -- G:1263-1267,1291,1353
	local work<const> = collector.finish_atomic(management, 0, run_kind == scheduled) -- G:689-712 E:155,204 F:61-67
	root_inputs.release_string_work(management) -- G:1276,1304-1306,1394
	return work -- G:702,712; policy work is not an additional CPU charge
end

return { stopped_final_mark = stopped_final_mark }
