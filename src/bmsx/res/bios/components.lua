-- components.lua
-- base component primitives for system rom

local eventemitter = require('eventemitter')
local timeline_module = require('timeline')
local romdir = require('romdir')
local collision_profiles = require('collision_profiles')
local eventemitter = eventemitter.eventemitter
local timeline = timeline_module.timeline

local function apply_frame(target, frame)
	for k, v in pairs(frame) do
		if type(v) == 'table' then
			apply_frame(target[k], v)
		else
			target[k] = v
		end
	end
end

local function set_path(target, path, value)
	local node = target
	for i = 1, #path - 1 do
		node = node[path[i]]
	end
	node[path[#path]] = value
end

local function select_bounding_box(flip_h, flip_v, box)
	if box == nil then
		return nil
	end
	if flip_h and flip_v then
		return box.fliphv
	end
	if flip_h then
		return box.fliph
	end
	if flip_v then
		return box.flipv
	end
	return box.original
end

local function select_hit_polygons(flip_h, flip_v, polys)
	if polys == nil then
		return nil
	end
	if flip_h and flip_v then
		return polys.fliphv
	end
	if flip_h then
		return polys.fliph
	end
	if flip_v then
		return polys.flipv
	end
	return polys.original
end

local function eval_wave(track, time_seconds)
	local u = (time_seconds / track.period) + (track.phase or 0)
	local w
	if track.wave == 'pingpong' then
		w = easing.pingpong01(u)
	elseif track.wave == 'sin' then
		w = (math.sin(u * (math.pi * 2)) + 1) * 0.5
	else
		error('[timelinecomponent] unknown wave '' .. tostring(track.wave) .. ''.')
	end
	local ease = track.ease
	if ease ~= nil then
		w = ease(w)
	end
	return w
end

local function apply_track(target, track, params, event)
	if type(track) == 'function' then
		track(target, params, event)
		return
	end
	local kind = track.kind
	if kind == 'wave' then
		local base = track.base
		local base_value = type(base) == 'string' and params[base] or base
		local w = eval_wave(track, event.time_seconds)
		local value = base_value + ((w - 0.5) * 2 * track.amp)
		set_path(target, track.path, value)
		return
	end
	if kind == 'sprite_parallax_rig' then
		set_sprite_parallax_rig(
			params.vy,
			params.scale,
			params.impact,
			event.time_seconds,
			params.bias_px,
			params.parallax_strength,
			params.scale_strength,
			params.flip_strength,
			params.flip_window
		)
		return
	end
	error('[timelinecomponent] unknown track kind '' .. tostring(kind) .. ''.')
end

local function apply_tracks(target, tracks, params, event)
	for i = 1, #tracks do
		apply_track(target, tracks[i], params, event)
	end
end

local component = {}
component.__index = component

function component.new(opts)
	local self = setmetatable({}, component)
	opts = opts or {}
	self.parent = opts.parent
	self.type_name = opts.type_name or 'component'
	self.id_local = opts.id_local
	if opts.id then
		self.id = opts.id
	elseif self.parent then
		self.id = component.generate_id(self)
	end
	self.enabled = true
	if opts.enabled ~= nil then
		self.enabled = opts.enabled
	end
	self.tags = opts.tags or {}
	self.unique = opts.unique or false
	return self
end

function component.generate_id(comp)
	local generated_id = comp.parent.id .. '_' .. comp.type_name
	if comp.id_local ~= nil then
		generated_id = generated_id .. '_' .. comp.id_local
	end
	return generated_id
end

function component:attach(new_parent)
	if new_parent then
		self.parent = new_parent
	end
	if self.unique and self.parent:has_component(self.type_name) then
		error('component '' .. self.type_name .. '' is unique and already attached to '' .. self.parent.id .. ''')
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
	return (self.tags[tag])
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
	opts.type_name = 'spritecomponent'
	local self = setmetatable(component.new(opts), spritecomponent)
	self.imgid = opts and opts.imgid or 'none'
	self.flip = { flip_h = false, flip_v = false }
	self.colorize = opts and opts.colorize or { r = 1, g = 1, b = 1, a = 1 }
	self.scale = opts and opts.scale or { x = 1, y = 1 }
	self.offset = opts and opts.offset or { x = 0, y = 0, z = 0 }
	self.parallax_weight = opts and opts.parallax_weight or 0
	self.collider_local_id = opts and opts.collider_local_id
	self.collider_geometry_token = nil
	self.collider_offset_token = nil
	return self
end

function spritecomponent:resolve_collider()
	local owner = self.parent
	local explicit_local_id = self.collider_local_id
	if explicit_local_id ~= nil then
		return owner:get_component_by_local_id('collider2dcomponent', explicit_local_id)
	end
	local primary_sprite = owner:get_component('spritecomponent')
	if primary_sprite == self then
		if owner.collider ~= nil then
			return owner.collider
		end
		return owner:get_component('collider2dcomponent')
	end
	return nil
end

function spritecomponent:sync_collider()
	local collider = self:resolve_collider()
	if collider == nil then
		self.collider_geometry_token = nil
		self.collider_offset_token = nil
		return
	end

	local id = self.imgid
	local flip_h = (self.flip.flip_h)
	local flip_v = (self.flip.flip_v)
	local offset = self.offset or { x = 0, y = 0 }
	local offset_x = offset.x or 0
	local offset_y = offset.y or 0
	local geometry_token = string.format('%s|%d|%d', tostring(id), flip_h and 1 or 0, flip_v and 1 or 0)
	local offset_token = string.format('%s|%s', tostring(offset_x), tostring(offset_y))

	if id == 'none' then
		if self.collider_geometry_token ~= geometry_token then
			collider:set_local_area(nil)
			collider:set_local_poly(nil)
			collider:set_local_circle(nil)
			collider.sync_token = geometry_token
			self.collider_geometry_token = geometry_token
		end
		if self.collider_offset_token ~= offset_token then
			collider:set_shape_offset(offset_x, offset_y)
			self.collider_offset_token = offset_token
		end
		return
	end

	if self.collider_geometry_token ~= geometry_token then
		local image_asset = assets.img[romdir.token(id)]
		if image_asset == nil or image_asset.imgmeta == nil then
			error('[spritecomponent] image metadata missing for '' .. tostring(id) .. ''')
		end
		local imgmeta = image_asset.imgmeta
		local box = select_bounding_box(flip_h, flip_v, imgmeta.boundingbox)
		local polys = select_hit_polygons(flip_h, flip_v, imgmeta.hitpolygons)
		collider:set_local_area(box)
		collider:set_local_poly(polys)
		collider:set_local_circle(nil)
		collider.sync_token = geometry_token
		self.collider_geometry_token = geometry_token
	end
	if self.collider_offset_token ~= offset_token then
		collider:set_shape_offset(offset_x, offset_y)
		self.collider_offset_token = offset_token
	end
end

function spritecomponent:tick(_dt)
	self:sync_collider()
end

-- collider2dcomponent: holds hit areas / polys
--
-- DESIGN PRINCIPLES — collider setup
--
-- 1. SHAPE PRIORITY: circle > polys > AABB.
--    If _local_circle is set, it is used. Otherwise _local_polys (polygon array).
--    Otherwise the collider uses the owning object's AABB (sx/sy). Always prefer
--    polygon shapes when pixel-accurate hit detection matters.
--
-- 2. POLYGON SOURCE: use @cx / @cc image-filename suffixes, not manual polys.
--    When a sprite is loaded via spriteobject:gfx('enemy@cx'), rombuilder bakes
--    the convex hull at pack-time and stores it in imgmeta.hitpolygons.
--    spritecomponent.sync_collider() then copies those polys into _local_polys
--    automatically — no cart code required.
--    @cx  = convex hull  (one polygon, fast)
--    @cc  = concave hull (multiple polygons, exact)
--    none = AABB only    (rectangle, fastest)
--
-- 3. LAYER / MASK: use collision_profiles, not raw numbers.
--    Default layer = 1, mask = 0xffffffff (hits everything on layer 1).
--    Call collider:apply_collision_profile('enemy') rather than setting
--    layer/mask directly so profiles can be changed in one place.
--
-- 4. NEVER POLL colliders in update().
--    Subscribe to 'overlap.begin', 'overlap.stay', 'overlap.end' in bind()
--    (see ecs_systems.lua for event payload fields).
local collider2dcomponent = {}
collider2dcomponent.__index = collider2dcomponent
setmetatable(collider2dcomponent, { __index = component })

-- collider2dcomponent.new(opts)
--   opts fields:
--     hittable    (bool, default true)  — false = always ignored by overlap2dsystem
--     layer       (int, default 1)      — bitmask: which layer this collider is on
--     mask        (int, default 0xffffffff) — bitmask: which layers it detects
--     istrigger   (bool, default true)  — true = trigger, false = solid
--     spaceevents (string, default 'current') — scope for event emission:
--                   'current' | 'all' | 'ui' | 'both'
--     _local_area   — table {x,y,w,h} : explicit AABB override (rarely needed)
--     _local_polys  — array of polygon tables : set automatically by sync_collider()
--     _local_circle — {x,y,r} : circle shape (highest shape priority)
--     _shape_offset_x / _shape_offset_y — world-space offset added to all shapes
--   For polygon shapes, prefer the @cx/@cc image suffix over setting _local_polys manually.
function collider2dcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'collider2dcomponent'
	local self = setmetatable(component.new(opts), collider2dcomponent)
	self.hittable = true
	if opts.hittable ~= nil then
		self.hittable = opts.hittable
	end
	self.layer = opts.layer or 1
	self.mask = opts.mask or 0xffffffff
	self.istrigger = true
	if opts.istrigger ~= nil then
		self.istrigger = opts.istrigger
	end
	self.spaceevents = opts.spaceevents or 'current'
	self._local_area = nil
	self._local_polys = nil
	self._local_circle = nil
	self._shape_offset_x = opts.shape_offset_x or 0
	self._shape_offset_y = opts.shape_offset_y or 0
	self.sync_token = opts.sync_token
	self.local_area = nil
	self.local_poly = nil
	return self
end

function collider2dcomponent:set_local_area(area)
	self._local_area = area
	self.local_area = area
end

function collider2dcomponent:set_local_poly(poly)
	self._local_polys = poly
	self.local_poly = poly
end

function collider2dcomponent:set_local_circle(circle)
	self._local_circle = circle
end

function collider2dcomponent:set_shape_offset(offset_x, offset_y)
	self._shape_offset_x = offset_x or 0
	self._shape_offset_y = offset_y or 0
end

function collider2dcomponent:get_local_area()
	return self._local_area
end

function collider2dcomponent:get_local_polys()
	return self._local_polys
end

function collider2dcomponent:get_local_circle()
	return self._local_circle
end

function collider2dcomponent:get_world_area()
	local parent = self.parent
	local shape_offset_x = self._shape_offset_x
	local shape_offset_y = self._shape_offset_y
	local local_area = self._local_area
	if local_area == nil then
		local sx = parent.sx or 0
		local sy = parent.sy or 0
		return {
			left = parent.x + shape_offset_x,
			top = parent.y + shape_offset_y,
			right = parent.x + shape_offset_x + sx,
			bottom = parent.y + shape_offset_y + sy,
		}
	end
	return {
		left = parent.x + shape_offset_x + local_area.left,
		top = parent.y + shape_offset_y + local_area.top,
		right = parent.x + shape_offset_x + local_area.right,
		bottom = parent.y + shape_offset_y + local_area.bottom,
	}
end

function collider2dcomponent:get_world_polys()
	local local_polys = self._local_polys
	if local_polys == nil or #local_polys == 0 then
		return nil
	end
	local px = self.parent.x + self._shape_offset_x
	local py = self.parent.y + self._shape_offset_y
	local out = {}
	for i = 1, #local_polys do
		local poly = local_polys[i]
		local out_poly = {}
		for j = 1, #poly, 2 do
			out_poly[#out_poly + 1] = poly[j] + px
			out_poly[#out_poly + 1] = poly[j + 1] + py
		end
		out[#out + 1] = out_poly
	end
	return out
end

function collider2dcomponent:get_world_circle()
	local circle = self._local_circle
	if circle == nil then
		return nil
	end
	return {
		x = self.parent.x + self._shape_offset_x + circle.x,
		y = self.parent.y + self._shape_offset_y + circle.y,
		r = circle.r,
	}
end

-- collider2dcomponent:apply_collision_profile(profile_name)
--   Applies a named collision profile (layer + mask preset) defined via
--   collision_profiles.define(). Prefer this over setting .layer/.mask directly.
--   Returns self for method chaining.
function collider2dcomponent:apply_collision_profile(profile_name)
	collision_profiles.apply(self, profile_name)
	return self
end

-- timelinecomponent: lightweight placeholder
local timelinecomponent = {}
timelinecomponent.__index = timelinecomponent
setmetatable(timelinecomponent, { __index = component })

function timelinecomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'timelinecomponent'
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
	self.registry[instance.id] = {
		instance = instance,
		markers = markers,
		apply = instance.def.apply,
		target = instance.def.target,
		params = instance.def.params,
		tracks = instance.def.tracks,
	}
end

function timelinecomponent:get(id)
	local entry = self.registry[id]
	return entry and entry.instance
end

function timelinecomponent:seek(id, frame)
	local entry = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline '' .. id .. '' on '' .. self.parent.id .. ''')
	end
	entry.instance:force_seek(frame)
	return entry.instance
end

function timelinecomponent:force_seek(id, frame)
	return self:seek(id, frame)
end

function timelinecomponent:advance(id)
	local entry = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline '' .. id .. '' on '' .. self.parent.id .. ''')
	end
	local events = entry.instance:advance()
	if #events > 0 then
		self:process_events(entry, events, 0)
	end
	return events
end

function timelinecomponent:play(id, opts)
	local entry = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline '' .. id .. '' on '' .. self.parent.id .. ''')
	end
	local instance = entry.instance
	local owner = self.parent
	local rewind
	local snap
	local params
	local target
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
		if opts.target ~= nil then
			target = opts.target
		end
	end
	if rewind == nil then
		rewind = true
	end
	if snap == nil then
		snap = true
	end
	if params == nil then
		params = instance.def.params
	end
	if target == nil then
		target = owner
	end
	entry.params = params
	entry.target = target
	if instance.frame_builder then
		instance:build(params)
		entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
	end
	if rewind then
		local controlled = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		self:process_events(entry, instance:snap_to_start(), 0)
	end
	self.active[id] = true
	return instance
end

function timelinecomponent:stop(id)
	local entry = self.registry[id]
	if entry then
		local owner = self.parent
		local controlled = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
	end
	self.active[id] = nil
end

function timelinecomponent:tick_active(dt_ms)
	for id in pairs(self.active) do
		local entry = self.registry[id]
		local events = entry.instance:tick(dt_ms)
		if #events > 0 then
			self:process_events(entry, events, dt_ms)
		end
	end
end

function timelinecomponent:process_events(entry, events, dt_ms)
	local owner = self.parent
	local target = entry.target or owner
	local dt_seconds = dt_ms / 1000
	local time_ms = entry.instance.time_ms
	local time_seconds = time_ms / 1000
	for i = 1, #events do
		local evt = events[i]
		if evt.kind == 'frame' then
			local payload = {
				timeline_id = entry.instance.id,
				frame_index = evt.current,
				frame_value = evt.value,
				rewound = evt.rewound,
				reason = evt.reason,
				direction = evt.direction,
				dt = dt_ms,
				dt_seconds = dt_seconds,
				time_ms = time_ms,
				time_seconds = time_seconds,
			}
			self:apply_markers(entry, evt)
			local tracks = entry.tracks
			if tracks ~= nil then
				apply_tracks(target, tracks, entry.params, payload)
			end
			if entry.apply then
				if (entry.apply) then
					apply_frame(target, payload.frame_value)
				else
					entry.apply(target, payload.frame_value, entry.params, payload)
				end
			end
			self:emit_frameevent(owner, payload)
		else
			local payload = {
				timeline_id = entry.instance.id,
				mode = evt.mode,
				wrapped = evt.wrapped,
			}
			self:emit_endevent(owner, payload)
			if evt.mode == 'once' then
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
		local add_tags = marker.add_tags
		if add_tags then
			for j = 1, #add_tags do
				owner:add_tag(add_tags[j])
			end
		end
		local remove_tags = marker.remove_tags
		if remove_tags then
			for j = 1, #remove_tags do
				owner:remove_tag(remove_tags[j])
			end
		end
		local payload = marker.payload
		local spec = { type = marker.event, emitter = owner }
		if payload ~= nil then
			if type(payload) == 'table' and payload.type == nil then
				for k, v in pairs(payload) do
					spec[k] = v
				end
			else
				spec.payload = payload
			end
		end
		local event = eventemitter:create_gameevent(spec)
		owner.events:emit_event(event)
		owner.sc:dispatch(event)
	end
end

function timelinecomponent:emit_frameevent(owner, payload)
	self:dispatch_timeline_events(owner, 'timeline.frame', payload)
end

function timelinecomponent:emit_endevent(owner, payload)
	self:dispatch_timeline_events(owner, 'timeline.end', payload)
end

	function timelinecomponent:dispatch_timeline_events(owner, base_type, payload)
		local base_event = eventemitter:create_gameevent({ type = base_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
		owner.events:emit_event(base_event)
		owner.sc:dispatch(base_event)
		local scoped_type = base_type .. '.' .. payload.timeline_id
		local scoped_event = eventemitter:create_gameevent({ type = scoped_type, emitter = owner, timeline_id = payload.timeline_id, frame_index = payload.frame_index, frame_value = payload.frame_value, rewound = payload.rewound, reason = payload.reason, direction = payload.direction, mode = payload.mode, wrapped = payload.wrapped })
		owner.events:emit_event(scoped_event)
		owner.sc:dispatch(scoped_event)
	end

-- transformcomponent: simple positional proxy
local transformcomponent = {}
transformcomponent.__index = transformcomponent
setmetatable(transformcomponent, { __index = component })

function transformcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'transformcomponent'
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
	opts.type_name = 'textcomponent'
	local self = setmetatable(component.new(opts), textcomponent)
	self.text = (opts.text)
	self.font = opts.font
	self.color = opts.color or { r = 1, g = 1, b = 1, a = 1 }
	self.background_color = opts.background_color
	self.wrap_chars = opts.wrap_chars
	self.center_block_width = opts.center_block_width
	self.align = opts.align
	self.baseline = opts.baseline
	self.offset = opts.offset or { x = 0, y = 0, z = 0 }
	self.layer = opts.layer or 'world'
	return self
end

-- meshcomponent: minimal render descriptor
local meshcomponent = {}
meshcomponent.__index = meshcomponent
setmetatable(meshcomponent, { __index = component })

function meshcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'meshcomponent'
	local self = setmetatable(component.new(opts), meshcomponent)
	self.mesh = opts.mesh
	self.matrix = opts.matrix
	self.joint_matrices = opts.joint_matrices
	self.morph_weights = opts.morph_weights
	self.receive_shadow = opts.receive_shadow
	self.layer = opts.layer or 'world'
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
	opts.type_name = 'customvisualcomponent'
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
		error('customvisualcomponent: no producer for '' .. self.parent.id .. ''')
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
		parallax_weight = desc.parallax_weight,
	})
end

function customvisualcomponent:submit_rect(desc)
	local area = desc.area
	local color = desc.color
	if desc.kind == 'stroke' then
		if type(color) == 'table' then
			error('customvisualcomponent: stroke rectangle requires palette color index')
		end
		put_rect(area.left, area.top, area.right, area.bottom, area.z, color)
	else
		if type(color) == 'table' then
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
	opts.type_name = 'inputintentcomponent'
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
	opts.type_name = 'inputactioneffectcomponent'
	opts.unique = true
	local self = setmetatable(component.new(opts), inputactioneffectcomponent)
	self.program_id = opts.program_id
	self.program = opts.program
	return self
end

local function merge_ability_payload(base, payload)
	if payload == nil then
		return base
	end
	if type(payload) == 'table' then
		for k, v in pairs(payload) do
			base[k] = v
		end
		return base
	end
	base.payload = payload
	return base
end

-- abilitiescomponent: owns ability activation + lifecycle events
local abilitiescomponent = {}
abilitiescomponent.__index = abilitiescomponent
setmetatable(abilitiescomponent, { __index = component })

function abilitiescomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'abilitiescomponent'
	opts.unique = true
	local self = setmetatable(component.new(opts), abilitiescomponent)
	self.registered = {}
	self.instance_seq = {}
	self.active_seq = {}
	self.ended_seq = {}
	return self
end

function abilitiescomponent:register_ability(id, definition)
	if type(id) ~= 'string' or not (id) then
		error('[abilitiescomponent] ability id must be a non-empty string.')
	end
	if type(definition) ~= 'table' then
		error('[abilitiescomponent] ability definition must be a table for '' .. id .. ''.')
	end
	self.registered[id] = definition
end

function abilitiescomponent:activate(id, payload)
	local definition = self.registered[id]
	if definition == nil then
		error('[abilitiescomponent] unknown ability '' .. tostring(id) .. '' on '' .. self.parent.id .. ''')
	end
	local activate = definition.activate
	if activate == nil then
		return false
	end
	local result = activate({
		component = self,
		owner = self.parent,
		ability = id,
		payload = payload,
	})
	if result == nil then
		return true
	end
	return result
end

function abilitiescomponent:begin(id, payload)
	local active_seq = self.active_seq[id]
	if active_seq ~= nil and active_seq ~= 0 then
		return active_seq
	end
	local next_seq = (self.instance_seq[id] or 0) + 1
	self.instance_seq[id] = next_seq
	self.active_seq[id] = next_seq
	local event_payload = merge_ability_payload({
		ability = id,
		ability_instance_seq = next_seq,
	}, payload)
	self.parent:emit_gameplay_fact('evt.ability.start.' .. id, event_payload)
	return next_seq
end

function abilitiescomponent:end_once(id, reason, payload)
	local active_seq = self.active_seq[id]
	if active_seq == nil or active_seq == 0 then
		return false
	end
	if self.ended_seq[id] == active_seq then
		return false
	end
	self.ended_seq[id] = active_seq
	self.active_seq[id] = 0
	local event_payload = merge_ability_payload({
		ability = id,
		ability_instance_seq = active_seq,
		reason = reason,
	}, payload)
	self.parent:emit_gameplay_fact('evt.ability.end.' .. id, event_payload)
	return true
end

-- positionupdateaxiscomponent: tracks old position for physics/boundary systems
local positionupdateaxiscomponent = {}
positionupdateaxiscomponent.__index = positionupdateaxiscomponent
setmetatable(positionupdateaxiscomponent, { __index = component })

function positionupdateaxiscomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'positionupdateaxiscomponent'
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

-- Create a new screenboundarycomponent.
-- opts.stick_to_edge (bool, default true): whether prohibitleavingscreencomponent snaps to edge.
-- opts.bounds (table, optional): custom boundary rect {left, top, right, bottom}.
--   When set, the boundarysystem uses these values instead of the viewport dimensions.
--   This is used to express e.g. a room with a HUD strip at the top:
--     bounds = { left=0, top=32, right=256, bottom=224 }
--   Any field omitted falls back to the viewport edge for that side.
--   Boundary values are resolved once at construction and stored as boundary_left/top/right/bottom,
--   so the boundarysystem hot loop has no per-frame table lookups or conditionals.
function screenboundarycomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'screenboundarycomponent'
	opts.unique = true
	local self = setmetatable(positionupdateaxiscomponent.new(opts), screenboundarycomponent)
	self.stick_to_edge = true
	if opts.stick_to_edge ~= nil then
		self.stick_to_edge = opts.stick_to_edge
	end
	local bounds = opts.bounds
	self.boundary_left = bounds and bounds.left or 0
	self.boundary_top = bounds and bounds.top or 0
	self.boundary_right = bounds and bounds.right or $.viewportsize.x
	self.boundary_bottom = bounds and bounds.bottom or $.viewportsize.y
	return self
end

local tilecollisioncomponent = {}
tilecollisioncomponent.__index = tilecollisioncomponent
setmetatable(tilecollisioncomponent, { __index = positionupdateaxiscomponent })

function tilecollisioncomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'tilecollisioncomponent'
	opts.unique = true
	local self = setmetatable(positionupdateaxiscomponent.new(opts), tilecollisioncomponent)
	return self
end

local prohibitleavingscreencomponent = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
setmetatable(prohibitleavingscreencomponent, { __index = screenboundarycomponent })

function prohibitleavingscreencomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'prohibitleavingscreencomponent'
	opts.unique = true
	local self = setmetatable(screenboundarycomponent.new(opts), prohibitleavingscreencomponent)
	return self
end

function prohibitleavingscreencomponent:bind()
	self.parent.events:on({ event_name = 'screen.leaving', handler = function(event)
		local p = self.parent
		if event.d == 'left' then
			p.x = self.stick_to_edge and self.boundary_left or event.old_x_or_y
		elseif event.d == 'right' then
			p.x = self.stick_to_edge and (self.boundary_right - p.sx) or event.old_x_or_y
		elseif event.d == 'up' then
			p.y = self.stick_to_edge and self.boundary_top or event.old_x_or_y
		elseif event.d == 'down' then
			p.y = self.stick_to_edge and (self.boundary_bottom - p.sy) or event.old_x_or_y
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
	abilitiescomponent = abilitiescomponent,
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
		error('component '' .. type_name .. '' is not registered.')
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
	abilitiescomponent = abilitiescomponent,
	positionupdateaxiscomponent = positionupdateaxiscomponent,
	screenboundarycomponent = screenboundarycomponent,
	tilecollisioncomponent = tilecollisioncomponent,
	prohibitleavingscreencomponent = prohibitleavingscreencomponent,
	componentregistry = componentregistry,
	register_component = register_component,
	new_component = new_component,
}
