local event_emitter<const> = require('cartlib/event_emitter')

local base_component<const> = {}
base_component.__index = base_component
base_component._tick_clocks = 0

function base_component.new(opts)
	local self<const> = setmetatable({}, base_component)
	self.parent = opts.parent
	self.id_local = opts.id_local
	self.enabled = opts.enabled == nil or opts.enabled
	self._attached = false
	return self
end

function base_component:set_enabled(enabled)
	if self.enabled == enabled then
		return self
	end
	self.enabled = enabled
	local parent<const> = self.parent
	if self._attached and parent._world_object_index ~= nil and parent.active then
		parent.world:reconcile_component(self)
	end
	return self
end

-- A component may publish independently scheduled work on more than one
-- clock. Admission changes reconcile retained clock lanes at the world's
-- structural barrier; frame loops consume their dense lane directly.
function base_component:set_tick_clock_enabled(clock_source, enabled)
	local clocks<const> = self._tick_clocks
	local updated
	if enabled then
		updated = clocks | clock_source
	else
		updated = clocks & ~clock_source
	end
	if clocks == updated then
		return self
	end
	self._tick_clocks = updated
	local parent<const> = self.parent
	if self._attached and parent._world_object_index ~= nil and parent.active then
		parent.world:reconcile_component(self)
	end
	return self
end

function base_component:on_attach()
end

function base_component:on_detach()
end

function base_component:on_activate()
end

-- Authoring consumers ask every component through one guest-side contract.
-- Components without authored or derived geometry publish no edit rectangle.
function base_component:edit_bounds()
	return nil
end

function base_component:unbind()
	event_emitter:remove_subscriber(self)
end

return base_component
