local event_emitter<const> = require('cartlib/event_emitter')

local base_component<const> = {}
base_component.__index = base_component
base_component._tick_clocks = 0

local empty_configuration<const> = {}

function base_component.new(owner, configuration)
	if configuration == nil then configuration = empty_configuration end
	local self<const> = setmetatable({}, base_component)
	self.owner = owner
	self.id_local = configuration.id_local
	self.enabled = configuration.enabled == nil or configuration.enabled
	self._attached = false
	self._bound = false
	return self, configuration
end

function base_component:set_enabled(enabled)
	if self.enabled == enabled then
		return self
	end
	self.enabled = enabled
	local owner<const> = self.owner
	if self._attached and owner._world_object_index ~= nil and owner.active then
		owner.world:reconcile_component(self)
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
	local owner<const> = self.owner
	if self._attached and owner._world_object_index ~= nil and owner.active then
		owner.world:reconcile_component(self)
	end
	return self
end

function base_component:on_attach()
end

function base_component:on_detach()
end

-- Binding is a lifetime transition, distinct from entering active gameplay.
-- World calls it after construction/publication and before any batch activation.
function base_component:_bind()
	if not self._bound then
		self._bound = true
		self:on_bind()
	end
end

function base_component:on_bind()
end

function base_component:on_activate()
end

function base_component:unbind()
	event_emitter:remove_subscriber(self)
end

return base_component
