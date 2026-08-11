local basecomponent<const> = require('cartlib/component/basecomponent')
local timelineprogram<const> = require('cartlib/timeline/program')
local timelinemodule<const> = require('cartlib/timeline/timeline')
local timelinedispatch<const> = require('cartlib/timeline/dispatch')
local timeline<const> = timelinemodule.timeline

local timelinecomponent<const> = {}
timelinecomponent.__index = timelinecomponent
timelinecomponent.unique = true
setmetatable(timelinecomponent, { __index = basecomponent })

local activate_timelineentry<const> = function(self, entry)
	local id<const> = entry.instance.id
	if self._active_index_by_id[id] ~= nil then
		return
	end
	local count<const> = self._active_count + 1
	self._active_count = count
	self._active_entries[count] = entry
	self._active_index_by_id[id] = count
end

local deactivate_timelineentry<const> = function(self, id)
	local index<const> = self._active_index_by_id[id]
	if index == nil then
		return
	end
	local last_index<const> = self._active_count
	local last_entry<const> = self._active_entries[last_index]
	self._active_entries[last_index] = nil
	self._active_count = last_index - 1
	self._active_index_by_id[id] = nil
	if index < last_index then
		self._active_entries[index] = last_entry
		self._active_index_by_id[last_entry.instance.id] = index
	end
end

local process_timelineframe_payload<const> = function(_, entry, _owner, payload)
	local target<const> = entry.target
	local program<const> = entry.instance.program
	local track_runner<const> = program.track_runner
	if track_runner ~= nil then
		track_runner(target, entry.params, payload, payload.time_ms * 0.001)
	end
	local apply_function<const> = program.apply_function
	if apply_function ~= nil then
		apply_function(target, payload.frame_value, entry.params, payload)
	end
	local frame_appliers<const> = program.frame_appliers
	if frame_appliers ~= nil then
		frame_appliers[payload.frame_index + 1](target, payload.frame_value)
	end
end

local process_evaluations<const> = function(self, entry, delta_time)
	local stopped<const> = timelinedispatch.process_instance_evaluations(
		entry,
		self.parent,
		delta_time,
		process_timelineframe_payload
	)
	if stopped then
		deactivate_timelineentry(self, entry.instance.id)
	end
	return stopped
end

function timelinecomponent.new(opts)
	local self<const> = setmetatable(basecomponent.new(opts), timelinecomponent)
	self._entries_by_id = {}
	self._active_entries = {}
	self._active_count = 0
	self._active_index_by_id = {}
	return self
end

function timelinecomponent:on_attach()
	self.parent.timelines = self
end

function timelinecomponent:on_detach()
	if self.parent.timelines == self then
		self.parent.timelines = nil
	end
end

function timelinecomponent:define(definition)
	local program = timelineprogram.compile(definition)
	local entry = self._entries_by_id[program.id]
	if entry == nil then
		local instance<const> = timeline.new(program)
		local target = program.default_target
		if target == nil then
			target = self.parent
		end
		entry = {
			instance = instance,
			target = target,
			params = program.default_params,
		}
		self._entries_by_id[program.id] = entry
		timelinedispatch.init_entry(entry)
		return
	end
	local active<const> = self._active_index_by_id[program.id] ~= nil
	if active then
		timelinedispatch.clear_windows(entry, self.parent)
	end
	if active and program.frame_builder ~= nil then
		program = timelineprogram.build(program, entry.params)
	end
	entry.instance:rebind_program(program)
	if not active then
		local target = program.default_target
		if target == nil then
			target = self.parent
		end
		entry.target = target
		entry.params = program.default_params
	end
	timelinedispatch.init_entry(entry)
	if active and entry.instance.head >= 0 then
		timelinedispatch.sync_windows(entry, self.parent, entry.instance.head)
	end
end

function timelinecomponent:get(id)
	local entry<const> = self._entries_by_id[id]
	return entry and entry.instance
end

function timelinecomponent:seek(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry.instance:seek(frame)
	process_evaluations(self, entry, 0)
	return entry.instance
end

function timelinecomponent:advance_to(id, frame)
	local entry<const> = self._entries_by_id[id]
	entry.instance:advance_to(frame)
	process_evaluations(self, entry, 0)
	return entry.instance
end

function timelinecomponent:advance(id)
	local entry<const> = self._entries_by_id[id]
	if entry.instance:advance() ~= nil then
		process_evaluations(self, entry, 0)
	end
	return entry.instance
end

function timelinecomponent:play(id, opts)
	local entry<const> = self._entries_by_id[id]
	local instance<const> = entry.instance
	local owner<const> = self.parent
	local rewind
	local snap
	local params
	local target
	if opts ~= nil then
		rewind = opts.rewind
		snap = opts.snap_to_start
		params = opts.params
		target = opts.target
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
		target = program.default_target
		if target == nil then
			target = owner
		end
	end
	entry.params = params
	entry.target = target
	if rewind or program.frame_builder ~= nil then
		timelinedispatch.clear_windows(entry, owner)
	end
	if program.frame_builder ~= nil then
		instance:build(params)
		program = instance.program
		timelinedispatch.init_entry(entry)
	end
	if rewind then
		instance:rewind()
	end
	if snap and program.length > 0 then
		instance:snap_to_start()
		process_evaluations(self, entry, 0)
	end
	activate_timelineentry(self, entry)
	return instance
end

function timelinecomponent:stop(id)
	local entry<const> = self._entries_by_id[id]
	timelinedispatch.clear_windows(entry, self.parent)
	deactivate_timelineentry(self, id)
end

function timelinecomponent:tick_active(delta_time)
	local index = 1
	while index <= self._active_count do
		local entry<const> = self._active_entries[index]
		if entry.instance:update(delta_time) ~= nil then
			if not process_evaluations(self, entry, delta_time) then
				index = index + 1
			end
		else
			index = index + 1
		end
	end
end

return timelinecomponent
