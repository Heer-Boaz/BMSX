local clock<const> = require('cartlib/clock')

local transition_recorder<const> = {}
transition_recorder.__index = transition_recorder

-- The recorder itself is the retained observation channel. Immutable instance
-- identity is stored once in fields 1-3; field 4 publishes fully written
-- records from the fixed-capacity array in field 5.
function transition_recorder.new(machine, capacity)
	local records<const> = {}
	for i = 1, capacity do
		records[i] = { 0, 0, '', '', '', false }
	end
	local self<const> = setmetatable({
		machine.id,
		machine.def_id,
		capacity,
		0,
		records,
	}, transition_recorder)
	self.machine = machine
	machine:attach_transition_recorder(self)
	return self
end

-- Called only by the FSM's actual guard/commit boundary. All record storage is
-- allocated by new(); publishing the sequence last makes each slot atomic to
-- the suspended host-side scenario consumer.
function transition_recorder:record(lane, previous, target, committed)
	local sequence<const> = self[4] + 1
	local record<const> = self[5][((sequence - 1) % self[3]) + 1]
	record[1] = sequence
	record[2] = clock.milliseconds()
	record[3] = lane.def_id
	record[4] = previous.def_id
	record[5] = target.def_id
	record[6] = committed
	self[4] = sequence
end

function transition_recorder:dispose()
	self.machine:detach_transition_recorder(self)
end

return transition_recorder
