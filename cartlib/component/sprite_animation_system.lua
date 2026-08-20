local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local tick_group<const> = require('cartlib/world/tick_group')

local sprite_animation_system<const> = {}
sprite_animation_system.__index = sprite_animation_system
setmetatable(sprite_animation_system, { __index = base_system })
sprite_animation_system.tick = {
	group = tick_group.animation,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}

function sprite_animation_system.new(world)
	local self<const> = setmetatable(base_system.new(sprite_animation_system.tick), sprite_animation_system)
	self._component_view = world:active_tick_view(sprite_animation_component, clock.gameplay)
	return self
end

function sprite_animation_system:update(delta_time)
	local components<const> = self._component_view.components
	for component_index = 1, #components do
		local component<const> = components[component_index]
		local elapsed<const> = component.elapsed_ms + delta_time
		local frame_duration<const> = component.frame_duration_ms
		local elapsed_frames<const> = elapsed // frame_duration
		if elapsed_frames == 0 then
			component.elapsed_ms = elapsed
		else
			component.elapsed_ms = elapsed - elapsed_frames * frame_duration
			local frame_index = component.frame_index + elapsed_frames
			if frame_index > component.frame_count then
				if component.loop then
					frame_index = ((frame_index - 1) % component.frame_count) + 1
				else
					frame_index = component.frame_count
					component:deactivate()
				end
			end
			component.frame_index = frame_index
			component:_set_resolved_imgid(
				component.frames[frame_index],
				component.frame_sources[frame_index]
			)
		end
	end
end

return sprite_animation_system
