local base_component<const> = require('cartlib/component/base_component')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_program<const> = require('cartlib/timeline/program')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_sequence_evaluator<const> = require('cartlib/timeline/sequence_evaluator')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local timeline<const> = timeline_module.timeline

local timeline_component<const> = {}
timeline_component.__index = timeline_component
timeline_component.unique = true
setmetatable(timeline_component, { __index = base_component })

local tick_lane_member_by_clock_source<const> = {
	[timeline_clock_source.gameplay] = '_gameplay_tick_lane',
	[timeline_clock_source.frame] = '_frame_tick_lane',
	[timeline_clock_source.platform] = '_platform_tick_lane',
	[timeline_clock_source.audio] = '_audio_tick_lane',
}

local scheduled_timeline_count<const> = function(lane)
	return lane.count - lane.removed_count + lane.pending_count
end

local remove_timeline_schedule<const> = function(self, entry)
	local lane = entry.pending_tick_lane
	local pending_index<const> = entry.pending_tick_index
	if pending_index ~= nil then
		local pending_entries<const> = lane.pending_entries
		local pending_count<const> = lane.pending_count
		local last_entry<const> = pending_entries[pending_count]
		pending_entries[pending_count] = nil
		lane.pending_count = pending_count - 1
		entry.pending_tick_index = nil
		entry.pending_tick_lane = nil
		if pending_index < pending_count then
			pending_entries[pending_index] = last_entry
			last_entry.pending_tick_index = pending_index
		end
		if scheduled_timeline_count(lane) == 0 then
			self:set_tick_clock_enabled(lane.clock_source, false)
		end
		return
	end
	lane = entry.tick_lane
	if lane == nil then
		return
	end
	local tick_index<const> = entry.tick_index
	if lane.ticking then
		lane.removed_count = lane.removed_count + 1
		entry.tick_index = nil
		entry.tick_lane = nil
		if scheduled_timeline_count(lane) == 0 then
			self:set_tick_clock_enabled(lane.clock_source, false)
		end
		return
	end
	local tick_count<const> = lane.count
	local last_entry<const> = lane[tick_count]
	lane[tick_count] = nil
	lane.count = tick_count - 1
	entry.tick_index = nil
	entry.tick_lane = nil
	if tick_index < tick_count then
		lane[tick_index] = last_entry
		last_entry.tick_index = tick_index
	end
	if scheduled_timeline_count(lane) == 0 then
		self:set_tick_clock_enabled(lane.clock_source, false)
	end
end

-- Each playing entry is admitted directly to its program's clock lane. A
-- component may therefore own gameplay animation and an independently running
-- modal sequence without either lane inspecting the other on every frame.
local reconcile_timeline_schedule<const> = function(self, entry)
	if not entry.playing or not entry.program.auto_tick then
		remove_timeline_schedule(self, entry)
		return
	end
	local clock_source<const> = entry.program.clock_source
	local lane_member<const> = tick_lane_member_by_clock_source[clock_source]
	local lane = self[lane_member]
	if lane == nil then
		lane = {
			clock_source = clock_source,
			count = 0,
			removed_count = 0,
			pending_entries = {},
			pending_count = 0,
			ticking = false,
		}
		self[lane_member] = lane
	end
	if entry.tick_lane == lane or entry.pending_tick_lane == lane then
		return
	end
	remove_timeline_schedule(self, entry)
	if lane.ticking then
		local pending_count<const> = lane.pending_count + 1
		lane.pending_count = pending_count
		lane.pending_entries[pending_count] = entry
		entry.pending_tick_index = pending_count
		entry.pending_tick_lane = lane
	else
		local tick_count<const> = lane.count + 1
		lane.count = tick_count
		lane[tick_count] = entry
		entry.tick_index = tick_count
		entry.tick_lane = lane
	end
	if scheduled_timeline_count(lane) == 1 then
		self:set_tick_clock_enabled(clock_source, true)
	end
end

local clear_entry_state<const> = function(entry, owner)
	timeline_track_evaluator.clear_tags(entry, owner)
	timeline_sequence_evaluator.clear_entry(entry, owner)
end

local resolve_timeline_bindings<const> = function(entry, program, primary_binding, binding_overrides)
	entry.primary_binding = primary_binding
	if program.binding_count == 1 then
		entry.bindings = nil
		return
	end
	local bindings = entry.bindings
	if bindings == nil then
		bindings = {}
		entry.bindings = bindings
	end
	bindings[1] = primary_binding
	for index = 2, program.binding_count do
		bindings[index] = binding_overrides[program.binding_ids[index]]
	end
end

local finish_entry<const> = function(self, entry)
	local owner<const> = self.parent
	clear_entry_state(entry, owner)
	entry.playing = false
	reconcile_timeline_schedule(self, entry)
	local on_finished = entry.play_on_finished
	local finished_context = entry.play_finished_context
	if on_finished == nil then
		on_finished = entry.bound_on_finished
		finished_context = entry.bound_finished_context
	end
	if on_finished ~= nil then
		on_finished(owner, finished_context, entry)
	end
end

function timeline_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), timeline_component)
	self._entries_by_id = {}
	return self
end

function timeline_component:on_attach()
	self.parent.timelines = self
end

function timeline_component:on_detach()
	if self.parent.timelines == self then
		self.parent.timelines = nil
	end
end

function timeline_component:define(id, definition)
	local program = timeline_program.compile(definition)
	local entry = self._entries_by_id[id]
	if entry == nil then
		local primary_binding = program.default_binding
		if primary_binding == nil then
			primary_binding = self.parent
		end
		entry = timeline.new(id, program)
		entry.primary_binding = primary_binding
		entry.params = program.default_params
		entry.playing = false
		if program.has_evaluation_callbacks then
			entry.evaluation_context = {}
		end
		self._entries_by_id[id] = entry
		timeline_track_evaluator.init_entry(entry)
		timeline_sequence_evaluator.init_entry(entry)
		return
	end
	local previous_program<const> = entry.program
	local playing<const> = entry.playing
	if playing then
		clear_entry_state(entry, self.parent)
		remove_timeline_schedule(self, entry)
	end
	if playing and program.frame_builder ~= nil then
		program = timeline_frame_program.build(program, entry.params)
	end
	entry:rebind_program(program)
	if program.has_evaluation_callbacks then
		if entry.evaluation_context == nil then
			entry.evaluation_context = {}
		end
	else
		entry.evaluation_context = nil
	end
	if playing then
		if program.binding_count > 1 then
			local previous_bindings<const> = entry.bindings
			local bindings<const> = {}
			bindings[1] = entry.primary_binding
			for index = 2, program.binding_count do
				local previous_index<const> = previous_program.binding_index_by_id[program.binding_ids[index]]
				bindings[index] = previous_bindings[previous_index]
			end
			entry.bindings = bindings
		else
			entry.bindings = nil
		end
	else
		local primary_binding = program.default_binding
		if primary_binding == nil then
			primary_binding = self.parent
		end
		entry.primary_binding = primary_binding
		entry.bindings = nil
		entry.params = program.default_params
	end
	timeline_track_evaluator.init_entry(entry)
	timeline_sequence_evaluator.init_entry(entry)
	if playing then
		reconcile_timeline_schedule(self, entry)
		timeline_sequence_evaluator.bind_entry(entry, self.parent)
		if entry.head >= 0 then
			timeline_track_evaluator.sync_tags(
				entry,
				self.parent,
				entry.head,
				entry.position_ms
			)
			timeline_sequence_evaluator.sync_entry(
				entry,
				self.parent,
				entry.position_ms
			)
		end
	end
end

function timeline_component:get(id)
	return self._entries_by_id[id]
end

function timeline_component:seek(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry:seek(self.parent, frame)
	return entry
end

function timeline_component:seek_time(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry:seek_time(self.parent, time_ms)
	return entry
end

function timeline_component:scrub_time(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry:scrub_time(self.parent, time_ms)
	return entry
end

function timeline_component:seek_to_end(id)
	local entry<const> = self._entries_by_id[id]
	entry:seek_time(self.parent, entry.program.duration_ms)
	return entry
end

function timeline_component:advance_to(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry:advance_to(self.parent, frame)
	return entry
end

function timeline_component:advance_time_to(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry:advance_time_to(self.parent, time_ms)
	return entry
end

function timeline_component:advance(id)
	local entry<const> = self._entries_by_id[id]
	if entry:advance(self.parent) then
		finish_entry(self, entry)
	end
	return entry
end

function timeline_component:set_play_rate(id, play_rate)
	local entry<const> = self._entries_by_id[id]
	entry:set_play_rate(play_rate)
	return entry
end

-- A state binding outlives an individual play() call so manually started
-- timelines with runtime targets keep the completion owner of the active state.
-- State exit clears the binding even when playback itself is allowed to continue.
function timeline_component:bind_finished(id, on_finished, finished_context)
	local entry<const> = self._entries_by_id[id]
	entry.bound_on_finished = on_finished
	entry.bound_finished_context = finished_context
end

-- Completion is a retained playback binding, not an event-emitter message.
-- It runs only after the terminal sample has been evaluated and the entry has
-- left the active set. Loop wraps and ping-pong turns are transport boundaries,
-- not playback completion.
function timeline_component:play(id, opts, on_finished, finished_context)
	local entry<const> = self._entries_by_id[id]
	local owner<const> = self.parent
	local rewind
	local snap
	local params
	local target
	local bindings
	local play_rate = 1
	if opts ~= nil then
		rewind = opts.rewind
		snap = opts.snap_to_start
		params = opts.params
		target = opts.target
		bindings = opts.bindings
		if opts.play_rate ~= nil then
			play_rate = opts.play_rate
		end
	end
	if rewind == nil then
		rewind = true
	end
	if snap == nil then
		snap = true
	end
	local program = entry.program
	if params == nil then
		params = program.default_params
	end
	if target == nil then
		target = program.default_binding
		if target == nil then
			target = owner
		end
	end
	entry.params = params
	entry.play_on_finished = on_finished
	entry.play_finished_context = finished_context
	resolve_timeline_bindings(entry, program, target, bindings)
	if rewind or program.frame_builder ~= nil then
		clear_entry_state(entry, owner)
	end
	if program.frame_builder ~= nil then
		entry:build(params)
		program = entry.program
		timeline_track_evaluator.init_entry(entry)
		timeline_sequence_evaluator.init_entry(entry)
	end
	timeline_sequence_evaluator.bind_entry(entry, owner)
	if rewind then
		entry:rewind()
	end
	if snap and (program.length > 0 or program.continuous) then
		entry:snap_to_start(owner)
	end
	entry:set_play_rate(play_rate)
	entry.playing = true
	reconcile_timeline_schedule(self, entry)
	return entry
end

function timeline_component:stop(id)
	local entry<const> = self._entries_by_id[id]
	clear_entry_state(entry, self.parent)
	entry.playing = false
	reconcile_timeline_schedule(self, entry)
end

-- Playback completion may start another timeline on the same clock lane. The
-- replacement is admitted after the current lane traversal, just as a queued
-- animation starts at the next player update instead of consuming the delta
-- which completed its predecessor. The deferred array is retained per lane;
-- steady playback performs no allocation and keeps the direct dense loop.
local tick_lane<const> = function(self, entries, delta_time)
	local owner<const> = self.parent
	entries.ticking = true
	local count<const> = entries.count
	for index = 1, count do
		local entry<const> = entries[index]
		-- Active membership is separate from deferred admission. A callback may
		-- stop an entry that has not consumed this delta yet; its retained slot is
		-- skipped and compacted once traversal has finished.
		if entry.tick_lane == entries then
			if entry:update(owner, delta_time) then
				finish_entry(self, entry)
			end
		end
	end
	entries.ticking = false
	if entries.removed_count ~= 0 then
		local write_index = 1
		for read_index = 1, count do
			local entry<const> = entries[read_index]
			if entry.tick_lane == entries then
				entries[write_index] = entry
				entry.tick_index = write_index
				write_index = write_index + 1
			end
		end
		for clear_index = write_index, count do
			entries[clear_index] = nil
		end
		entries.count = write_index - 1
		entries.removed_count = 0
	end
	local pending_count<const> = entries.pending_count
	if pending_count == 0 then
		return
	end
	local pending_entries<const> = entries.pending_entries
	local active_count<const> = entries.count
	for pending_index = 1, pending_count do
		local entry<const> = pending_entries[pending_index]
		local tick_index<const> = active_count + pending_index
		entries[tick_index] = entry
		entry.tick_index = tick_index
		entry.pending_tick_index = nil
		entry.pending_tick_lane = nil
		entry.tick_lane = entries
		pending_entries[pending_index] = nil
	end
	entries.count = active_count + pending_count
	entries.pending_count = 0
end

function timeline_component:tick_gameplay(delta_time)
	tick_lane(self, self._gameplay_tick_lane, delta_time)
end

function timeline_component:tick_frame(delta_time)
	tick_lane(self, self._frame_tick_lane, delta_time)
end

function timeline_component:tick_platform(delta_time)
	tick_lane(self, self._platform_tick_lane, delta_time)
end

function timeline_component:tick_audio(delta_time)
	tick_lane(self, self._audio_tick_lane, delta_time)
end

return timeline_component
