local clock<const> = require('cartlib/clock')

local transition_recorder<const> = {}
transition_recorder.__index = transition_recorder

-- The recorder is loaded only into a traced Scenario cartridge. Immutable
-- instance identity lives in fields 1-3; field 4 publishes complete records
-- from the fixed-capacity array in field 5.
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
	blua32.trace_sink(machine, 'fsm.transition', self)
	return self
end

-- The traced producer calls this only on its actual guard/commit boundary.
-- Publishing the sequence last keeps each retained slot atomic to the
-- suspended scenario consumer.
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
	blua32.trace_sink(self.machine, 'fsm.transition', nil)
end

return transition_recorder
