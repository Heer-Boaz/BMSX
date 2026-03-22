local timeline_module = require("timeline")
local timeline_dispatch = require("timeline_dispatch")

local function apply_frame(target, frame)
	for k, v in pairs(frame) do
		if type(v) == "table" then
			local child = target[k]
			if type(child) ~= "table" then
				child = {}
				target[k] = child
			end
			apply_frame(child, v)
		else
			target[k] = v
		end
	end
end

local function set_path(target, path, value)
	local node = target
	for i = 1, #path - 1 do
		node = node[path[i]]
	end
	node[path[#path]] = value
end

local function eval_wave(track, time_seconds)
	local u = (time_seconds / track.period) + (track.phase or 0)
	local w
	if track.wave == "pingpong" then
		w = easing.pingpong01(u)
	elseif track.wave == "sin" then
		w = (math.sin(u * (math.pi * 2)) + 1) * 0.5
	else
		error("[subsystemtimelines] unknown wave '" .. tostring(track.wave) .. "'.")
	end
	local ease = track.ease
	if ease ~= nil then
		w = ease(w)
	end
	return w
end

local function apply_track(target, track, params, event)
	if type(track) == "function" then
		track(target, params, event)
		return
	end
	local kind = track.kind
	if kind == "wave" then
		local base = track.base
		local base_value = type(base) == "string" and params[base] or base
		local w = eval_wave(track, event.time_seconds)
		local value = base_value + ((w - 0.5) * 2 * track.amp)
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

local function apply_tracks(target, tracks, params, event)
	for i = 1, #tracks do
		apply_track(target, tracks[i], params, event)
	end
end

local subsystemtimelines = {}
subsystemtimelines.__index = subsystemtimelines

local function process_subsystem_frame_payload(_, entry, owner, payload)
	local target = entry.target or owner
	local tracks = entry.tracks
	if tracks ~= nil then
		apply_tracks(target, tracks, entry.params, payload)
	end
	local apply = entry.apply
	if apply ~= nil then
		if type(apply) == "function" then
			apply(target, payload.frame_value, entry.params, payload)
		else
			apply_frame(target, payload.frame_value)
		end
	end
end

function subsystemtimelines.new(owner)
	local self = setmetatable({}, subsystemtimelines)
	self.owner = owner
	self.registry = {}
	self.active = {}
	return self
end

function subsystemtimelines:define(definition)
	local id = definition.id
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
	local entry = self.registry[id]
	if entry == nil then
		return nil
	end
	return entry.instance
end

function subsystemtimelines:seek(id, frame)
	local entry = self.registry[id]
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
	local entry = self.registry[id]
	if not entry then
		error("[subsystemtimelines] unknown timeline '" .. id .. "' on '" .. self.owner.id .. "'")
	end
	local instance = entry.instance
	if instance:advance() ~= nil then
		if timeline_dispatch.process_instance_events(entry, self.owner, 0, process_subsystem_frame_payload) then
			self.active[instance.id] = nil
		end
	end
	return instance
end

function subsystemtimelines:play(id, opts)
	local entry = self.registry[id]
	if not entry then
		error("[subsystemtimelines] unknown timeline '" .. id .. "' on '" .. self.owner.id .. "'")
	end
	local instance = entry.instance
	local owner = self.owner
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
		local controlled = entry.markers.controlled_tags
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
	local entry = self.registry[id]
	if entry then
		local owner = self.owner
		local controlled = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
	end
	self.active[id] = nil
end

function subsystemtimelines:update(dt_ms)
	for id in pairs(self.active) do
		local entry = self.registry[id]
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
