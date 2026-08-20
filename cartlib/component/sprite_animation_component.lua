local clock<const> = require('cartlib/clock')
local image<const> = require('cartlib/gx/image')
local sprite_component<const> = require('cartlib/component/sprite_component')

local sprite_animation_component<const> = {}
sprite_animation_component.__index = sprite_animation_component
setmetatable(sprite_animation_component, { __index = sprite_component })

function sprite_animation_component.factory(definition)
	local frames<const> = definition.frames
	local frame_count<const> = #frames
	local frame_sources<const> = {}
	for frame_index = 1, frame_count do
		frame_sources[frame_index] = image.resolve(frames[frame_index])
	end
	local frame_duration_ms<const> = definition.frame_duration_ms
	local loop<const> = definition.loop
	local id_local<const> = definition.id_local
	local offset_x<const> = definition.offset_x
	local offset_y<const> = definition.offset_y
	local offset_z<const> = definition.offset_z
	local enabled<const> = definition.enabled
	return function(opts)
		local self<const> = setmetatable(sprite_component.new(opts), sprite_animation_component)
		self.id_local = id_local
		self.frames = frames
		self.frame_sources = frame_sources
		self.frame_count = frame_count
		self.frame_duration_ms = frame_duration_ms
		self.loop = loop
		self.frame_index = 1
		self.elapsed_ms = 0
		self.offset_x = offset_x
		self.offset_y = offset_y
		self.offset_z = offset_z
		self.enabled = enabled
		self:_set_resolved_imgid(frames[1], frame_sources[1])
		self:set_tick_clock_enabled(clock.gameplay, true)
		return self
	end
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
