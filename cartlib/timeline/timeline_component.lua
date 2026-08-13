local base_component<const> = require('cartlib/component/base_component')
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

local reconcile_timeline_schedule<const> = function(self, entry)
	local tick_index<const> = entry.tick_index
	if entry.playing and entry.instance.program.auto_tick then
		if tick_index ~= nil then
			return
		end
		local tick_count<const> = self._tick_count + 1
		self._tick_count = tick_count
		self._tick_entries[tick_count] = entry
		entry.tick_index = tick_count
		return
	end
	if tick_index == nil then
		return
	end
	local tick_count<const> = self._tick_count
	local last_entry<const> = self._tick_entries[tick_count]
	self._tick_entries[tick_count] = nil
	self._tick_count = tick_count - 1
	entry.tick_index = nil
	if tick_index < tick_count then
		self._tick_entries[tick_index] = last_entry
		last_entry.tick_index = tick_index
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
	local instance<const> = entry.instance
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
		on_finished(owner, finished_context, instance)
	end
end

function timeline_component.new(opts)
	local self<const> = setmetatable(base_component.new(opts), timeline_component)
	self._entries_by_id = {}
	self._tick_entries = {}
	self._tick_count = 0
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
		local instance<const> = timeline.new(id, program)
		local primary_binding = program.default_binding
		if primary_binding == nil then
			primary_binding = self.parent
		end
		entry = {
			instance = instance,
			primary_binding = primary_binding,
			params = program.default_params,
			playing = false,
		}
		if program.has_evaluation_callbacks then
			entry.evaluation_context = {}
		end
		self._entries_by_id[id] = entry
		timeline_track_evaluator.init_entry(entry)
		timeline_sequence_evaluator.init_entry(entry)
		return
	end
	local previous_program<const> = entry.instance.program
	local playing<const> = entry.playing
	if playing then
		clear_entry_state(entry, self.parent)
	end
	if playing and program.frame_builder ~= nil then
		program = timeline_frame_program.build(program, entry.params)
	end
	entry.instance:rebind_program(program)
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
		if entry.instance.head >= 0 then
			timeline_track_evaluator.sync_tags(
				entry,
				self.parent,
				entry.instance.head,
				entry.instance.position_ms
			)
			timeline_sequence_evaluator.sync_entry(
				entry,
				self.parent,
				entry.instance.position_ms
			)
		end
	end
end

function timeline_component:get(id)
	local entry<const> = self._entries_by_id[id]
	return entry and entry.instance
end

function timeline_component:seek(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry.instance:seek(entry, self.parent, frame)
	return entry.instance
end

function timeline_component:seek_time(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry.instance:seek_time(entry, self.parent, time_ms)
	return entry.instance
end

function timeline_component:scrub_time(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry.instance:scrub_time(entry, self.parent, time_ms)
	return entry.instance
end

function timeline_component:seek_to_end(id)
	local entry<const> = self._entries_by_id[id]
	entry.instance:seek_time(entry, self.parent, entry.instance.program.duration_ms)
	return entry.instance
end

function timeline_component:advance_to(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry.instance:advance_to(entry, self.parent, frame)
	return entry.instance
end

function timeline_component:advance_time_to(id, time_ms)
	local entry<const> = self._entries_by_id[id]
	entry.instance:advance_time_to(entry, self.parent, time_ms)
	return entry.instance
end

function timeline_component:advance(id)
	local entry<const> = self._entries_by_id[id]
	if entry.instance:advance(entry, self.parent) then
		finish_entry(self, entry)
	end
	return entry.instance
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
	local instance<const> = entry.instance
	local owner<const> = self.parent
	local rewind
	local snap
	local params
	local target
	local bindings
	if opts ~= nil then
		rewind = opts.rewind
		snap = opts.snap_to_start
		params = opts.params
		target = opts.target
		bindings = opts.bindings
	end
	if rewind == nil then
		rewind = true
	end
	if snap == nil then
		snap = true
	end
	local program = instance.program
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
		instance:build(params)
		program = instance.program
		timeline_track_evaluator.init_entry(entry)
		timeline_sequence_evaluator.init_entry(entry)
	end
	timeline_sequence_evaluator.bind_entry(entry, owner)
	if rewind then
		instance:rewind()
	end
	if snap and (program.length > 0 or program.continuous) then
		instance:snap_to_start(entry, owner)
	end
	entry.playing = true
	reconcile_timeline_schedule(self, entry)
	return instance
end

function timeline_component:stop(id)
	local entry<const> = self._entries_by_id[id]
	clear_entry_state(entry, self.parent)
	entry.playing = false
	reconcile_timeline_schedule(self, entry)
end

function timeline_component:tick_active(delta_time)
	local entries<const> = self._tick_entries
	local owner<const> = self.parent
	local count = self._tick_count
	local index = 1
	while index <= count do
		local entry<const> = entries[index]
		if entry.instance:update(entry, owner, delta_time) then
			finish_entry(self, entry)
			count = self._tick_count
		else
			index = index + 1
		end
	end
end

return timeline_component
