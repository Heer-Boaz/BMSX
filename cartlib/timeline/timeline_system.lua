-- timeline_system.lua
-- Timeline ECS system.

local apu<const> = require('cartlib/apu')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')

local timeline_system<const> = {}
timeline_system.__index = timeline_system
setmetatable(timeline_system, { __index = base_system })
timeline_system.gameplay_tick = {
	group = tick_group.animation,
	priority = 0,
	clock_source = clock.gameplay,
	method = 'update',
}
timeline_system.frame_tick = {
	group = tick_group.animation,
	priority = 0,
	clock_source = clock.frame,
	method = 'update_frame',
}

function timeline_system.new(world)
	local self<const> = setmetatable(base_system.new(timeline_system.gameplay_tick), timeline_system)
	self:add_tick_function(timeline_system.frame_tick)
	self._gameplay_tick_view = world:active_tick_view(
		timeline_component,
		timeline_clock_source.gameplay
	)
	self._frame_tick_view = world:active_tick_view(
		timeline_component,
		timeline_clock_source.frame
	)
	self._platform_tick_view = world:active_tick_view(
		timeline_component,
		timeline_clock_source.platform
	)
	self._audio_tick_view = world:active_tick_view(
		timeline_component,
		timeline_clock_source.audio
	)
	self._platform_time_ms = nil
	self._audio_sample = nil
	return self
end

function timeline_system:update(delta_time)
	local components<const> = self._gameplay_tick_view.components
	for i = 1, #components do
		components[i]:tick_gameplay(delta_time)
	end
end

function timeline_system:update_frame(delta_time)
	local components<const> = self._frame_tick_view.components
	for i = 1, #components do
		components[i]:tick_frame(delta_time)
	end

	local platform_components<const> = self._platform_tick_view.components
	if #platform_components == 0 then
		self._platform_time_ms = nil
	else
		local current_time_ms<const> = clock.milliseconds()
		local previous_time_ms<const> = self._platform_time_ms
		self._platform_time_ms = current_time_ms
		if previous_time_ms ~= nil and current_time_ms ~= previous_time_ms then
			local platform_delta<const> = clock.elapsed_milliseconds(
				previous_time_ms,
				current_time_ms
			)
			for i = 1, #platform_components do
				platform_components[i]:tick_platform(platform_delta)
			end
		end
	end

	local audio_components<const> = self._audio_tick_view.components
	if #audio_components == 0 then
		self._audio_sample = nil
	else
		local current_sample<const> = apu.sample_sequence()
		local previous_sample<const> = self._audio_sample
		self._audio_sample = current_sample
		if previous_sample ~= nil and current_sample ~= previous_sample then
			local audio_delta<const> = apu.elapsed_milliseconds(previous_sample, current_sample)
			for i = 1, #audio_components do
				audio_components[i]:tick_audio(audio_delta)
			end
		end
	end
end

return timeline_system
