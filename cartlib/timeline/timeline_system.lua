-- Every playback belongs to one complete phase. External clocks are sampled
-- once before physics; late programs consume the same retained scalar delta.
local apu<const> = require('cartlib/apu')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local timeline_system<const> = {}
timeline_system.__index = timeline_system
setmetatable(timeline_system, { __index = base_system })
timeline_system.physical_gameplay_tick = {
	group = tick_group.prephysics, priority = 0, clock_source = clock.gameplay, method = 'update_physical',
}
timeline_system.physical_frame_tick = {
	group = tick_group.prephysics, priority = 0, clock_source = clock.frame, method = 'update_frame_physical',
}
timeline_system.gameplay_tick = {
	group = tick_group.animation, priority = 0, clock_source = clock.gameplay, method = 'update',
}
timeline_system.frame_tick = {
	group = tick_group.animation, priority = 0, clock_source = clock.frame, method = 'update_frame',
}

function timeline_system.new(world)
	local self<const> = setmetatable(base_system.new(timeline_system.physical_gameplay_tick), timeline_system)
	self:add_tick_function(timeline_system.physical_frame_tick)
	self:add_tick_function(timeline_system.gameplay_tick)
	self:add_tick_function(timeline_system.frame_tick)
	self._world = world
	self._gameplay_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.gameplay)
	self._frame_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.frame)
	self._platform_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.platform)
	self._audio_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.audio)
	self._physical_gameplay_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.physical[timeline_clock_source.gameplay])
	self._physical_frame_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.physical[timeline_clock_source.frame])
	self._physical_platform_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.physical[timeline_clock_source.platform])
	self._physical_audio_tick_view = world:active_tick_view(timeline_component, timeline_clock_source.physical[timeline_clock_source.audio])
	return self
end

function timeline_system:update_physical(delta_time)
	local revision<const> = self._world._update_revision
	local components<const> = self._physical_gameplay_tick_view.components
	for index = 1, #components do components[index]:tick_gameplay_physical(delta_time, revision) end
end

function timeline_system:update(delta_time)
	local revision<const> = self._world._update_revision
	local components<const> = self._gameplay_tick_view.components
	for index = 1, #components do components[index]:tick_gameplay_presentation(delta_time, revision) end
end

function timeline_system:update_frame_physical(delta_time)
	local revision<const> = self._world._update_revision
	local components<const> = self._physical_frame_tick_view.components
	for index = 1, #components do components[index]:tick_frame_physical(delta_time, revision) end
	local space<const> = self._world._active_space
	local platform<const> = self._physical_platform_tick_view.components
	local presentation_platform<const> = self._platform_tick_view.components
	self._platform_sample_revision = nil
	if #platform + #presentation_platform > 0 then
		self._platform_sample = clock.milliseconds()
		self._platform_sample_revision = revision
	end
	if #presentation_platform == 0 then self._presentation_platform_time = nil end
	if #platform == 0 then
		self._physical_platform_time = nil
	else
		local current<const> = self._platform_sample
		local previous<const> = self._physical_platform_time
		local previous_space<const> = self._physical_platform_space
		self._physical_platform_time = current
		self._physical_platform_space = space
		if previous ~= nil and previous_space == space and current ~= previous then
			local delta<const> = clock.elapsed_milliseconds(previous, current)
			for index = 1, #platform do platform[index]:tick_platform_physical(delta, revision) end
		end
	end
	local audio<const> = self._physical_audio_tick_view.components
	local presentation_audio<const> = self._audio_tick_view.components
	self._audio_sample_revision = nil
	if #audio + #presentation_audio > 0 then
		self._audio_sample = apu.sample_sequence()
		self._audio_sample_revision = revision
	end
	if #presentation_audio == 0 then self._presentation_audio_sample = nil end
	if #audio == 0 then
		self._physical_audio_sample = nil
	else
		local current<const> = self._audio_sample
		local previous<const> = self._physical_audio_sample
		local previous_space<const> = self._physical_audio_space
		self._physical_audio_sample = current
		self._physical_audio_space = space
		if previous ~= nil and previous_space == space and current ~= previous then
			local delta<const> = apu.elapsed_milliseconds(previous, current)
			for index = 1, #audio do audio[index]:tick_audio_physical(delta, revision) end
		end
	end
end

function timeline_system:update_frame(delta_time)
	local revision<const> = self._world._update_revision
	local components<const> = self._frame_tick_view.components
	for index = 1, #components do components[index]:tick_frame_presentation(delta_time, revision) end
	local space<const> = self._world._active_space
	local platform<const> = self._platform_tick_view.components
	if #platform == 0 then
		self._presentation_platform_time = nil
	elseif self._platform_sample_revision == revision then
		local current<const> = self._platform_sample
		local previous<const> = self._presentation_platform_time
		local previous_space<const> = self._presentation_platform_space
		self._presentation_platform_time = current
		self._presentation_platform_space = space
		if previous ~= nil and previous_space == space and current ~= previous then
			local delta<const> = clock.elapsed_milliseconds(previous, current)
			for index = 1, #platform do platform[index]:tick_platform_presentation(delta, revision) end
		end
	end
	local audio<const> = self._audio_tick_view.components
	if #audio == 0 then
		self._presentation_audio_sample = nil
	elseif self._audio_sample_revision == revision then
		local current<const> = self._audio_sample
		local previous<const> = self._presentation_audio_sample
		local previous_space<const> = self._presentation_audio_space
		self._presentation_audio_sample = current
		self._presentation_audio_space = space
		if previous ~= nil and previous_space == space and current ~= previous then
			local delta<const> = apu.elapsed_milliseconds(previous, current)
			for index = 1, #audio do audio[index]:tick_audio_presentation(delta, revision) end
		end
	end
end

return timeline_system
