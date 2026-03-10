local eventemitter_module = require('eventemitter')
local timeline_module = require('timeline')

local eventemitter = eventemitter_module.eventemitter

local function apply_frame(target, frame)
	for k, v in pairs(frame) do
		if type(v) == 'table' then
			apply_frame(target[k], v)
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
	if track.wave == 'pingpong' then
		w = easing.pingpong01(u)
	elseif track.wave == 'sin' then
		w = (math.sin(u * (math.pi * 2)) + 1) * 0.5
	else
		error('[subsystemtimelines] unknown wave '' .. tostring(track.wave) .. ''.')
	end
	local ease = track.ease
	if ease ~= nil then
		w = ease(w)
	end
	return w
end

local function apply_track(target, track, params, event)
	if type(track) == 'function' then
		track(target, params, event)
		return
	end
	local kind = track.kind
	if kind == 'wave' then
		local base = track.base
		local base_value = type(base) == 'string' and params[base] or base
		local w = eval_wave(track, event.time_seconds)
		local value = base_value + ((w - 0.5) * 2 * track.amp)
		set_path(target, track.path, value)
		return
	end
	if kind == 'sprite_parallax_rig' then
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
	error('[subsystemtimelines] unknown track kind '' .. tostring(kind) .. ''.')
end

local function apply_tracks(target, tracks, params, event)
	for i = 1, #tracks do
		apply_track(target, tracks[i], params, event)
	end
end

local subsystemtimelines = {}
subsystemtimelines.__index = subsystemtimelines

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
		error('[subsystemtimelines] timeline definition is missing id for '' .. tostring(self.owner.id) .. ''.')
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
		error('[subsystemtimelines] unknown timeline '' .. id .. '' on '' .. self.owner.id .. ''')
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
		error('[subsystemtimelines] unknown timeline '' .. id .. '' on '' .. self.owner.id .. ''')
	end
	local events = entry.instance:advance()
	if #events > 0 then
		self:process_events(entry, events, 0)
	end
	return entry.instance
end

function subsystemtimelines:play(id, opts)
	local entry = self.registry[id]
	if not entry then
		error('[subsystemtimelines] unknown timeline '' .. id .. '' on '' .. self.owner.id .. ''')
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
	if rewind then
		local controlled = entry.markers.controlled_tags
		for i = 1, #controlled do
			owner:remove_tag(controlled[i])
		end
		instance:rewind()
	end
	if snap and instance.length > 0 then
		self:process_events(entry, instance:snap_to_start(), 0)
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
		local events = entry.instance:tick(dt_ms)
		if #events > 0 then
			self:process_events(entry, events, dt_ms)
		end
	end
end

function subsystemtimelines:process_events(entry, events, dt_ms)
	local owner = self.owner
	local target = entry.target or owner
	local dt_seconds = dt_ms / 1000
	local time_ms = entry.instance.time_ms
	local time_seconds = time_ms / 1000
	for i = 1, #events do
		local evt = events[i]
		if evt.kind == 'frame' then
			local payload = {
				timeline_id = entry.instance.id,
				frame_index = evt.current,
				frame_value = evt.value,
				rewound = evt.rewound,
				reason = evt.reason,
				direction = evt.direction,
				dt = dt_ms,
				dt_seconds = dt_seconds,
				time_ms = time_ms,
				time_seconds = time_seconds,
			}
			self:apply_markers(entry, evt)
			local tracks = entry.tracks
			if tracks ~= nil then
				apply_tracks(target, tracks, entry.params, payload)
			end
			if entry.apply then
				if type(entry.apply) == 'function' then
					entry.apply(target, payload.frame_value, entry.params, payload)
				else
					apply_frame(target, payload.frame_value)
				end
			end
			self:emit_frame_event(owner, payload)
		else
			local payload = {
				timeline_id = entry.instance.id,
				mode = evt.mode,
				wrapped = evt.wrapped,
			}
			self:emit_end_event(owner, payload)
			if evt.mode == 'once' then
				self.active[entry.instance.id] = nil
			end
		end
	end
end

function subsystemtimelines:apply_markers(entry, event)
	local compiled = entry.markers
	local bucket = compiled.by_frame[event.current]
	if not bucket then
		return
	end
	local owner = self.owner
	for i = 1, #bucket do
		local marker = bucket[i]
		local add_tags = marker.add_tags
		if add_tags then
			for j = 1, #add_tags do
				owner:add_tag(add_tags[j])
			end
		end
		local remove_tags = marker.remove_tags
		if remove_tags then
			for j = 1, #remove_tags do
				owner:remove_tag(remove_tags[j])
			end
		end
		local payload = marker.payload
		local spec = { type = marker.event, emitter = owner }
		if payload ~= nil then
			if type(payload) == 'table' and payload.type == nil then
				for k, v in pairs(payload) do
					spec[k] = v
				end
			else
				spec.payload = payload
			end
		end
		local game_event = eventemitter:create_gameevent(spec)
		owner.events:emit_event(game_event)
		owner.sc:dispatch(game_event)
	end
end

function subsystemtimelines:emit_frame_event(owner, payload)
	self:dispatch_timeline_events(owner, 'timeline.frame', payload)
end

function subsystemtimelines:emit_end_event(owner, payload)
	self:dispatch_timeline_events(owner, 'timeline.end', payload)
end

function subsystemtimelines:dispatch_timeline_events(owner, base_type, payload)
	local base_event = eventemitter:create_gameevent({
		type = base_type,
		emitter = owner,
		timeline_id = payload.timeline_id,
		frame_index = payload.frame_index,
		frame_value = payload.frame_value,
		rewound = payload.rewound,
		reason = payload.reason,
		direction = payload.direction,
		mode = payload.mode,
		wrapped = payload.wrapped,
	})
	owner.events:emit_event(base_event)
	owner.sc:dispatch(base_event)
	local scoped_type = base_type .. '.' .. payload.timeline_id
	local scoped_event = eventemitter:create_gameevent({
		type = scoped_type,
		emitter = owner,
		timeline_id = payload.timeline_id,
		frame_index = payload.frame_index,
		frame_value = payload.frame_value,
		rewound = payload.rewound,
		reason = payload.reason,
		direction = payload.direction,
		mode = payload.mode,
		wrapped = payload.wrapped,
	})
	owner.events:emit_event(scoped_event)
	owner.sc:dispatch(scoped_event)
end

function subsystemtimelines:dispose()
	self.active = {}
	self.registry = {}
end

return {
	subsystemtimelines = subsystemtimelines,
}
