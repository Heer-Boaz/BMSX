-- components.lua
-- Base component primitives for system ROM

local eventemitter = require("eventemitter")
local EventEmitter = eventemitter.EventEmitter

local Component = {}
Component.__index = Component

function Component.new(opts)
	local self = setmetatable({}, Component)
	opts = opts or {}
	self.parent = opts.parent
	self.type_name = opts.type_name or "Component"
	self.id_local = opts.id_local
	self.id = opts.id or (self.parent.id .. "_" .. self.type_name .. (self.id_local and ("_" .. self.id_local) or ""))
	self.enabled = opts.enabled ~= false
	self.tags = opts.tags or {}
	self.unique = opts.unique or false
	return self
end

function Component:attach(new_parent)
	if new_parent then
		self.parent = new_parent
	end
	if self.unique and self.parent:has_component(self.type_name) then
		error("Component '" .. self.type_name .. "' is unique and already attached to '" .. self.parent.id .. "'")
	end
	self.parent:add_component(self)
	self:bind()
	self:on_attach()
	return self
end

function Component:detach()
	self.parent:remove_component_instance(self)
end

function Component:on_attach()
end

function Component:on_detach()
end

function Component:bind()
end

function Component:unbind()
	EventEmitter.instance:remove_subscriber(self)
end

function Component:dispose()
	self:detach()
	self.enabled = false
end

function Component:has_tag(tag)
	return self.tags[tag] == true
end

function Component:add_tag(tag)
	self.tags[tag] = true
end

function Component:remove_tag(tag)
	self.tags[tag] = nil
end

function Component:toggle_tag(tag)
	self.tags[tag] = not self.tags[tag]
end

function Component:tick(_dt)
end

function Component:draw()
end

-- SpriteComponent: holds sprite metadata
local SpriteComponent = {}
SpriteComponent.__index = SpriteComponent
setmetatable(SpriteComponent, { __index = Component })

function SpriteComponent.new(opts)
	opts = opts or {}
	opts.type_name = "SpriteComponent"
	local self = setmetatable(Component.new(opts), SpriteComponent)
	self.imgid = opts and opts.imgid or "none"
	self.flip = { flip_h = false, flip_v = false }
	self.colorize = opts and opts.colorize or { r = 255, g = 255, b = 255, a = 1 }
	return self
end

-- Collider2DComponent: holds hit areas / polys
local Collider2DComponent = {}
Collider2DComponent.__index = Collider2DComponent
setmetatable(Collider2DComponent, { __index = Component })

function Collider2DComponent.new(opts)
	opts = opts or {}
	opts.type_name = "Collider2DComponent"
	local self = setmetatable(Component.new(opts), Collider2DComponent)
	self.local_area = nil
	self.local_poly = nil
	return self
end

function Collider2DComponent:set_local_area(area)
	self.local_area = area
end

function Collider2DComponent:set_local_poly(poly)
	self.local_poly = poly
end

-- TimelineComponent: lightweight placeholder
local TimelineComponent = {}
TimelineComponent.__index = TimelineComponent
setmetatable(TimelineComponent, { __index = Component })

function TimelineComponent.new(opts)
	opts = opts or {}
	opts.type_name = "TimelineComponent"
	local self = setmetatable(Component.new(opts), TimelineComponent)
	self.timelines = {}
	return self
end

function TimelineComponent:define(id, def)
	if def == nil then
		local key = id.id or id.name or id
		self.timelines[key] = id
		return
	end
	self.timelines[id] = def
end

function TimelineComponent:get(id)
	return self.timelines[id]
end

function TimelineComponent:play(id, opts)
	local t = self.timelines[id]
	if t and t.play then
		t.play(opts)
	end
end

function TimelineComponent:stop(id)
	local t = self.timelines[id]
	if t and t.stop then
		t.stop()
	end
end

return {
	Component = Component,
	SpriteComponent = SpriteComponent,
	Collider2DComponent = Collider2DComponent,
	TimelineComponent = TimelineComponent,
}
