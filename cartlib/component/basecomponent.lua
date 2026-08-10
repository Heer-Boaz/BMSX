local eventemitter<const> = require('cartlib/eventemitter')

local basecomponent<const> = {}
basecomponent.__index = basecomponent

function basecomponent.new(opts)
	local self<const> = setmetatable({}, basecomponent)
	self.parent = opts.parent
	self.id_local = opts.id_local
	self.enabled = opts.enabled == nil or opts.enabled
	self._attached = false
	return self
end

function basecomponent:set_enabled(enabled)
	if self.enabled == enabled then
		return self
	end
	self.enabled = enabled
	local parent<const> = self.parent
	if self._attached and not self._attach_pending and parent._worldobject_index ~= nil and parent.active then
		parent.world:reconcile_component(self)
	end
	return self
end

function basecomponent:on_attach()
end

function basecomponent:on_detach()
end

function basecomponent:on_activate()
end

function basecomponent:unbind()
	eventemitter:remove_subscriber(self)
end

return basecomponent
