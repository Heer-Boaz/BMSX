local clock<const> = require('cartlib/clock')

local trigger_recorder<const> = {}
trigger_recorder.__index = trigger_recorder

-- Scenario instrumentation retains owner identity once and preallocates every
-- record slot. Outcome values are the producer's interned literals; the
-- recorder does not encode and later decode them through a parallel label ABI.
function trigger_recorder.new(component, capacity)
	local records<const> = {}
	for i = 1, capacity do
		records[i] = { 0, 0, '', '' }
	end
	local owner<const> = component.parent
	local self<const> = setmetatable({
		owner.id,
		owner.definition_id,
		capacity,
		0,
		records,
	}, trigger_recorder)
	self.component = component
	blua32.trace_sink(component, 'actioneffect.trigger', self)
	return self
end

-- Publishing the sequence last keeps each retained slot atomic to the
-- suspended Scenario consumer.
function trigger_recorder:record(effect_id, outcome)
	local sequence<const> = self[4] + 1
	local record<const> = self[5][((sequence - 1) % self[3]) + 1]
	record[1] = sequence
	record[2] = clock.milliseconds()
	record[3] = effect_id
	record[4] = outcome
	self[4] = sequence
end

function trigger_recorder:dispose()
	blua32.trace_sink(self.component, 'actioneffect.trigger', nil)
end

return trigger_recorder
