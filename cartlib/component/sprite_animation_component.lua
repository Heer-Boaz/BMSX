local clock<const> = require('cartlib/clock')
local image<const> = require('cartlib/gx/image')
local sprite_component<const> = require('cartlib/component/sprite_component')

local sprite_animation_component<const> = {}
sprite_animation_component.__index = sprite_animation_component
setmetatable(sprite_animation_component, { __index = sprite_component })

-- Frame runs are authored in gameplay-animation beats, matching the retained
-- clock lane that advances this component. Absolute millisecond durations are
-- reserved for animations whose rate is independent of that beat. The factory
-- resolves either form once; instances and the animation system retain one
-- direct millisecond datapath.
function sprite_animation_component.factory(definition)
	local update_milliseconds<const> = clock.update_milliseconds()
	local animation_definitions<const> = definition.animations
	if animation_definitions == nil then
		-- Single-sequence sprites retain the original compact instance shape.
		-- Named selection is compiled into the other factory below, never into
		-- the animation system's per-component update path.
		local frames<const> = definition.frames
		local frame_count<const> = #frames
		local frame_sources<const> = {}
		for frame_index = 1, frame_count do
			frame_sources[frame_index] = image.resolve(frames[frame_index])
		end
		local frame_duration_ms = definition.frame_duration_ms
		if frame_duration_ms == nil then
			frame_duration_ms = (definition.frame_run or 1) * update_milliseconds
		end
		local loop<const> = definition.loop
		local id_local<const> = definition.id_local
		local offset_x<const> = definition.offset_x or 0
		local offset_y<const> = definition.offset_y or 0
		local offset_z<const> = definition.offset_z or 0
		local enabled<const> = definition.enabled
		return function(opts)
			local self<const> = setmetatable(sprite_component.new(opts), sprite_animation_component)
			self.id_local = id_local
			self.offset_x = offset_x
			self.offset_y = offset_y
			self.offset_z = offset_z
			if enabled ~= nil then
				self.enabled = enabled
			end
			self.frames = frames
			self.frame_sources = frame_sources
			self.frame_count = frame_count
			self.frame_duration_ms = frame_duration_ms
			self.loop = loop
			self.frame_index = 1
			self.elapsed_ms = 0
			self:_set_resolved_imgid(frames[1], frame_sources[1])
			self:set_tick_clock_enabled(clock.gameplay, true)
			return self
		end
	end

	local animations<const> = {}
	for name, animation_definition in pairs(animation_definitions) do
		local frames<const> = animation_definition.frames
		local frame_count<const> = #frames
		local frame_sources<const> = {}
		for frame_index = 1, frame_count do
			frame_sources[frame_index] = image.resolve(frames[frame_index])
		end
		local frame_duration_ms = animation_definition.frame_duration_ms
		if frame_duration_ms == nil then
			frame_duration_ms = (animation_definition.frame_run or 1) * update_milliseconds
		end
		animations[name] = {
			frames = frames,
			frame_sources = frame_sources,
			frame_count = frame_count,
			frame_duration_ms = frame_duration_ms,
			loop = animation_definition.loop,
		}
	end
	local initial_animation_name<const> = definition.animation
	local initial_animation<const> = animations[initial_animation_name]
	local id_local<const> = definition.id_local
	local offset_x<const> = definition.offset_x or 0
	local offset_y<const> = definition.offset_y or 0
	local offset_z<const> = definition.offset_z or 0
	local enabled<const> = definition.enabled
	return function(opts)
		local self<const> = setmetatable(sprite_component.new(opts), sprite_animation_component)
		self.id_local = id_local
		self.animations = animations
		self.animation = initial_animation_name
		self.offset_x = offset_x
		self.offset_y = offset_y
		self.offset_z = offset_z
		if enabled ~= nil then
			self.enabled = enabled
		end
		self.frames = initial_animation.frames
		self.frame_sources = initial_animation.frame_sources
		self.frame_count = initial_animation.frame_count
		self.frame_duration_ms = initial_animation.frame_duration_ms
		self.loop = initial_animation.loop
		self.frame_index = 1
		self.elapsed_ms = 0
		self:_set_resolved_imgid(
			initial_animation.frames[1],
			initial_animation.frame_sources[1]
		)
		self:set_tick_clock_enabled(clock.gameplay, true)
		return self
	end
end

-- Animation selection resolves one retained sequence at the state boundary.
-- The animation system consumes direct frame fields and performs no name
-- lookup or mode dispatch on its per-component update path.
function sprite_animation_component:set_animation(name)
	if self.animation ~= name then
		local animation<const> = self.animations[name]
		self.animation = name
		self.frames = animation.frames
		self.frame_sources = animation.frame_sources
		self.frame_count = animation.frame_count
		self.frame_duration_ms = animation.frame_duration_ms
		self.loop = animation.loop
		self.frame_index = 1
		self.elapsed_ms = 0
		self:_set_resolved_imgid(animation.frames[1], animation.frame_sources[1])
	end
	return self
end

-- Positions the retained sequence once at an authored playback time. Looping
-- sequences wrap at their duration; one-shot callers provide a position inside
-- the authored sequence. The animation system can then continue from the
-- direct frame fields without a clock-mode branch in its update loop.
function sprite_animation_component:set_playback_position(time_ms)
	local frame_duration_ms<const> = self.frame_duration_ms
	local position_ms = time_ms
	if self.loop then
		position_ms = position_ms % (self.frame_count * frame_duration_ms)
	end
	local frame_index<const> = position_ms // frame_duration_ms + 1
	self.frame_index = frame_index
	self.elapsed_ms = position_ms - (frame_index - 1) * frame_duration_ms
	self:_set_resolved_imgid(self.frames[frame_index], self.frame_sources[frame_index])
	return self
end

-- Activation restarts the animation and admits this visual to both the
-- retained render set and gameplay animation lane. Deactivation removes it
-- from both sets; there is no dormant render entry or per-frame playing test.
function sprite_animation_component:activate()
	self.frame_index = 1
	self.elapsed_ms = 0
	self:_set_resolved_imgid(self.frames[1], self.frame_sources[1])
	self:set_enabled(true)
end

function sprite_animation_component:deactivate()
	self:set_enabled(false)
end

return sprite_animation_component
