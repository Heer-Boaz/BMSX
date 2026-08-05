local eventemitter<const> = require('cartlib/eventemitter')

local empty_options<const> = {}

local basecomponent<const> = {}
basecomponent.__index = basecomponent

function basecomponent.new(opts)
	opts = opts or empty_options
	local self<const> = setmetatable({}, basecomponent)
	self.parent = opts.parent
	self.id_local = opts.id_local
	self.id = opts.id
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
	if self._published and parent.active then
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

function basecomponent:bind()
end

function basecomponent:unbind()
	eventemitter:remove_subscriber(self)
end

return basecomponent
