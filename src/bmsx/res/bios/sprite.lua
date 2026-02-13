-- sprite.lua
-- spriteobject built atop worldobject

local worldobject = require("worldobject")
local components = require("components")
local romdir = require("romdir")
local timeline_module = require("timeline")

local spriteobject = {}
spriteobject.__index = spriteobject
setmetatable(spriteobject, { __index = worldobject })

local base_sprite_id = "base_sprite"
local primary_collider_id = "primary"

local function apply_image_metadata(self, id)
	local meta = assets.img[romdir.token(id)].imgmeta
	self.sx = meta.width
	self.sy = meta.height
end

local function copy_colorize(value)
	return { r = value.r, g = value.g, b = value.b, a = value.a }
end

local function copy_scale(value)
	return { x = value.x, y = value.y }
end

local function copy_offset(value)
	return { x = value.x or 0, y = value.y or 0, z = value.z or 0 }
end

local function copy_definition(def)
	local out = {}
	for k, v in pairs(def) do
		out[k] = v
	end
	return out
end

local function normalize_animation_frames(frames)
	local out = {}
	for i = 1, #frames do
		local frame = frames[i]
		if type(frame) == "string" then
			out[#out + 1] = { imgid = frame }
		else
			out[#out + 1] = frame
		end
	end
	return out
end

local function padded_index(index, digits)
	local out = tostring(index)
	if not digits or #out >= digits then
		return out
	end
	return string.rep("0", digits - #out) .. out
end

function spriteobject.new(opts)
	local self = setmetatable(worldobject.new(opts), spriteobject)
	self.type_name = "spriteobject"
	self.flip_h = false
	self.flip_v = false
	self.imgid = "none"
	self.animations = {}
	self.current_animation = nil

	self.sprite_component = components.spritecomponent.new({ parent = self, imgid = self.imgid, id_local = base_sprite_id })
	self.collider = components.collider2dcomponent.new({ parent = self, id_local = primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)

	return self
end

function spriteobject:gfx(id, meta)
	self.imgid = id
	self.sprite_component.imgid = id
	if id == "none" then
		return
	end
	if meta then
		self.sx = meta.width
		self.sy = meta.height
	else
		apply_image_metadata(self, id)
	end
end

function spriteobject:play_ani(id, opts)
	self.current_animation = id
	self.timelines:play(id, opts)
end

function spriteobject:play_ani_if_changed(id, opts)
	if self.current_animation == id then
		return
	end
	self:play_ani(id, opts)
end

function spriteobject:stop_ani(id)
	if self.current_animation == id then
		self.current_animation = nil
	end
	self.timelines:stop(id)
end

function spriteobject:resume_ani(id)
	self:play_ani(id)
end

function spriteobject:apply_animation_frame(frame)
	if type(frame) == "string" then
		self:gfx(frame)
		return
	end
	if frame.imgid then
		self:gfx(frame.imgid, frame.meta)
	end
	local sc = self.sprite_component
	if frame.scale ~= nil then
		sc.scale = copy_scale(frame.scale)
	end
	if frame.offset ~= nil then
		sc.offset = copy_offset(frame.offset)
	end
	if frame.colorize ~= nil then
		sc.colorize = copy_colorize(frame.colorize)
	end
	if frame.flip_h ~= nil then
		sc.flip.flip_h = frame.flip_h
	end
	if frame.flip_v ~= nil then
		sc.flip.flip_v = frame.flip_v
	end
	if frame.parallax_weight ~= nil then
		sc.parallax_weight = frame.parallax_weight
	end
end

function spriteobject:build_animation_strip(def)
	local frames = {}
	local from_index = def.from
	local to_index = def.to
	local step = def.step or 1
	if from_index <= to_index then
		for i = from_index, to_index, step do
			frames[#frames + 1] = def.prefix .. padded_index(i, def.digits)
		end
	else
		for i = from_index, to_index, -step do
			frames[#frames + 1] = def.prefix .. padded_index(i, def.digits)
		end
	end
	return frames
end

function spriteobject:define_animation(definition)
	local definition_copy = copy_definition(definition)
	local frames = definition_copy.frames
	if definition_copy.strip ~= nil then
		frames = self:build_animation_strip(definition_copy.strip)
	end
	if definition_copy.sequence ~= nil then
		local sequence = {}
		for i = 1, #definition_copy.sequence do
			local entry = definition_copy.sequence[i]
			local value = entry.value
			if entry.frame ~= nil then
				value = entry.frame
			end
			if type(value) == "string" then
				value = { imgid = value }
			end
			sequence[#sequence + 1] = { value = value, hold = entry.hold or 1 }
		end
		frames = timeline_module.build_frame_sequence(sequence)
	else
		frames = normalize_animation_frames(frames)
	end
	if definition_copy.pingpong == true then
		frames = timeline_module.build_pingpong_frames(frames, definition_copy.include_endpoints)
	end
	local user_apply = definition_copy.apply
	definition_copy.frames = frames
	definition_copy.apply = function(target, frame_value, params, payload)
		target:apply_animation_frame(frame_value)
		if user_apply then
			user_apply(target, frame_value, params, payload)
		end
	end
	local playback_mode = definition_copy.playback_mode
	if playback_mode == nil and definition_copy.loop ~= nil then
		if definition_copy.loop then
			playback_mode = "loop"
		else
			playback_mode = "once"
		end
	end
	if playback_mode ~= nil then
		definition_copy.playback_mode = playback_mode
	end
	local instance = timeline_module.timeline.new(definition_copy)
	self.animations[definition_copy.id] = definition_copy
	self:define_timeline(instance)
	return definition_copy
end

function spriteobject:define_animations(definitions)
	for i = 1, #definitions do
		self:define_animation(definitions[i])
	end
end

function spriteobject:draw()
	if not self.visible then
		return
	end
	local sc = self.sprite_component
	if sc.imgid == "none" then
		return
	end
	local offset = sc.offset
	put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, {
		scale = sc.scale,
		flip_h = sc.flip.flip_h,
		flip_v = sc.flip.flip_v,
		colorize = sc.colorize,
		parallax_weight = sc.parallax_weight,
	})
end

return spriteobject
