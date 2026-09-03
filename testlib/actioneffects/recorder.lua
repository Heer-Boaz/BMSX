local clock<const> = require('cartlib/clock')

local recorder<const> = {}
recorder.__index = recorder

-- Scenario instrumentation retains owner identity once and preallocates every
-- record slot. Kinds and outcomes remain the producer's interned literals;
-- activity values remain the producer's raw aggregate retain count.
function recorder.new(component, capacity)
	local records<const> = {}
	for i = 1, capacity do
		records[i] = { 0, 0, '', '', 0 }
	end
	local owner<const> = component.parent
	local self<const> = setmetatable({
		owner.id,
		owner.definition_id,
		capacity,
		0,
		records,
	}, recorder)
	self.component = component
	blua32.trace_sink(component, 'actioneffect.fact', self)
	return self
end

-- Publishing the sequence last keeps each retained slot atomic to the
-- suspended Scenario consumer.
function recorder:record(kind, effect_id, value)
	local sequence<const> = self[4] + 1
	local record<const> = self[5][((sequence - 1) % self[3]) + 1]
	record[1] = sequence
	record[2] = clock.milliseconds()
	record[3] = kind
	record[4] = effect_id
	record[5] = value
	self[4] = sequence
end

function recorder:dispose()
	blua32.trace_sink(self.component, 'actioneffect.fact', nil)
end

return recorder
