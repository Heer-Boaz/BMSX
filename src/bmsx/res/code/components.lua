-- components.lua
-- Base component primitives for system ROM

local eventemitter = require("eventemitter")
local timeline = require("timeline")
local EventEmitter = eventemitter.EventEmitter
local Timeline = timeline.Timeline

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
	self.colorize = opts and opts.colorize or { r = 1, g = 1, b = 1, a = 1 }
	self.scale = opts and opts.scale or { x = 1, y = 1 }
	self.offset = opts and opts.offset or { x = 0, y = 0, z = 0 }
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
	opts.unique = true
	local self = setmetatable(Component.new(opts), TimelineComponent)
	self.registry = {}
	self.active = {}
	self.listeners = {}
	return self
end

function TimelineComponent:define(definition)
	local instance = definition.__is_timeline and definition or Timeline.new(definition)
	self.registry[instance.id] = { instance = instance }
end

function TimelineComponent:get(id)
	local entry = self.registry[id]
	return entry and entry.instance or nil
end

function TimelineComponent:play(id, opts)
	local entry = self.registry[id]
	if not entry then
		error("[TimelineComponent] Unknown timeline '" .. id .. "' on '" .. self.parent.id .. "'")
	end
	local instance = entry.instance
	local rewind = true
	local snap = true
	if opts ~= nil then
		if opts.rewind ~= nil then
			rewind = opts.rewind
		end
		if opts.snap_to_start ~= nil then
			snap = opts.snap_to_start
		end
	end
	if rewind then
		instance:rewind()
	end
	if snap and instance.length > 0 then
		self:process_events(entry, instance:snap_to_start())
	end
	self.active[id] = true
	return instance
end

function TimelineComponent:stop(id)
	self.active[id] = nil
end

function TimelineComponent:tick_active(dt)
	for id in pairs(self.active) do
		local entry = self.registry[id]
		local events = entry.instance:tick(dt)
		if #events > 0 then
			self:process_events(entry, events)
		end
	end
end

function TimelineComponent:process_events(entry, events)
	local owner = self.parent
	for i = 1, #events do
		local evt = events[i]
		if evt.kind == "frame" then
			local payload = {
				timeline_id = entry.instance.id,
				frame_index = evt.current,
				frame_value = evt.value,
				rewound = evt.rewound,
				reason = evt.reason,
				direction = evt.direction,
			}
			self:emit_frameevent(owner, payload)
		else
			local payload = {
				timeline_id = entry.instance.id,
				mode = evt.mode,
				wrapped = evt.wrapped,
			}
			self:emit_endevent(owner, payload)
			if evt.mode == "once" then
				self.active[entry.instance.id] = nil
			end
		end
	end
end

function TimelineComponent:emit_frameevent(owner, payload)
	self:dispatch_timeline_events(owner, "timeline.frame", payload)
end

function TimelineComponent:emit_endevent(owner, payload)
	self:dispatch_timeline_events(owner, "timeline.end", payload)
end

function TimelineComponent:dispatch_timeline_events(owner, base_type, payload)
	local base_event = eventemitter.create_gameevent({ type = base_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
	owner.events:emit_event(base_event)
	owner.sc:dispatch_event(base_event)
	local scoped_type = base_type .. "." .. payload.timeline_id
	local scoped_event = eventemitter.create_gameevent({ type = scoped_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
	owner.events:emit_event(scoped_event)
	owner.sc:dispatch_event(scoped_event)
end

return {
	Component = Component,
	SpriteComponent = SpriteComponent,
	Collider2DComponent = Collider2DComponent,
	TimelineComponent = TimelineComponent,
}
