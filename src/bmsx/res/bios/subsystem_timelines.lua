local timeline_module<const> = require("timeline")
local timeline_dispatch<const> = require("timeline_dispatch")

local apply_frame<const> = function(target, frame)
	for k, v in pairs(frame) do
		if type(v) == "table" then
			apply_frame(target[k], v)
		else
			target[k] = v
		end
	end
end

local set_path<const> = function(target, path, value)
	local node = target
	for i = 1, #path - 1 do
		node = node[path[i]]
	end
	node[path[#path]] = value
end

local eval_wave<const> = function(track, time_seconds)
	local u<const> = (time_seconds / track.period) + (track.phase or 0)
	local w
	if track.wave == "pingpong" then
		w = easing.pingpong01(u)
	elseif track.wave == "sin" then
		w = (math.sin(u * (math.pi * 2)) + 1) * 0.5
	else
		error("[subsystemtimelines] unknown wave '" .. tostring(track.wave) .. "'.")
	end
	local ease<const> = track.ease
	if ease ~= nil then
		w = ease(w)
	end
	return w
end

local apply_track<const> = function(target, track, params, event)
	if type(track) == "function" then
		track(target, params, event)
		return
	end
	local kind<const> = track.kind
	if kind == "wave" then
		local base<const> = track.base
		local base_value<const> = type(base) == "string" and params[base] or base
		local w<const> = eval_wave(track, event.time_seconds)
		local value<const> = base_value + ((w - 0.5) * 2 * track.amp)
		set_path(target, track.path, value)
		return
	end
	if kind == "sprite_parallax_rig" then
		set_sprite_parallax_rig(
			params.vy,
			params.scale,
			params.impact,
			event.time_seconds,
			params.bias_px,
			params.parallax_strength,
			params.scale_strength,
			params.flip_strength,
			params.flip_window
		)
		return
	end
	error("[subsystemtimelines] unknown track kind '" .. tostring(kind) .. "'.")
end

local apply_tracks<const> = function(target, tracks, params, event)
	for i = 1, #tracks do
		apply_track(target, tracks[i], params, event)
	end
end

local subsystemtimelines<const> = {}
subsystemtimelines.__index = subsystemtimelines

local process_subsystem_frame_payload<const> = function(_, entry, owner, payload)
	local target<const> = entry.target or owner
	local tracks<const> = entry.tracks
	if tracks ~= nil then
		apply_tracks(target, tracks, entry.params, payload)
	end
	local apply<const> = entry.apply
	if apply ~= nil then
		if type(apply) == "function" then
			apply(target, payload.frame_value, entry.params, payload)
		else
			apply_frame(target, payload.frame_value)
		end
	end
end

function subsystemtimelines.new(owner)
	local self<const> = setmetatable({}, subsystemtimelines)
	self.owner = owner
	self.registry = {}
	self.active = {}
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
	self.registry[id] = {
		instance = definition,
		tracks = definition.def.tracks,
		apply = definition.def.apply,
		params = definition.def.params,
		target = self.owner,
		markers = timeline_module.compile_timeline_markers(definition.def, definition.length),
	}
	timeline_dispatch.init_entry(self.registry[id], self.owner)
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
			self.active[instance.id] = nil
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
				self.active[id] = nil
			end
		end
	end
	self.active[id] = true
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
	self.active[id] = nil
end

function subsystemtimelines:update(dt_ms)
	for id in pairs(self.active) do
		local entry<const> = self.registry[id]
		if entry.instance:update(dt_ms) ~= nil then
			if timeline_dispatch.process_instance_events(entry, self.owner, dt_ms, process_subsystem_frame_payload) then
				self.active[id] = nil
			end
		end
	end
end

function subsystemtimelines:dispose()
	self.active = {}
	self.registry = {}
end

return {
	subsystemtimelines = subsystemtimelines,
}
