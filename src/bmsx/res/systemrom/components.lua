-- components.lua
-- base component primitives for system rom

local eventemitter = require("eventemitter")
local timeline_module = require("timeline")
local eventemitter = eventemitter.eventemitter
local timeline = timeline_module.timeline

local component = {}
component.__index = component

function component.new(opts)
	local self = setmetatable({}, component)
	opts = opts or {}
	self.parent = opts.parent
	self.type_name = opts.type_name or "component"
	self.id_local = opts.id_local
	self.id = opts.id or (self.parent.id .. "_" .. self.type_name .. (self.id_local and ("_" .. self.id_local) or ""))
	self.enabled = opts.enabled ~= false
	self.tags = opts.tags or {}
	self.unique = opts.unique or false
	return self
end

function component:attach(new_parent)
	if new_parent then
		self.parent = new_parent
	end
	if self.unique and self.parent:has_component(self.type_name) then
		error("component '" .. self.type_name .. "' is unique and already attached to '" .. self.parent.id .. "'")
	end
	self.parent:add_component(self)
	self:bind()
	self:on_attach()
	return self
end

function component:detach()
	self.parent:remove_component_instance(self)
end

function component:on_attach()
end

function component:on_detach()
end

function component:bind()
end

function component:unbind()
	eventemitter.instance:remove_subscriber(self)
end

function component:dispose()
	self:detach()
	self.enabled = false
end

function component:has_tag(tag)
	return self.tags[tag] == true
end

function component:add_tag(tag)
	self.tags[tag] = true
end

function component:remove_tag(tag)
	self.tags[tag] = nil
end

function component:toggle_tag(tag)
	self.tags[tag] = not self.tags[tag]
end

function component:tick(_dt)
end

function component:draw()
end

-- spritecomponent: holds sprite metadata
local spritecomponent = {}
spritecomponent.__index = spritecomponent
setmetatable(spritecomponent, { __index = component })

function spritecomponent.new(opts)
	opts = opts or {}
	opts.type_name = "spritecomponent"
	local self = setmetatable(component.new(opts), spritecomponent)
	self.imgid = opts and opts.imgid or "none"
	self.flip = { flip_h = false, flip_v = false }
	self.colorize = opts and opts.colorize or { r = 1, g = 1, b = 1, a = 1 }
	self.scale = opts and opts.scale or { x = 1, y = 1 }
	self.offset = opts and opts.offset or { x = 0, y = 0, z = 0 }
	return self
end

-- collider2dcomponent: holds hit areas / polys
local collider2dcomponent = {}
collider2dcomponent.__index = collider2dcomponent
setmetatable(collider2dcomponent, { __index = component })

function collider2dcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "collider2dcomponent"
	local self = setmetatable(component.new(opts), collider2dcomponent)
	self.local_area = nil
	self.local_poly = nil
	return self
end

function collider2dcomponent:set_local_area(area)
	self.local_area = area
end

function collider2dcomponent:set_local_poly(poly)
	self.local_poly = poly
end

-- timelinecomponent: lightweight placeholder
local timelinecomponent = {}
timelinecomponent.__index = timelinecomponent
setmetatable(timelinecomponent, { __index = component })

function timelinecomponent.new(opts)
	opts = opts or {}
	opts.type_name = "timelinecomponent"
	opts.unique = true
	local self = setmetatable(component.new(opts), timelinecomponent)
	self.registry = {}
	self.active = {}
	self.listeners = {}
	return self
end

function timelinecomponent:define(definition)
	local instance = definition.__is_timeline and definition or timeline.new(definition)
	local markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
	self.registry[instance.id] = { instance = instance, markers = markers }
end

function timelinecomponent:get(id)
	local entry = self.registry[id]
	return entry and entry.instance or nil
end

function timelinecomponent:play(id, opts)
	local entry = self.registry[id]
	if not entry then
		error("[timelinecomponent] unknown timeline '" .. id .. "' on '" .. self.parent.id .. "'")
	end
	local instance = entry.instance
	local rewind = true
	local snap = true
	local params = nil
	if opts ~= nil then
		if opts.rewind ~= nil then
			rewind = opts.rewind
		end
		if opts.snap_to_start ~= nil then
			snap = opts.snap_to_start
		end
		if opts.params ~= nil then
			params = opts.params
		end
	end
	if instance.frame_builder then
		if params == nil then
			params = instance.def.params
		end
		instance:build(params)
		entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
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

function timelinecomponent:stop(id)
	self.active[id] = nil
end

function timelinecomponent:tick_active(dt)
	for id in pairs(self.active) do
		local entry = self.registry[id]
		local events = entry.instance:tick(dt)
		if #events > 0 then
			self:process_events(entry, events)
		end
	end
end

function timelinecomponent:process_events(entry, events)
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
			self:apply_markers(entry, evt)
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

function timelinecomponent:apply_markers(entry, event)
	local compiled = entry.markers
	local bucket = compiled.by_frame[event.current]
	if not bucket then
		return
	end
	local owner = self.parent
	for i = 1, #bucket do
		local marker = bucket[i]
		local payload = marker.payload
		if type(payload) == "table" then
			local copy = {}
			for k, v in pairs(payload) do
				copy[k] = v
			end
			payload = copy
		end
		local spec = { type = marker.event, emitter = owner }
		if payload ~= nil then
			if type(payload) == "table" and payload.type == nil then
				for k, v in pairs(payload) do
					spec[k] = v
				end
			else
				spec.payload = payload
			end
		end
		local event = eventemitter:create_gameevent(spec)
		owner.events:emit_event(event)
		owner.sc:dispatch_event(event)
	end
end

function timelinecomponent:emit_frameevent(owner, payload)
	self:dispatch_timeline_events(owner, "timeline.frame", payload)
end

function timelinecomponent:emit_endevent(owner, payload)
	self:dispatch_timeline_events(owner, "timeline.end", payload)
end

	function timelinecomponent:dispatch_timeline_events(owner, base_type, payload)
		local base_event = eventemitter:create_gameevent({ type = base_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
		owner.events:emit_event(base_event)
		owner.sc:dispatch_event(base_event)
		local scoped_type = base_type .. "." .. payload.timeline_id
		local scoped_event = eventemitter:create_gameevent({ type = scoped_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
		owner.events:emit_event(scoped_event)
		owner.sc:dispatch_event(scoped_event)
	end

-- transformcomponent: simple positional proxy
local transformcomponent = {}
transformcomponent.__index = transformcomponent
setmetatable(transformcomponent, { __index = component })

function transformcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "transformcomponent"
	opts.unique = true
	local self = setmetatable(component.new(opts), transformcomponent)
	local p = self.parent
	self.position = opts.position or { x = p.x or 0, y = p.y or 0, z = p.z or 0 }
	self.scale = opts.scale or { x = 1, y = 1, z = 1 }
	self.orientation = opts.orientation
	return self
end

function transformcomponent:post_update()
	local p = self.parent
	self.position.x = p.x
	self.position.y = p.y
	self.position.z = p.z
end

-- textcomponent: lightweight render descriptor
local textcomponent = {}
textcomponent.__index = textcomponent
setmetatable(textcomponent, { __index = component })

function textcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "textcomponent"
	local self = setmetatable(component.new(opts), textcomponent)
	self.text = opts.text or ""
	self.font = opts.font
	self.color = opts.color or { r = 1, g = 1, b = 1, a = 1 }
	self.background_color = opts.background_color
	self.wrap_chars = opts.wrap_chars
	self.center_block_width = opts.center_block_width
	self.align = opts.align
	self.baseline = opts.baseline
	self.offset = opts.offset or { x = 0, y = 0, z = 0 }
	self.layer = opts.layer or "world"
	return self
end

-- meshcomponent: minimal render descriptor
local meshcomponent = {}
meshcomponent.__index = meshcomponent
setmetatable(meshcomponent, { __index = component })

function meshcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "meshcomponent"
	local self = setmetatable(component.new(opts), meshcomponent)
	self.mesh = opts.mesh
	self.matrix = opts.matrix
	self.joint_matrices = opts.joint_matrices
	self.morph_weights = opts.morph_weights
	self.receive_shadow = opts.receive_shadow
	self.layer = opts.layer or "world"
	return self
end

function meshcomponent:update_animation(_dt)
end

-- customvisualcomponent: scripted render producer
local customvisualcomponent = {}
customvisualcomponent.__index = customvisualcomponent
setmetatable(customvisualcomponent, { __index = component })

function customvisualcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "customvisualcomponent"
	local self = setmetatable(component.new(opts), customvisualcomponent)
	self.producer = opts.producer
	return self
end

function customvisualcomponent:add_producer(fn)
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

function customvisualcomponent:flush()
	if not self.producer then
		error("customvisualcomponent: no producer for '" .. self.parent.id .. "'")
	end
	self.producer({ parent = self.parent, rc = self })
end

function customvisualcomponent:submit_sprite(desc)
	local pos = desc.pos or desc.position
	local flip = desc.flip or {}
	put_sprite(desc.imgid, pos.x, pos.y, pos.z, {
		scale = desc.scale,
		flip_h = flip.flip_h,
		flip_v = flip.flip_v,
		colorize = desc.colorize,
	})
end

function customvisualcomponent:submit_rect(desc)
	local area = desc.area
	local color = desc.color
	if desc.kind == "stroke" then
		if type(color) == "table" then
			error("customvisualcomponent: stroke rectangle requires palette color index")
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

function customvisualcomponent:submit_poly(desc)
	local thickness = desc.thickness
	put_poly(desc.points, desc.z, desc.color, thickness)
end

function customvisualcomponent:submit_mesh(desc)
	put_mesh(desc.mesh, desc.matrix, {
		joint_matrices = desc.joint_matrices,
		morph_weights = desc.morph_weights,
		receive_shadow = desc.receive_shadow,
	})
end

function customvisualcomponent:submit_particle(desc)
	put_particle(desc.position, desc.size, desc.color, {
		texture = desc.texture,
		ambient_mode = desc.ambient_mode,
		ambient_factor = desc.ambient_factor,
	})
end

function customvisualcomponent:submit_glyphs(desc)
	put_glyphs(desc.glyphs, desc.x, desc.y, desc.z, {
		font = desc.font,
		color = desc.color,
		background_color = desc.background_color,
		wrap_chars = desc.wrap_chars,
		center_block_width = desc.center_block_width,
		glyph_start = desc.glyph_start,
		glyph_end = desc.glyph_end,
		align = desc.align,
		baseline = desc.baseline,
		layer = desc.layer,
	})
end

-- inputintentcomponent: declarative input -> state bindings
local inputintentcomponent = {}
inputintentcomponent.__index = inputintentcomponent
setmetatable(inputintentcomponent, { __index = component })

function inputintentcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "inputintentcomponent"
	opts.unique = true
	local self = setmetatable(component.new(opts), inputintentcomponent)
	self.player_index = opts.player_index or 1
	self.bindings = opts.bindings or {}
	return self
end

-- inputactioneffectcomponent: links an input-action program to an object
local inputactioneffectcomponent = {}
inputactioneffectcomponent.__index = inputactioneffectcomponent
setmetatable(inputactioneffectcomponent, { __index = component })

function inputactioneffectcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "inputactioneffectcomponent"
	opts.unique = true
	local self = setmetatable(component.new(opts), inputactioneffectcomponent)
	self.program_id = opts.program_id
	self.program = opts.program
	return self
end

-- positionupdateaxiscomponent: tracks old position for physics/boundary systems
local positionupdateaxiscomponent = {}
positionupdateaxiscomponent.__index = positionupdateaxiscomponent
setmetatable(positionupdateaxiscomponent, { __index = component })

function positionupdateaxiscomponent.new(opts)
	opts = opts or {}
	opts.type_name = "positionupdateaxiscomponent"
	local self = setmetatable(component.new(opts), positionupdateaxiscomponent)
	self.old_pos = { x = 0, y = 0 }
	return self
end

function positionupdateaxiscomponent:preprocess_update()
	local p = self.parent
	self.old_pos.x = p.x
	self.old_pos.y = p.y
end

local screenboundarycomponent = {}
screenboundarycomponent.__index = screenboundarycomponent
setmetatable(screenboundarycomponent, { __index = positionupdateaxiscomponent })

function screenboundarycomponent.new(opts)
	opts = opts or {}
	opts.type_name = "screenboundarycomponent"
	opts.unique = true
	local self = setmetatable(positionupdateaxiscomponent.new(opts), screenboundarycomponent)
	self.stick_to_edge = opts.stick_to_edge ~= false
	return self
end

local tilecollisioncomponent = {}
tilecollisioncomponent.__index = tilecollisioncomponent
setmetatable(tilecollisioncomponent, { __index = positionupdateaxiscomponent })

function tilecollisioncomponent.new(opts)
	opts = opts or {}
	opts.type_name = "tilecollisioncomponent"
	opts.unique = true
	local self = setmetatable(positionupdateaxiscomponent.new(opts), tilecollisioncomponent)
	return self
end

local prohibitleavingscreencomponent = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
setmetatable(prohibitleavingscreencomponent, { __index = screenboundarycomponent })

function prohibitleavingscreencomponent.new(opts)
	opts = opts or {}
	opts.type_name = "prohibitleavingscreencomponent"
	opts.unique = true
	local self = setmetatable(screenboundarycomponent.new(opts), prohibitleavingscreencomponent)
	return self
end

function prohibitleavingscreencomponent:bind()
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

local componentregistry = {
	component = component,
	spritecomponent = spritecomponent,
	collider2dcomponent = collider2dcomponent,
	timelinecomponent = timelinecomponent,
	transformcomponent = transformcomponent,
	textcomponent = textcomponent,
	meshcomponent = meshcomponent,
	customvisualcomponent = customvisualcomponent,
	inputintentcomponent = inputintentcomponent,
	inputactioneffectcomponent = inputactioneffectcomponent,
	positionupdateaxiscomponent = positionupdateaxiscomponent,
	screenboundarycomponent = screenboundarycomponent,
	tilecollisioncomponent = tilecollisioncomponent,
	prohibitleavingscreencomponent = prohibitleavingscreencomponent,
}

local function register_component(type_name, ctor)
	componentregistry[type_name] = ctor
end

local function new_component(type_name, opts)
	local ctor = componentregistry[type_name]
	if not ctor then
		error("component '" .. type_name .. "' is not registered.")
	end
	return ctor.new(opts)
end

return {
	component = component,
	spritecomponent = spritecomponent,
	collider2dcomponent = collider2dcomponent,
	timelinecomponent = timelinecomponent,
	transformcomponent = transformcomponent,
	textcomponent = textcomponent,
	meshcomponent = meshcomponent,
	customvisualcomponent = customvisualcomponent,
	inputintentcomponent = inputintentcomponent,
	inputactioneffectcomponent = inputactioneffectcomponent,
	positionupdateaxiscomponent = positionupdateaxiscomponent,
	screenboundarycomponent = screenboundarycomponent,
	tilecollisioncomponent = tilecollisioncomponent,
	prohibitleavingscreencomponent = prohibitleavingscreencomponent,
	componentregistry = componentregistry,
	register_component = register_component,
	new_component = new_component,
}
