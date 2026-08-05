local component_types<const> = require('cartlib/components/types')
local eventemitter<const> = require('cartlib/eventemitter')

local empty_options<const> = {}

local component<const> = {}
component.__index = component

function component.new(opts, type_name, unique)
	opts = opts or empty_options
	local self<const> = setmetatable({}, component)
	self.parent = opts.parent
	self.type_name = type_name or opts.type_name or component_types.base
	self.id_local = opts.id_local
	self.id = opts.id
	self.enabled = opts.enabled == nil or opts.enabled
	self.unique = unique or opts.unique or false
	self._attached = false
	return self
end

function component:set_enabled(enabled)
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

function component.generate_id(comp)
	local generated_id = comp.parent.id .. '_' .. comp.type_name
	if comp.id_local then
		generated_id = generated_id .. '_' .. comp.id_local
	end
	return generated_id
end

function component:on_attach()
end

function component:on_detach()
end

function component:on_activate()
end

function component:bind()
end

function component:unbind()
	eventemitter:remove_subscriber(self)
end

return component
