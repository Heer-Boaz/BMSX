local timeline_module<const> = require("bios/timeline/index")
local timeline_dispatch<const> = require("bios/timeline/dispatch")

local subsystemtimelines<const> = {}
subsystemtimelines.__index = subsystemtimelines

local activate_subsystem_entry<const> = function(self, entry)
	local id<const> = entry.instance.id
	if self.active_index_by_id[id] ~= nil then
		return
	end
	local count<const> = self.active_count + 1
	self.active_count = count
	self.active_entries[count] = entry
	self.active_index_by_id[id] = count
end

local deactivate_subsystem_entry<const> = function(self, id)
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

local process_subsystem_frame_payload<const> = function(_, entry, owner, payload)
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
		compiled_apply_frames[payload.frame_index + 1](target)
	end
end

function subsystemtimelines.new(owner)
	local self<const> = setmetatable({}, subsystemtimelines)
	self.owner = owner
	self.registry = {}
	self.active_entries = {}
	self.active_count = 0
	self.active_index_by_id = {}
	return self
end

function subsystemtimelines:define(definition)
	local id<const> = definition.id
	if id == nil then
		error("[subsystemtimelines] timeline definition is missing id for '" .. tostring(self.owner.id) .. "'.")
	end
	if self.registry[id] ~= nil then
		return self.registry[id].instance
	end
	local apply_function
	local compiled_apply_frames
	if type(definition.def.apply) == "function" then
		apply_function = definition.def.apply
	else
		compiled_apply_frames = definition.compiled_apply_frames
	end
	local entry<const> = {
		instance = definition,
		apply_function = apply_function,
		compiled_apply_frames = compiled_apply_frames,
		params = definition.def.params,
		target = self.owner,
		markers = timeline_module.compile_timeline_markers(definition.def, definition.length),
	}
	self.registry[id] = entry
	timeline_dispatch.init_entry(entry, self.owner)
	return definition
end

function subsystemtimelines:get(id)
	local entry<const> = self.registry[id]
	if entry == nil then
		return nil
	end
	return entry.instance
end

function subsystemtimelines:seek(id, frame)
	local entry<const> = self.registry[id]
	if not entry then
		error("[subsystemtimelines] unknown timeline '" .. id .. "' on '" .. self.owner.id .. "'")
	end
	entry.instance:force_seek(frame)
	return entry.instance
end

function subsystemtimelines:force_seek(id, frame)
	return self:seek(id, frame)
end

function subsystemtimelines:advance(id)
	local entry<const> = self.registry[id]
	if not entry then
		error("[subsystemtimelines] unknown timeline '" .. id .. "' on '" .. self.owner.id .. "'")
	end
	local instance<const> = entry.instance
	if instance:advance() ~= nil then
		if timeline_dispatch.process_instance_events(entry, self.owner, 0, process_subsystem_frame_payload) then
			deactivate_subsystem_entry(self, instance.id)
		end
	end
	return instance
end

function subsystemtimelines:play(id, opts)
	local entry<const> = self.registry[id]
	if not entry then
		error("[subsystemtimelines] unknown timeline '" .. id .. "' on '" .. self.owner.id .. "'")
	end
	local instance<const> = entry.instance
	local owner<const> = self.owner
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
		target = owner
	end
	entry.params = params
	entry.target = target
	if instance.frame_builder then
		instance:build(params)
		entry.compiled_apply_frames = instance.compiled_apply_frames
		entry.markers = timeline_module.compile_timeline_markers(instance.def, instance.length)
	end
	timeline_dispatch.init_entry(entry, owner)
	if rewind then
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		if instance:snap_to_start() ~= nil then
			if timeline_dispatch.process_instance_events(entry, owner, 0, process_subsystem_frame_payload) then
				deactivate_subsystem_entry(self, id)
			end
		end
	end
	activate_subsystem_entry(self, entry)
	return instance
end

function subsystemtimelines:stop(id)
	local entry<const> = self.registry[id]
	if entry then
		local owner<const> = self.owner
		local controlled<const> = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
	end
	deactivate_subsystem_entry(self, id)
end

function subsystemtimelines:update(dt_ms)
	local index = 1
	while index <= self.active_count do
		local entry<const> = self.active_entries[index]
		if entry.instance:update(dt_ms) ~= nil then
			if timeline_dispatch.process_instance_events(entry, self.owner, dt_ms, process_subsystem_frame_payload) then
				deactivate_subsystem_entry(self, entry.instance.id)
			else
				index = index + 1
			end
		else
			index = index + 1
		end
	end
end

function subsystemtimelines:dispose()
	self.active_entries = {}
	self.active_count = 0
	self.active_index_by_id = {}
	self.registry = {}
end

return {
	subsystemtimelines = subsystemtimelines,
}
