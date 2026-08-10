local basecomponent<const> = require('cartlib/component/basecomponent')
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

local process_timelineframe_payload<const> = function(_, entry, owner, payload)
	local target<const> = entry.target or owner
	local track_runner<const> = entry.instance.compiled_track_runner
	if track_runner ~= nil then
		track_runner(target, entry.params, payload)
	end
	local apply_function<const> = entry.apply_function
	if apply_function ~= nil then
		apply_function(target, payload.frame_value, entry.params, payload)
	end
	local frame_appliers<const> = entry.frame_appliers
	if frame_appliers ~= nil then
		frame_appliers[payload.frame_index + 1](target, payload.frame_value)
	end
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
	local replacement<const> = timeline.new(definition)
	local entry = self._entries_by_id[replacement.id]
	local instance = replacement
	local active = false
	if entry ~= nil then
		active = self._active_index_by_id[replacement.id] ~= nil
		if active and replacement.frame_builder then
			replacement:build(entry.params)
		end
		instance = entry.instance
		instance:rebind_definition(replacement)
	else
		entry = {
			instance = instance,
			target = instance.def.target,
			params = instance.def.params,
		}
		self._entries_by_id[instance.id] = entry
	end
	local markers<const> = timelinemodule.compile_timelinemarkers(instance.def, instance.length)
	local apply<const> = instance.def.apply
	local apply_function
	local frame_appliers
	if type(apply) == 'function' then
		apply_function = apply
	elseif apply then
		frame_appliers = instance.frame_appliers
	end
	entry.markers = markers
	entry.apply_function = apply_function
	entry.frame_appliers = frame_appliers
	if not active then
		entry.target = instance.def.target
		entry.params = instance.def.params
	end
	timelinedispatch.init_entry(entry)
end

function timelinecomponent:get(id)
	local entry<const> = self._entries_by_id[id]
	return entry and entry.instance
end

function timelinecomponent:seek(id, frame)
	local entry<const> = self._entries_by_id[id]
	local instance<const> = entry.instance
	if instance:seek(frame) ~= nil then
		if timelinedispatch.process_instance_events(entry, self.parent, 0, process_timelineframe_payload) then
			deactivate_timelineentry(self, instance.id)
		end
	end
	return instance
end

function timelinecomponent:advance(id)
	local entry<const> = self._entries_by_id[id]
	local instance<const> = entry.instance
	if instance:advance() ~= nil then
		if timelinedispatch.process_instance_events(entry, self.parent, 0, process_timelineframe_payload) then
			deactivate_timelineentry(self, instance.id)
		end
	end
	return instance
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
		entry.frame_appliers = instance.frame_appliers
		entry.markers = timelinemodule.compile_timelinemarkers(instance.def, instance.length)
	end
	timelinedispatch.init_entry(entry)
	if rewind then
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		if instance:snap_to_start() ~= nil then
			if timelinedispatch.process_instance_events(entry, owner, 0, process_timelineframe_payload) then
				deactivate_timelineentry(self, id)
			end
		end
	end
	activate_timelineentry(self, entry)
	return instance
end

function timelinecomponent:stop(id)
	local entry<const> = self._entries_by_id[id]
	local owner<const> = self.parent
	local controlled<const> = entry.markers.controlled_tags
	for i = 1, #controlled do
		owner:remove_tag(controlled[i])
	end
	deactivate_timelineentry(self, id)
end

function timelinecomponent:tick_active(delta_time)
	local index = 1
	while index <= self._active_count do
		local entry<const> = self._active_entries[index]
		if entry.instance:update(delta_time) ~= nil then
			if timelinedispatch.process_instance_events(entry, self.parent, delta_time, process_timelineframe_payload) then
				deactivate_timelineentry(self, entry.instance.id)
			else
				index = index + 1
			end
		else
			index = index + 1
		end
	end
end

return timelinecomponent
