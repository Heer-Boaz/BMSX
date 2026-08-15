local event_emitter<const> = require('cartlib/event_emitter')

local base_component<const> = {}
base_component.__index = base_component

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

-- Tick enablement is independent from component enablement. Event-driven
-- components remain active and subscribed while their frame work is absent;
-- systems consume the world's retained tick view instead of polling those
-- dormant components every frame.
function base_component:set_tick_enabled(enabled)
	if self._tick_enabled == enabled then
		return self
	end
	self._tick_enabled = enabled
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

function base_component:unbind()
	event_emitter:remove_subscriber(self)
end

return base_component
