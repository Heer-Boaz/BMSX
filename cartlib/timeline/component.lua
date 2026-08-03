local component<const> = require('cartlib/world/component')
local component_types<const> = require('cartlib/components/types')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_dispatch<const> = require('cartlib/timeline/dispatch')
local timeline<const> = timeline_module.timeline

local timelinecomponent<const> = {}
timelinecomponent.__index = timelinecomponent
setmetatable(timelinecomponent, { __index = component })

local activate_timeline_entry<const> = function(self, entry)
	local id<const> = entry.instance.id
	if self.active_index_by_id[id] ~= nil then
		return
	end
	local count<const> = self.active_count + 1
	self.active_count = count
	self.active_entries[count] = entry
	self.active_index_by_id[id] = count
end

local deactivate_timeline_entry<const> = function(self, id)
	local index<const> = self.active_index_by_id[id]
	if index == nil then
		return
	end
	local last_index<const> = self.active_count
	local last_entry<const> = self.active_entries[last_index]
	self.active_entries[last_index] = nil
	self.active_count = last_index - 1
	self.active_index_by_id[id] = nil
	if index < last_index then
		self.active_entries[index] = last_entry
		self.active_index_by_id[last_entry.instance.id] = index
	end
end

local process_timeline_frame_payload<const> = function(_, entry, owner, payload)
	local target<const> = entry.target or owner
	local track_runner<const> = entry.instance.compiled_track_runner
	if track_runner ~= nil then
		track_runner(target, entry.params, payload)
	end
	local apply_function<const> = entry.apply_function
	if apply_function ~= nil then
		apply_function(target, payload.frame_value, entry.params, payload)
	end
	local compiled_apply_frames<const> = entry.compiled_apply_frames
	if compiled_apply_frames ~= nil then
		compiled_apply_frames[payload.frame_index + 1](target, payload.frame_value)
	end
end

function timelinecomponent.new(opts)
	local self<const> = setmetatable(component.new(opts, component_types.timeline, true), timelinecomponent)
	self.registry = {}
	self.active_entries = {}
	self.active_count = 0
	self.active_index_by_id = {}
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
	local replacement<const> = definition.__is_timeline and definition or timeline.new(definition)
	local entry = self.registry[replacement.id]
	local instance = replacement
	local active = false
	if entry ~= nil then
		active = self.active_index_by_id[replacement.id] ~= nil
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
		self.registry[instance.id] = entry
	end
	local markers<const> = timeline_module.compile_timeline_markers(instance.def, instance.length)
	local apply_function
	local compiled_apply_frames
	if type(instance.def.apply) == 'function' then
		apply_function = instance.def.apply
	else
		compiled_apply_frames = instance.compiled_apply_frames
	end
	entry.markers = markers
	entry.apply_function = apply_function
	entry.compiled_apply_frames = compiled_apply_frames
	if not active then
		entry.target = instance.def.target
		entry.params = instance.def.params
	end
	timeline_dispatch.init_entry(entry)
end

function timelinecomponent:get(id)
	local entry<const> = self.registry[id]
	return entry and entry.instance
end

function timelinecomponent:seek(id, frame)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
	entry.instance:force_seek(frame)
	return entry.instance
end

function timelinecomponent:advance(id)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
	local instance<const> = entry.instance
	if instance:advance() ~= nil then
		if timeline_dispatch.process_instance_events(entry, self.parent, 0, process_timeline_frame_payload) then
			deactivate_timeline_entry(self, instance.id)
		end
	end
	return instance
end

function timelinecomponent:play(id, opts)
	local entry<const> = self.registry[id]
	if not entry then
		error('[timelinecomponent] unknown timeline "' .. id .. '" on "' .. self.parent.id .. '"')
	end
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
		entry.compiled_apply_frames = instance.compiled_apply_frames
		entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
	end
	timeline_dispatch.init_entry(entry)
	if rewind then
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		if instance:snap_to_start() ~= nil then
			if timeline_dispatch.process_instance_events(entry, owner, 0, process_timeline_frame_payload) then
				deactivate_timeline_entry(self, id)
			end
		end
	end
	activate_timeline_entry(self, entry)
	return instance
end

function timelinecomponent:stop(id)
	local entry<const> = self.registry[id]
	if entry then
		local owner<const> = self.parent
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
	end
	deactivate_timeline_entry(self, id)
end

function timelinecomponent:tick_active(dt_ms)
	local index = 1
	while index <= self.active_count do
		local entry<const> = self.active_entries[index]
		if entry.instance:update(dt_ms) ~= nil then
			if timeline_dispatch.process_instance_events(entry, self.parent, dt_ms, process_timeline_frame_payload) then
				deactivate_timeline_entry(self, entry.instance.id)
			else
				index = index + 1
			end
		else
			index = index + 1
		end
	end
end

return timelinecomponent
