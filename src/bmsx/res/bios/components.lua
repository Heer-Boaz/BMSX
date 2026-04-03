-- components.lua
-- base component primitives for system rom

local eventemitter<const> = require('eventemitter')
local timeline_module<const> = require('timeline')
local timeline_dispatch<const> = require('timeline_dispatch')
local collision_profiles<const> = require('collision_profiles')
local scratchrecordbatch<const> = require('scratchrecordbatch')
local wrap_text_lines<const> = require('util/wrap_text_lines')

local submit_glyph_lines<const> = function(lines, x, y, z, font, color_val, bg_color_val, line_height, center_w, glyph_start, glyph_end, layer)
	-- Direct MMIO glyph rendering would go here, not service calls
end
local eventemitter<const> = eventemitter.eventemitter
local timeline<const> = timeline_module.timeline

local apply_frame<const> = function(target, frame)
	for k, v in pairs(frame) do
		if type(v) == 'table' then
			apply_frame(target[k], v)
		else
			target[k] = v
		end
	end
end

local set_path<const> = function(target, path, value)
	local node = target
	for i = 1, #path - 1 do
		node = node[path[i]]
	end
	node[path[#path]] = value
end

local select_bounding_box<const> = function(flip_h, flip_v, box)
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

local select_hit_polygons<const> = function(flip_h, flip_v, polys)
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

local eval_wave<const> = function(track, time_seconds)
	local u<const> = (time_seconds / track.period) + (track.phase or 0)
	local w
	if track.wave == 'pingpong' then
		w = easing.pingpong01(u)
	elseif track.wave == 'sin' then
		w = (math.sin(u * (math.pi * 2)) + 1) * 0.5
	else
		error('[timelinecomponent] unknown wave "' .. tostring(track.wave) .. '".')
	end
	local ease<const> = track.ease
	if ease ~= nil then
		w = ease(w)
	end
	return w
end

local apply_track<const> = function(target, track, params, event)
	if type(track) == 'function' then
		track(target, params, event)
		return
	end
	local kind<const> = track.kind
	if kind == 'wave' then
		local base<const> = track.base
		local base_value<const> = type(base) == 'string' and params[base] or base
		local w<const> = eval_wave(track, event.time_seconds)
		local value<const> = base_value + ((w - 0.5) * 2 * track.amp)
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

local apply_tracks<const> = function(target, tracks, params, event)
	for i = 1, #tracks do
		apply_track(target, tracks[i], params, event)
	end
end

local component<const> = {}
component.__index = component

function component.new(opts)
	local self<const> = setmetatable({}, component)
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
		error('component "' .. self.type_name .. '" is unique and already attached to "' .. self.parent.id .. '"')
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

function component:update(_dt)
end

function component:draw()
end

-- spritecomponent: holds sprite metadata
local spritecomponent<const> = {}
spritecomponent.__index = spritecomponent
setmetatable(spritecomponent, { __index = component })

function spritecomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'spritecomponent'
	local self<const> = setmetatable(component.new(opts), spritecomponent)
	self.imgid = opts and opts.imgid
	self.layer = opts and opts.layer or sys_vdp_layer_world
	self.flip = { flip_h = false, flip_v = false }
	self.colorize = opts and opts.colorize or { r = 1, g = 1, b = 1, a = 1 }
	self.scale = opts and opts.scale or { x = 1, y = 1 }
	self.offset = opts and opts.offset or { x = 0, y = 0, z = 0 }
	self.parallax_weight = opts and opts.parallax_weight or 0
	self.collider_local_id = opts and opts.collider_local_id
	return self
end

-- collider2dcomponent: holds hit areas / polys
--
-- DESIGN PRINCIPLES — collider setup
--
-- 1. SHAPE PRIORITY: circle > polys > AABB.
--    If local_circle is set, it is used. Otherwise local_polys (polygon array).
--    Otherwise the collider uses the owning object's AABB (sx/sy). Always prefer
--    polygon shapes when pixel-accurate hit detection matters.
--
-- 2. POLYGON SOURCE: use @cx / @cc image-filename suffixes, not manual polys.
--    When a sprite is loaded via spriteobject:gfx('enemy@cx'), rombuilder bakes
--    the convex hull at pack-time and stores it in imgmeta.hitpolygons.
--    collider2dcomponent then reads those polys lazily from the sprite metadata
--    automatically — no cart code required.
--    @cx  = convex hull  (one polygon, fast)
--    @cc  = tighter multi-piece convex fit (multiple polygons, slower)
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
local collider2dcomponent<const> = {}
collider2dcomponent.__index = collider2dcomponent
setmetatable(collider2dcomponent, { __index = component })

local get_sprite_offset_xy<const> = function(sprite)
	return sprite.offset.x, sprite.offset.y
end

local get_driving_sprite_for_collider<const> = function(collider)
	local owner<const> = collider.parent
	if owner == nil then
		return nil
	end
	if owner.collider ~= nil and owner.collider == collider then
		if owner.sprite_component ~= nil then
			return owner.sprite_component
		end
		return owner:get_component('spritecomponent')
	end
	local sprites<const> = owner:get_components('spritecomponent')
	for i = 1, #sprites do
		local sprite<const> = sprites[i]
		if sprite.collider_local_id == collider.id_local then
			return sprite
		end
	end
	return nil
end

local get_sprite_collision_geometry<const> = function(sprite)
	local id<const> = sprite.imgid
	if id == nil then
		return nil, nil
	end
	local image_asset<const> = assets.img[id]
	if image_asset == nil or image_asset.imgmeta == nil then
		error('[spritecomponent] image metadata missing for "' .. tostring(id) .. '"')
	end
	local imgmeta<const> = image_asset.imgmeta
	local flip_h<const> = sprite.flip.flip_h
	local flip_v<const> = sprite.flip.flip_v
	return select_bounding_box(flip_h, flip_v, imgmeta.boundingbox), select_hit_polygons(flip_h, flip_v, imgmeta.hitpolygons)
end

local update_world_area_cache<const> = function(collider)
	local parent<const> = collider.parent
	local sprite<const> = get_driving_sprite_for_collider(collider)
	local shape_offset_x = collider.shape_offset_x
	local shape_offset_y = collider.shape_offset_y
	local local_area = collider.local_area
	if sprite ~= nil then
		local_area = get_sprite_collision_geometry(sprite)
		shape_offset_x, shape_offset_y = get_sprite_offset_xy(sprite)
	end
	local area<const> = collider._world_area_cache
	if local_area == nil then
		local sx<const> = parent.sx or 0
		local sy<const> = parent.sy or 0
		area.left = parent.x + shape_offset_x
		area.top = parent.y + shape_offset_y
		area.right = area.left + sx
		area.bottom = area.top + sy
	else
		area.left = parent.x + shape_offset_x + local_area.left
		area.top = parent.y + shape_offset_y + local_area.top
		area.right = parent.x + shape_offset_x + local_area.right
		area.bottom = parent.y + shape_offset_y + local_area.bottom
	end
	local area_poly<const> = collider._world_area_poly_cache
	area_poly[1] = area.left
	area_poly[2] = area.top
	area_poly[3] = area.right
	area_poly[4] = area.top
	area_poly[5] = area.right
	area_poly[6] = area.bottom
	area_poly[7] = area.left
	area_poly[8] = area.bottom
	return area
end

-- collider2dcomponent.new(opts)
--   opts fields:
--     hittable    (bool, default true)  — false = always ignored by overlap2dsystem
--     layer       (int, default 1)      — bitmask: which layer this collider is on
--     mask        (int, default 0xffffffff) — bitmask: which layers it detects
--     istrigger   (bool, default true)  — true = trigger, false = solid
--     spaceevents (string, default 'current') — scope for event emission:
--                   'current' | 'all' | 'ui' | 'both'
--     local_area   — table {left,top,right,bottom} : explicit AABB override
--     local_polys  — array of polygon tables : manual polygon override
--     local_circle — {x,y,r} : circle shape (highest shape priority)
--     shape_offset_x / shape_offset_y — world-space offset added to all shapes
--   For polygon shapes, prefer the @cx/@cc image suffix over setting local_polys manually.
function collider2dcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'collider2dcomponent'
	local self<const> = setmetatable(component.new(opts), collider2dcomponent)
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
	self.local_area = opts.local_area
	self.local_polys = opts.local_polys
	self.local_circle = opts.local_circle
	self.shape_offset_x = 0
	if opts.shape_offset_x ~= nil then
		self.shape_offset_x = opts.shape_offset_x
	end
	self.shape_offset_y = 0
	if opts.shape_offset_y ~= nil then
		self.shape_offset_y = opts.shape_offset_y
	end
	self._world_area_cache = {
		left = 0,
		top = 0,
		right = 0,
		bottom = 0,
	}
	self._world_area_poly_cache = { 0, 0, 0, 0, 0, 0, 0, 0 }
	self._world_area_polys_cache = { self._world_area_poly_cache }
	self._world_circle_cache = { x = 0, y = 0, r = 0 }
	self._world_polys_cache = {}
	return self
end

function collider2dcomponent:set_local_shape(area, polys, circle)
	self.local_area = area
	self.local_polys = polys
	self.local_circle = circle
end

function collider2dcomponent:set_local_area(area)
	self.local_area = area
end

function collider2dcomponent:set_local_poly(poly)
	self.local_polys = poly
end

function collider2dcomponent:set_local_circle(circle)
	self.local_circle = circle
end

function collider2dcomponent:set_shape_offset(offset_x, offset_y)
	self.shape_offset_x = offset_x
	self.shape_offset_y = offset_y
end

function collider2dcomponent:get_world_area()
	return update_world_area_cache(self)
end

function collider2dcomponent:get_world_area_poly()
	update_world_area_cache(self)
	return self._world_area_poly_cache
end

function collider2dcomponent:get_world_area_polys()
	update_world_area_cache(self)
	return self._world_area_polys_cache
end

function collider2dcomponent:get_shape_kind()
	local sprite<const> = get_driving_sprite_for_collider(self)
	if sprite ~= nil then
		local _<const>, local_polys<const> = get_sprite_collision_geometry(sprite)
		if local_polys ~= nil and #local_polys > 0 then
			return 'poly'
		end
		return 'aabb'
	end
	if self.local_circle ~= nil then
		return 'circle'
	end
	local local_polys<const> = self.local_polys
	if local_polys ~= nil and #local_polys > 0 then
		return 'poly'
	end
	return 'aabb'
end

function collider2dcomponent:get_world_polys()
	local sprite<const> = get_driving_sprite_for_collider(self)
	local local_polys = self.local_polys
	local px = self.parent.x + self.shape_offset_x
	local py = self.parent.y + self.shape_offset_y
	if sprite ~= nil then
		local _<const>, sprite_polys<const> = get_sprite_collision_geometry(sprite)
		local_polys = sprite_polys
		local offset_x
		local offset_y
		offset_x, offset_y = get_sprite_offset_xy(sprite)
		px = self.parent.x + offset_x
		py = self.parent.y + offset_y
	end
	if local_polys == nil or #local_polys == 0 then
		return nil
	end
	local out<const> = self._world_polys_cache
	for i = 1, #local_polys do
		local poly<const> = local_polys[i]
		local out_poly = out[i]
		if out_poly == nil then
			out_poly = {}
			out[i] = out_poly
		end
		local old_len<const> = #out_poly
		for j = 1, #poly, 2 do
			out_poly[j] = poly[j] + px
			out_poly[j + 1] = poly[j + 1] + py
		end
		for j = #poly + 1, old_len do
			out_poly[j] = nil
		end
	end
	for i = #local_polys + 1, #out do
		out[i] = nil
	end
	return out
end

function collider2dcomponent:get_world_circle()
	if get_driving_sprite_for_collider(self) ~= nil then
		return nil
	end
	local circle<const> = self.local_circle
	if circle == nil then
		return nil
	end
	local px<const> = self.parent.x + self.shape_offset_x
	local py<const> = self.parent.y + self.shape_offset_y
	local out<const> = self._world_circle_cache
	out.x = px + circle.x
	out.y = py + circle.y
	out.r = circle.r
	return out
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
local timelinecomponent<const> = {}
timelinecomponent.__index = timelinecomponent
setmetatable(timelinecomponent, { __index = component })

local process_timeline_frame_payload<const> = function(_, entry, owner, payload)
	local target<const> = entry.target or owner
	local tracks<const> = entry.tracks
	if tracks ~= nil then
		apply_tracks(target, tracks, entry.params, payload)
	end
	local apply<const> = entry.apply
	if apply ~= nil then
		if type(apply) == 'function' then
			apply(target, payload.frame_value, entry.params, payload)
		else
			apply_frame(target, payload.frame_value)
		end
	end
end

function timelinecomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'timelinecomponent'
	opts.unique = true
	local self<const> = setmetatable(component.new(opts), timelinecomponent)
	self.registry = {}
	self.active = {}
	self.listeners = {}
	return self
end

function timelinecomponent:define(definition)
	local instance<const> = definition.__is_timeline and definition or timeline.new(definition)
	local markers<const> = timeline_module.compile_timeline_markers(instance.def, instance.length)
	self.registry[instance.id] = {
		instance = instance,
		markers = markers,
		apply = instance.def.apply,
		target = instance.def.target,
		params = instance.def.params,
		tracks = instance.def.tracks,
	}
	timeline_dispatch.init_entry(self.registry[instance.id], self.parent)
end

function timelinecomponent:get(id)
	local entry<const> = self.registry[id]
	return entry and entry.instance
end

function timelinecomponent:seek(id, frame)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
	entry.instance:force_seek(frame)
	return entry.instance
end

function timelinecomponent:force_seek(id, frame)
	return self:seek(id, frame)
end

function timelinecomponent:advance(id)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
	local instance<const> = entry.instance
	if instance:advance() ~= nil then
		if timeline_dispatch.process_instance_events(entry, self.parent, 0, process_timeline_frame_payload) then
			self.active[instance.id] = nil
		end
	end
	return instance
end

function timelinecomponent:play(id, opts)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
	local instance<const> = entry.instance
	local owner<const> = self.parent
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
		target = entry.target or owner
	end
	entry.params = params
	entry.target = target
	if instance.frame_builder then
		instance:build(params)
		entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
	end
	timeline_dispatch.init_entry(entry, owner)
	if rewind then
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		if instance:snap_to_start() ~= nil then
			if timeline_dispatch.process_instance_events(entry, owner, 0, process_timeline_frame_payload) then
				self.active[id] = nil
			end
		end
	end
	self.active[id] = true
	return instance
end

function timelinecomponent:stop(id)
	local entry<const> = self.registry[id]
	if entry then
		local owner<const> = self.parent
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
	end
	self.active[id] = nil
end

function timelinecomponent:tick_active(dt_ms)
	for id in pairs(self.active) do
		local entry<const> = self.registry[id]
		if entry.instance:update(dt_ms) ~= nil then
			if timeline_dispatch.process_instance_events(entry, self.parent, dt_ms, process_timeline_frame_payload) then
				self.active[id] = nil
			end
		end
	end
end

-- transformcomponent: simple positional proxy
local transformcomponent<const> = {}
transformcomponent.__index = transformcomponent
setmetatable(transformcomponent, { __index = component })

function transformcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'transformcomponent'
	opts.unique = true
	local self<const> = setmetatable(component.new(opts), transformcomponent)
	local p<const> = self.parent
	self.position = opts.position or { x = p.x or 0, y = p.y or 0, z = p.z or 0 }
	self.scale = opts.scale or { x = 1, y = 1, z = 1 }
	self.orientation = opts.orientation
	return self
end

function transformcomponent:post_update()
	local p<const> = self.parent
	self.position.x = p.x
	self.position.y = p.y
	self.position.z = p.z
end

-- textcomponent: lightweight render descriptor
local textcomponent<const> = {}
textcomponent.__index = textcomponent
setmetatable(textcomponent, { __index = component })

function textcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'textcomponent'
	local self<const> = setmetatable(component.new(opts), textcomponent)
	self.text = (opts.text)
	self.font = opts.font or get_default_font()
	self.color = opts.color or { r = 1, g = 1, b = 1, a = 1 }
	self.background_color = opts.background_color
	self.wrap_chars = opts.wrap_chars
	self.center_block_width = opts.center_block_width
	self.align = opts.align
	self.baseline = opts.baseline
	self.offset = opts.offset or { x = 0, y = 0, z = 0 }
	self.layer = opts.layer or sys_vdp_layer_world
	return self
end

-- meshcomponent: minimal render descriptor
local meshcomponent<const> = {}
meshcomponent.__index = meshcomponent
setmetatable(meshcomponent, { __index = component })

function meshcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'meshcomponent'
	local self<const> = setmetatable(component.new(opts), meshcomponent)
	self.mesh = opts.mesh
	self.matrix = opts.matrix
	self.joint_matrices = opts.joint_matrices
	self.morph_weights = opts.morph_weights
	self.receive_shadow = opts.receive_shadow
	self.layer = opts.layer or sys_vdp_layer_world
	return self
end

function meshcomponent:update_animation(_dt)
end

local ambientlightcomponent<const> = {}
ambientlightcomponent.__index = ambientlightcomponent
setmetatable(ambientlightcomponent, { __index = component })

function ambientlightcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'ambientlightcomponent'
	local self<const> = setmetatable(component.new(opts), ambientlightcomponent)
	self.color = opts.color or { r = 1, g = 1, b = 1 }
	self.intensity = opts.intensity or 1
	return self
end

local directionallightcomponent<const> = {}
directionallightcomponent.__index = directionallightcomponent
setmetatable(directionallightcomponent, { __index = component })

function directionallightcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'directionallightcomponent'
	local self<const> = setmetatable(component.new(opts), directionallightcomponent)
	self.orientation = opts.orientation or { x = 0, y = -1, z = 0 }
	self.color = opts.color or { r = 1, g = 1, b = 1 }
	self.intensity = opts.intensity or 1
	return self
end

local pointlightcomponent<const> = {}
pointlightcomponent.__index = pointlightcomponent
setmetatable(pointlightcomponent, { __index = component })

function pointlightcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'pointlightcomponent'
	local self<const> = setmetatable(component.new(opts), pointlightcomponent)
	self.offset = opts.offset or { x = 0, y = 0, z = 0 }
	self.color = opts.color or { r = 1, g = 1, b = 1 }
	self.range = opts.range or 6
	self.intensity = opts.intensity or 1
	return self
end

-- customvisualcomponent: scripted render producer
local customvisualcomponent<const> = {}
customvisualcomponent.__index = customvisualcomponent
setmetatable(customvisualcomponent, { __index = component })
local customvisual_scratch_items<const> = scratchrecordbatch.new(2):reserve(2)
local customvisual_mesh_options<const> = customvisual_scratch_items[1]
local customvisual_particle_options<const> = customvisual_scratch_items[2]

function customvisualcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'customvisualcomponent'
	local self<const> = setmetatable(component.new(opts), customvisualcomponent)
	self.producer = opts.producer
	return self
end

function customvisualcomponent:add_producer(fn)
	if not fn then
		self.producer = nil
		return
	end
	local prev<const> = self.producer
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
		error('customvisualcomponent: no producer for "' .. self.parent.id .. '"')
	end
	self.producer({ parent = self.parent, rc = self })
end

function customvisualcomponent:submit_sprite(desc)
	local pos<const> = desc.pos or desc.position
	local flip<const> = desc.flip
	local flip_flags = 0
	if flip.flip_h then
		flip_flags = flip_flags | 1
	end
	if flip.flip_v then
		flip_flags = flip_flags | 2
	end
	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
		sys_vdp_cmd_blit,
		 13,
		0,
		assets.img[desc.imgid].handle,
		pos.x,
		pos.y,
		pos.z,
		desc.layer,
		desc.scale.x,
		desc.scale.y,
		flip_flags,
		desc.colorize.r,
		desc.colorize.g,
		desc.colorize.b,
		desc.colorize.a,
		desc.parallax_weight
	)
end

function customvisualcomponent:submit_rect(desc)
	local area<const> = desc.area
	local color<const> = desc.color
	local x0<const>, y0<const>, x1<const>, y1<const>, z<const> = area.left, area.top, area.right, area.bottom, area.z
	if desc.kind == 'stroke' then
		local c<const> = color
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11), sys_vdp_cmd_draw_line, 11, 0, x0, y0, x1, y0, z, sys_vdp_layer_world, c.r, c.g, c.b, c.a, 1)
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11), sys_vdp_cmd_draw_line, 11, 0, x1, y0, x1, y1, z, sys_vdp_layer_world, c.r, c.g, c.b, c.a, 1)
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11), sys_vdp_cmd_draw_line, 11, 0, x1, y1, x0, y1, z, sys_vdp_layer_world, c.r, c.g, c.b, c.a, 1)
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11), sys_vdp_cmd_draw_line, 11, 0, x0, y1, x0, y0, z, sys_vdp_layer_world, c.r, c.g, c.b, c.a, 1)
	else
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10),
			sys_vdp_cmd_fill_rect,
			10,
			0,
			x0,
			y0,
			x1,
			y1,
			z,
			sys_vdp_layer_world,
			color.r,
			color.g,
			color.b,
			color.a
		)
	end
end

function customvisualcomponent:submit_poly(desc)
	local points<const> = desc.points
	local z<const> = desc.z
	local color<const> = desc.color
	local thickness<const> = desc.thickness or 1
	local n<const> = #points / 2
	for i = 0, n - 1 do
		local x0<const> = points[i * 2 + 1]
		local y0<const> = points[i * 2 + 2]
		local x1<const> = points[((i + 1) % n) * 2 + 1]
		local y1<const> = points[((i + 1) % n) * 2 + 2]
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 11), sys_vdp_cmd_draw_line, 11, 0, x0, y0, x1, y1, z, sys_vdp_layer_world, color.r, color.g, color.b, color.a, thickness)
	end
end

function customvisualcomponent:submit_mesh(desc)
	customvisual_mesh_options.joint_matrices = desc.joint_matrices
	customvisual_mesh_options.morph_weights = desc.morph_weights
	customvisual_mesh_options.receive_shadow = desc.receive_shadow
	put_mesh(desc.mesh, desc.matrix, customvisual_mesh_options)
end

function customvisualcomponent:submit_particle(desc)
	customvisual_particle_options.texture = desc.texture
	customvisual_particle_options.ambient_mode = desc.ambient_mode
	customvisual_particle_options.ambient_factor = desc.ambient_factor
	put_particle(desc.position, desc.size, desc.color, customvisual_particle_options)
end

function customvisualcomponent:submit_glyphs(desc)
	local render_font<const> = desc.font or get_default_font()
	local color<const> = desc.color
	local background_color<const> = desc.background_color
	local layer<const> = desc.layer or sys_vdp_layer_world
	local glyphs = desc.glyphs
	if type(glyphs) == 'string' then
		if desc.wrap_chars ~= nil and desc.wrap_chars > 0 then
			glyphs = wrap_text_lines(glyphs, desc.wrap_chars)
		else
			glyphs = { glyphs }
		end
	end
	submit_glyph_lines(
		glyphs,
		desc.x,
		desc.y,
		desc.z,
		render_font,
		color,
		background_color,
		render_font.line_height,
		desc.center_block_width,
		desc.glyph_start or 0,
		desc.glyph_end or 2147483647,
		layer
	)
end

-- inputintentcomponent: declarative input -> state bindings
local inputintentcomponent<const> = {}
inputintentcomponent.__index = inputintentcomponent
setmetatable(inputintentcomponent, { __index = component })

function inputintentcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'inputintentcomponent'
	opts.unique = true
	local self<const> = setmetatable(component.new(opts), inputintentcomponent)
	self.player_index = opts.player_index or 1
	self.bindings = opts.bindings or {}
	return self
end

-- inputactioneffectcomponent: links an input-action program to an object
local inputactioneffectcomponent<const> = {}
inputactioneffectcomponent.__index = inputactioneffectcomponent
setmetatable(inputactioneffectcomponent, { __index = component })

function inputactioneffectcomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'inputactioneffectcomponent'
	opts.unique = true
	local self<const> = setmetatable(component.new(opts), inputactioneffectcomponent)
	self.program_id = opts.program_id
	self.program = opts.program
	return self
end

-- abilitiescomponent: owns ability activation + lifecycle events
local abilitiescomponent<const> = {}
abilitiescomponent.__index = abilitiescomponent
setmetatable(abilitiescomponent, { __index = component })

function abilitiescomponent.new(opts)
	opts = opts or {}
	opts.type_name = 'abilitiescomponent'
	opts.unique = true
	local self<const> = setmetatable(component.new(opts), abilitiescomponent)
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
		error('[abilitiescomponent] ability definition must be a table for "' .. id .. '".')
	end
	self.registered[id] = definition
end

function abilitiescomponent:activate(id, payload)
	local definition<const> = self.registered[id]
	if definition == nil then
		error('[abilitiescomponent] unknown ability "' .. tostring(id) .. '" on "' .. self.parent.id .. '"')
	end
	local activate<const> = definition.activate
	if activate == nil then
		return false
	end
	local result<const> = activate({
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
	local active_seq<const> = self.active_seq[id]
	if active_seq ~= nil and active_seq ~= 0 then
		return active_seq
	end
	local next_seq<const> = (self.instance_seq[id] or 0) + 1
	self.instance_seq[id] = next_seq
	self.active_seq[id] = next_seq
	local event_payload<const> = {
		ability = id,
		ability_instance_seq = next_seq,
		payload = payload,
	}
	self.parent:emit_gameplay_fact('evt.ability.start.' .. id, event_payload)
	return next_seq
end

function abilitiescomponent:end_once(id, reason, payload)
	local active_seq<const> = self.active_seq[id]
	if active_seq == nil or active_seq == 0 then
		return false
	end
	if self.ended_seq[id] == active_seq then
		return false
	end
	self.ended_seq[id] = active_seq
	self.active_seq[id] = 0
	local event_payload<const> = {
		ability = id,
		ability_instance_seq = active_seq,
		reason = reason,
		payload = payload,
	}
	self.parent:emit_gameplay_fact('evt.ability.end.' .. id, event_payload)
	return true
end

-- positionupdateaxiscomponent: tracks old position for physics/boundary systems
local positionupdateaxiscomponent<const> = {}
positionupdateaxiscomponent.__index = positionupdateaxiscomponent
setmetatable(positionupdateaxiscomponent, { __index = component })

-- ECS component queries match exact type_name, not Lua inheritance.
-- Derived constructors must therefore stamp their own type_name up front.
local new_typed_component_instance<const> = function(component_class, type_name, opts, unique)
	opts = opts or {}
	return setmetatable(component.new({
		parent = opts.parent,
		type_name = type_name,
		id_local = opts.id_local,
		id = opts.id,
		enabled = opts.enabled,
		tags = opts.tags,
		unique = unique == nil and opts.unique or unique,
	}), component_class)
end

local init_positionupdateaxis_fields<const> = function(self)
	self.old_pos = { x = 0, y = 0 }
	return self
end

function positionupdateaxiscomponent.new(opts)
	return init_positionupdateaxis_fields(new_typed_component_instance(
		positionupdateaxiscomponent,
		'positionupdateaxiscomponent',
		opts
	))
end

function positionupdateaxiscomponent:preprocess_update()
	local p<const> = self.parent
	self.old_pos.x = p.x
	self.old_pos.y = p.y
end

local screenboundarycomponent<const> = {}
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
local init_screenboundary_fields<const> = function(self, opts)
	opts = opts or {}
	self.stick_to_edge = true
	if opts.stick_to_edge ~= nil then
		self.stick_to_edge = opts.stick_to_edge
	end
	local bounds<const> = opts.bounds
	self.boundary_left = bounds and bounds.left or 0
	self.boundary_top = bounds and bounds.top or 0
	self.boundary_right = bounds and bounds.right or $.viewportsize.x
	self.boundary_bottom = bounds and bounds.bottom or $.viewportsize.y
	return self
end

function screenboundarycomponent.new(opts)
	local self<const> = new_typed_component_instance(screenboundarycomponent, 'screenboundarycomponent', opts, true)
	init_positionupdateaxis_fields(self)
	return init_screenboundary_fields(self, opts)
end

local tilecollisioncomponent<const> = {}
tilecollisioncomponent.__index = tilecollisioncomponent
setmetatable(tilecollisioncomponent, { __index = positionupdateaxiscomponent })

function tilecollisioncomponent.new(opts)
	opts = opts or {}
	local self<const> = init_positionupdateaxis_fields(new_typed_component_instance(
		tilecollisioncomponent,
		'tilecollisioncomponent',
		opts,
		true
	))
	self.query = opts.query
	if type(self.query) ~= 'function' then
		error('[tilecollisioncomponent] opts.query must be a function')
	end
	self.event_base = opts.event_base or 'tilecollision'
	self.previous_collision_key = nil
	self.current_payload = {}
	self.previous_payload = {}
	self._event = {}
	return self
end

local prohibitleavingscreencomponent<const> = {}
prohibitleavingscreencomponent.__index = prohibitleavingscreencomponent
setmetatable(prohibitleavingscreencomponent, { __index = screenboundarycomponent })

function prohibitleavingscreencomponent.new(opts)
	local self<const> = new_typed_component_instance(prohibitleavingscreencomponent, 'prohibitleavingscreencomponent', opts, true)
	init_positionupdateaxis_fields(self)
	return init_screenboundary_fields(self, opts)
end

function prohibitleavingscreencomponent:bind()
	self.parent.events:on({ event_name = 'screen.leaving', handler = function(event)
		local p<const> = self.parent
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

local componentregistry<const> = {
	component = component,
	spritecomponent = spritecomponent,
	collider2dcomponent = collider2dcomponent,
	timelinecomponent = timelinecomponent,
	transformcomponent = transformcomponent,
	textcomponent = textcomponent,
	meshcomponent = meshcomponent,
	ambientlightcomponent = ambientlightcomponent,
	directionallightcomponent = directionallightcomponent,
	pointlightcomponent = pointlightcomponent,
	customvisualcomponent = customvisualcomponent,
	inputintentcomponent = inputintentcomponent,
	inputactioneffectcomponent = inputactioneffectcomponent,
	abilitiescomponent = abilitiescomponent,
	positionupdateaxiscomponent = positionupdateaxiscomponent,
	screenboundarycomponent = screenboundarycomponent,
	tilecollisioncomponent = tilecollisioncomponent,
	prohibitleavingscreencomponent = prohibitleavingscreencomponent,
}

local register_component<const> = function(type_name, ctor)
	componentregistry[type_name] = ctor
end

local new_component<const> = function(type_name, opts)
	local ctor<const> = componentregistry[type_name]
	if not ctor then
		error('component "' .. type_name .. '" is not registered.')
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
	ambientlightcomponent = ambientlightcomponent,
	directionallightcomponent = directionallightcomponent,
	pointlightcomponent = pointlightcomponent,
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
