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

-- TransformComponent: simple positional proxy
local TransformComponent = {}
TransformComponent.__index = TransformComponent
setmetatable(TransformComponent, { __index = Component })

function TransformComponent.new(opts)
	opts = opts or {}
	opts.type_name = "TransformComponent"
	opts.unique = true
	local self = setmetatable(Component.new(opts), TransformComponent)
	local p = self.parent
	self.position = opts.position or { x = p.x or 0, y = p.y or 0, z = p.z or 0 }
	self.scale = opts.scale or { x = 1, y = 1, z = 1 }
	self.orientation = opts.orientation
	return self
end

function TransformComponent:post_update()
	local p = self.parent
	self.position.x = p.x
	self.position.y = p.y
	self.position.z = p.z
end

-- TextComponent: lightweight render descriptor
local TextComponent = {}
TextComponent.__index = TextComponent
setmetatable(TextComponent, { __index = Component })

function TextComponent.new(opts)
	opts = opts or {}
	opts.type_name = "TextComponent"
	local self = setmetatable(Component.new(opts), TextComponent)
	self.text = opts.text or ""
	self.font = opts.font
	self.color = opts.color or { r = 1, g = 1, b = 1, a = 1 }
	self.background_color = opts.background_color
	self.offset = opts.offset or { x = 0, y = 0, z = 0 }
	self.layer = opts.layer or "world"
	return self
end

-- MeshComponent: minimal render descriptor
local MeshComponent = {}
MeshComponent.__index = MeshComponent
setmetatable(MeshComponent, { __index = Component })

function MeshComponent.new(opts)
	opts = opts or {}
	opts.type_name = "MeshComponent"
	local self = setmetatable(Component.new(opts), MeshComponent)
	self.mesh = opts.mesh
	self.matrix = opts.matrix
	self.joint_matrices = opts.joint_matrices
	self.morph_weights = opts.morph_weights
	self.receive_shadow = opts.receive_shadow
	self.layer = opts.layer or "world"
	return self
end

function MeshComponent:update_animation(_dt)
end

-- CustomVisualComponent: scripted render producer
local CustomVisualComponent = {}
CustomVisualComponent.__index = CustomVisualComponent
setmetatable(CustomVisualComponent, { __index = Component })

function CustomVisualComponent.new(opts)
	opts = opts or {}
	opts.type_name = "CustomVisualComponent"
	local self = setmetatable(Component.new(opts), CustomVisualComponent)
	self.producer = opts.producer
	return self
end

function CustomVisualComponent:add_producer(fn)
	if not fn then
		self.producer = nil
		return
	end
	local prev = self.producer
	if prev then
		self.producer = function(ctx)
			prev(ctx)
			fn(ctx)
		end
	else
		self.producer = fn
	end
end

function CustomVisualComponent:flush()
	if not self.producer then
		error("CustomVisualComponent: no producer for '" .. self.parent.id .. "'")
	end
	self.producer({ parent = self.parent, rc = self })
end

function CustomVisualComponent:submit_sprite(desc)
	local pos = desc.pos or desc.position
	local flip = desc.flip or {}
	put_sprite(desc.imgid, pos.x, pos.y, pos.z, {
		scale = desc.scale,
		flip_h = flip.flip_h,
		flip_v = flip.flip_v,
		colorize = desc.colorize,
	})
end

function CustomVisualComponent:submit_rect(desc)
	local area = desc.area
	local color = desc.color
	if desc.kind == "stroke" then
		if type(color) == "table" then
			error("CustomVisualComponent: stroke rectangle requires palette color index")
		end
		put_rect(area.left, area.top, area.right, area.bottom, area.z, color)
	else
		if type(color) == "table" then
			put_rectfillcolor(area.left, area.top, area.right, area.bottom, area.z, color)
		else
			put_rectfill(area.left, area.top, area.right, area.bottom, area.z, color)
		end
	end
end

function CustomVisualComponent:submit_poly(desc)
	local thickness = desc.thickness
	put_poly(desc.points, desc.z, desc.color, thickness)
end

function CustomVisualComponent:submit_mesh(desc)
	put_mesh(desc.mesh, desc.matrix, {
		joint_matrices = desc.joint_matrices,
		morph_weights = desc.morph_weights,
		receive_shadow = desc.receive_shadow,
	})
end

function CustomVisualComponent:submit_particle(desc)
	put_particle(desc.position, desc.size, desc.color, {
		texture = desc.texture,
		ambient_mode = desc.ambient_mode,
		ambient_factor = desc.ambient_factor,
	})
end

function CustomVisualComponent:submit_glyphs(desc)
	if desc.font and type(desc.color) == "number" then
		write_with_font(desc.glyphs, desc.x, desc.y, desc.z, desc.color, desc.font)
	elseif type(desc.color) == "table" then
		write_color(desc.glyphs, desc.x, desc.y, desc.z, desc.color)
	else
		write(desc.glyphs, desc.x, desc.y, desc.z, desc.color)
	end
end

-- InputIntentComponent: declarative input -> state bindings
local InputIntentComponent = {}
InputIntentComponent.__index = InputIntentComponent
setmetatable(InputIntentComponent, { __index = Component })

function InputIntentComponent.new(opts)
	opts = opts or {}
	opts.type_name = "InputIntentComponent"
	opts.unique = true
	local self = setmetatable(Component.new(opts), InputIntentComponent)
	self.player_index = opts.player_index or 1
	self.bindings = opts.bindings or {}
	return self
end

-- InputActionEffectComponent: links an input-action program to an object
local InputActionEffectComponent = {}
InputActionEffectComponent.__index = InputActionEffectComponent
setmetatable(InputActionEffectComponent, { __index = Component })

function InputActionEffectComponent.new(opts)
	opts = opts or {}
	opts.type_name = "InputActionEffectComponent"
	opts.unique = true
	local self = setmetatable(Component.new(opts), InputActionEffectComponent)
	self.program_id = opts.program_id
	self.program = opts.program
	return self
end

-- PositionUpdateAxisComponent: tracks old position for physics/boundary systems
local PositionUpdateAxisComponent = {}
PositionUpdateAxisComponent.__index = PositionUpdateAxisComponent
setmetatable(PositionUpdateAxisComponent, { __index = Component })

function PositionUpdateAxisComponent.new(opts)
	opts = opts or {}
	opts.type_name = "PositionUpdateAxisComponent"
	local self = setmetatable(Component.new(opts), PositionUpdateAxisComponent)
	self.old_pos = { x = 0, y = 0 }
	return self
end

function PositionUpdateAxisComponent:preprocess_update()
	local p = self.parent
	self.old_pos.x = p.x
	self.old_pos.y = p.y
end

local ScreenBoundaryComponent = {}
ScreenBoundaryComponent.__index = ScreenBoundaryComponent
setmetatable(ScreenBoundaryComponent, { __index = PositionUpdateAxisComponent })

function ScreenBoundaryComponent.new(opts)
	opts = opts or {}
	opts.type_name = "ScreenBoundaryComponent"
	opts.unique = true
	local self = setmetatable(PositionUpdateAxisComponent.new(opts), ScreenBoundaryComponent)
	self.stick_to_edge = opts.stick_to_edge ~= false
	return self
end

local TileCollisionComponent = {}
TileCollisionComponent.__index = TileCollisionComponent
setmetatable(TileCollisionComponent, { __index = PositionUpdateAxisComponent })

function TileCollisionComponent.new(opts)
	opts = opts or {}
	opts.type_name = "TileCollisionComponent"
	opts.unique = true
	local self = setmetatable(PositionUpdateAxisComponent.new(opts), TileCollisionComponent)
	return self
end

local ProhibitLeavingScreenComponent = {}
ProhibitLeavingScreenComponent.__index = ProhibitLeavingScreenComponent
setmetatable(ProhibitLeavingScreenComponent, { __index = ScreenBoundaryComponent })

function ProhibitLeavingScreenComponent.new(opts)
	opts = opts or {}
	opts.type_name = "ProhibitLeavingScreenComponent"
	opts.unique = true
	local self = setmetatable(ScreenBoundaryComponent.new(opts), ProhibitLeavingScreenComponent)
	return self
end

function ProhibitLeavingScreenComponent:bind()
	self.parent.events:on({ event_name = "screen.leaving", handler = function(event)
		local p = self.parent
		local w = $.viewportsize.x
		local h = $.viewportsize.y
		if event.d == "left" then
			p.x = self.stick_to_edge and 0 or event.old_x_or_y
		elseif event.d == "right" then
			p.x = self.stick_to_edge and (w - p.sx) or event.old_x_or_y
		elseif event.d == "up" then
			p.y = self.stick_to_edge and 0 or event.old_x_or_y
		elseif event.d == "down" then
			p.y = self.stick_to_edge and (h - p.sy) or event.old_x_or_y
		end
	end, subscriber = self })
end

local ComponentRegistry = {
	Component = Component,
	SpriteComponent = SpriteComponent,
	Collider2DComponent = Collider2DComponent,
	TimelineComponent = TimelineComponent,
	TransformComponent = TransformComponent,
	TextComponent = TextComponent,
	MeshComponent = MeshComponent,
	CustomVisualComponent = CustomVisualComponent,
	InputIntentComponent = InputIntentComponent,
	InputActionEffectComponent = InputActionEffectComponent,
	PositionUpdateAxisComponent = PositionUpdateAxisComponent,
	ScreenBoundaryComponent = ScreenBoundaryComponent,
	TileCollisionComponent = TileCollisionComponent,
	ProhibitLeavingScreenComponent = ProhibitLeavingScreenComponent,
}

local function register_component(type_name, ctor)
	ComponentRegistry[type_name] = ctor
end

local function new_component(type_name, opts)
	local ctor = ComponentRegistry[type_name]
	if not ctor then
		error("Component '" .. type_name .. "' is not registered.")
	end
	return ctor.new(opts)
end

return {
	Component = Component,
	SpriteComponent = SpriteComponent,
	Collider2DComponent = Collider2DComponent,
	TimelineComponent = TimelineComponent,
	TransformComponent = TransformComponent,
	TextComponent = TextComponent,
	MeshComponent = MeshComponent,
	CustomVisualComponent = CustomVisualComponent,
	InputIntentComponent = InputIntentComponent,
	InputActionEffectComponent = InputActionEffectComponent,
	PositionUpdateAxisComponent = PositionUpdateAxisComponent,
	ScreenBoundaryComponent = ScreenBoundaryComponent,
	TileCollisionComponent = TileCollisionComponent,
	ProhibitLeavingScreenComponent = ProhibitLeavingScreenComponent,
	ComponentRegistry = ComponentRegistry,
	register_component = register_component,
	new_component = new_component,
}
