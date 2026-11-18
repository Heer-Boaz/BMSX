local world_object<const> = require('cartlib/world/world_object')
local model<const> = require('model')

local actor<const> = {}
setmetatable(actor, { __index = world_object })

function actor:ctor()
	self.state = model.new(self.index, self.generation)
end

function actor:bind()
	self.events:on({ event = 'bench.pulse', emitter = 'bench.clock', handler = self.on_pulse })
end

function actor:on_pulse(_event, _emitter, payload)
	model.pulse(self.state, payload.pulse)
	self.counters.events = self.counters.events + 1
end

function actor:step(step)
	local checksum<const> = model.step(self.state, step)
	local charged<const> = self.state.stats.energy >= 128
	if charged ~= self.charged then
		self.charged = charged
		if charged then self:add_tag('charged') else self:remove_tag('charged') end
	end
	return checksum
end

return actor
