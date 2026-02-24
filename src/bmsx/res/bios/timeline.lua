-- timeline.lua
-- timeline runtime for system rom

local timeline_start_index = -1

local timeline = {}
timeline.__index = timeline
timeline.__is_timeline = true

local function expand_timeline_windows(markers, windows)
	if not windows or #windows == 0 then
		return markers or {}
	end
	local out = {}
	if markers then
		for i = 1, #markers do
			out[#out + 1] = markers[i]
		end
	end
	for i = 1, #windows do
		local window_def = windows[i]
		local name = window_def.name
		local tag = window_def.tag or ("timeline.window." .. name)
		local start_at = window_def.start
		local start = {
			frame = start_at.frame,
			u = start_at.u,
			event = "window." .. name .. ".start",
			payload = window_def.payloadstart,
			add_tags = { tag },
		}
		local end_at = window_def["end"]
		local finish = {
			frame = end_at.frame,
			u = end_at.u,
			event = "window." .. name .. ".end",
			payload = window_def.payloadend,
			remove_tags = { tag },
		}
		out[#out + 1] = start
		out[#out + 1] = finish
	end
	return out
end

local function clamp_marker_frame(at, length)
	if at.frame ~= nil then
		return math.min(math.max(at.frame, 0), length - 1)
	end
	local normalized = math.min(math.max(at.u or 0, 0), 1)
	return math.min(math.max(math.floor(normalized * (length - 1)), 0), length - 1)
end

local function compile_timeline_markers(def, length)
	local cache = { by_frame = {}, controlled_tags = {} }
	local markers = expand_timeline_windows(def.markers or {}, def.windows or {})
	local controlled = {}
	for i = 1, #markers do
		local marker = markers[i]
		local adds = marker.add_tags
		if adds then
			for j = 1, #adds do
				controlled[adds[j]] = true
			end
		end
		local removes = marker.remove_tags
		if removes then
			for j = 1, #removes do
				controlled[removes[j]] = true
			end
		end
		if length > 0 then
			local frame = clamp_marker_frame(marker, length)
			local bucket = cache.by_frame[frame]
			if not bucket then
				bucket = {}
				cache.by_frame[frame] = bucket
			end
			bucket[#bucket + 1] = {
				frame = frame,
				event = marker.event,
				payload = marker.payload,
				add_tags = marker.add_tags,
				remove_tags = marker.remove_tags,
			}
		end
	end
	for tag in pairs(controlled) do
		cache.controlled_tags[#cache.controlled_tags + 1] = tag
	end
	return cache
end

local function expand_frames(frames, repetitions)
	if repetitions <= 1 then
		return frames
	end
	local out = {}
	for r = 1, repetitions do
		for i = 1, #frames do
			out[#out + 1] = frames[i]
		end
	end
	return out
end

local function build_frame_sequence(sequence)
	local out = {}
	for i = 1, #sequence do
		local entry = sequence[i]
		local hold = entry.hold or 1
		for h = 1, hold do
			out[#out + 1] = entry.value
		end
	end
	return out
end

local function build_pingpong_frames(frames, include_endpoints)
	local out = {}
	for i = 1, #frames do
		out[#out + 1] = frames[i]
	end
	if #frames <= 1 then
		return out
	end
	local from_index
	local to_index
	if include_endpoints then
		from_index = #frames
		to_index = 1
	else
		from_index = #frames - 1
		to_index = 2
	end
	for i = from_index, to_index, -1 do
		out[#out + 1] = frames[i]
	end
	return out
end

local function range(frame_count)
	local frames = {}
	for i = 0, frame_count - 1 do
		frames[#frames + 1] = i
	end
	return frames
end

function timeline.new(def)
	local self = setmetatable({}, timeline)
	self.def = def
	self.id = def.id
	self.tracks = def.tracks
	self.repetitions = def.repetitions or 1
	local continuous = def.continuous
	local frame_source = def.frames
	if frame_source == nil and self.tracks ~= nil then
		self.frames = { {} }
		self.length = 1
		self.built = true
	end
	local source_type = type(frame_source)
	if source_type == "function" then
		self.frame_builder = frame_source
		self.frames = {}
		self.length = 0
		self.built = false
	elseif source_type == "table" then
		self.frames = expand_frames(frame_source, self.repetitions)
		self.length = #self.frames
		self.built = true
	elseif frame_source ~= nil then
		error("[timeline] timeline '" .. tostring(def.id) .. "' requires a frames table or builder function.")
	end
	if def.ticks_per_frame ~= nil then
		self.ticks_per_frame = def.ticks_per_frame
	else
		self.ticks_per_frame = 1
	end
	self.playback_mode = def.playback_mode or "once"
	if continuous == nil and frame_source == nil and self.tracks ~= nil then
		continuous = true
	end
	self.continuous = continuous
	local autotick = def.autotick
	if autotick == nil then
		autotick = self.continuous or self.ticks_per_frame ~= 0
	end
	self.auto_tick = autotick
	self.head = timeline_start_index
	self.ticks = 0
	self.time_ms = 0
	self.duration_ms = def.duration_ms or (def.duration_seconds and (def.duration_seconds * 1000))
	self.ended = false
	self.direction = 1
	return self
end

function timeline:build(params)
	if not self.frame_builder then
		error("[timeline] timeline '" .. tostring(self.id) .. "' has no frame builder.")
	end
	local frames = self.frame_builder(params)
	if type(frames) ~= "table" then
		error("[timeline] timeline '" .. tostring(self.id) .. "' frame builder must return a table.")
	end
	self.frames = expand_frames(frames, self.repetitions)
	self.length = #self.frames
	self.built = true
	self:rewind()
end

function timeline:value()
	if self.head < 0 or self.head >= self.length then
		return nil
	end
	return self.frames[self.head + 1]
end

function timeline:rewind()
	self.head = timeline_start_index
	self.ticks = 0
	self.time_ms = 0
	self.ended = false
	self.direction = 1
end

function timeline:tick(dt)
	if not self.auto_tick or self.length == 0 then
		return {}
	end
	if self.ended then
		return {}
	end
	self.ticks = self.ticks + dt
	self.time_ms = self.time_ms + dt
	if self.continuous then
		local head = self.head
		if head < 0 then
			head = 0
		end
		local events = self:apply_frame(head, "tick")
		if self.duration_ms and self.time_ms >= self.duration_ms then
			self.ended = true
			events[#events + 1] = {
				kind = "end",
				frame = self.head,
				mode = self.playback_mode,
				wrapped = false,
			}
		end
		return events
	end
	if self.ticks_per_frame <= 0 or self.ticks >= self.ticks_per_frame then
		return self:advance_internal("advance")
	end
	return {}
end

function timeline:advance()
	return self:advance_internal("advance")
end

function timeline:seek(frame)
	return self:apply_frame(frame, "seek")
end

function timeline:snap_to_start()
	return self:apply_frame(0, "snap")
end

function timeline:force_seek(frame)
	if self.length == 0 then
		self.head = timeline_start_index
		self.ticks = 0
		self.direction = 1
		return
	end
	local clamped = math.min(math.max(frame, timeline_start_index), self.length - 1)
	self.head = clamped
	self.ticks = 0
	if self.playback_mode ~= "pingpong" then
		self.direction = 1
	elseif clamped <= 0 then
		self.direction = 1
	end
end

function timeline:advance_internal(reason)
	if self.length == 0 then
		return {}
	end
	local delta = self.playback_mode == "pingpong" and self.direction or 1
	local target = self.head + (self.head == timeline_start_index and 1 or delta)
	return self:apply_frame(target, reason)
end

function timeline:apply_frame(target, reason)
	local events = {}
	if self.length == 0 then
		return events
	end
	local last_index = self.length - 1
	local previous = self.head
	local next = target
	local rewound
	local emit_frame
	local emit_end
	local wrapped

	if reason == "seek" then
		self.direction = 1
	end

	if next < 0 then
		next = 0
		self.direction = 1
		emit_end = true
	elseif next > last_index then
		if self.playback_mode == "loop" then
			next = 0
			rewound = true
			emit_end = true
			wrapped = true
			self.direction = 1
		elseif self.playback_mode == "pingpong" then
			next = last_index
			if last_index > 0 then
				self.direction = -1
			end
			if previous == next then
				emit_frame = false
			end
			emit_end = true
		else
			next = last_index
			if previous == next then
				emit_frame = false
			end
			emit_end = true
			self.direction = 1
		end
	end

	if previous == next and not rewound and not emit_end and reason == "advance" then
		return events
	end

	if emit_frame == nil then
		emit_frame = true
	end

	self.head = next
	self.ticks = 0

	if emit_frame then
		events[#events + 1] = {
			kind = "frame",
			previous = previous,
			current = next,
			value = self.frames[next + 1],
			rewound = rewound,
			direction = self.direction,
			reason = reason,
		}
	end

	if emit_end then
		events[#events + 1] = {
			kind = "end",
			frame = self.head,
			mode = self.playback_mode,
			wrapped = wrapped,
		}
	end

	return events
end

return {
	timeline_start_index = timeline_start_index,
	timeline = timeline,
	new = timeline.new,
	range = range,
	expand_timeline_windows = expand_timeline_windows,
	compile_timeline_markers = compile_timeline_markers,
	expand_frames = expand_frames,
	build_frame_sequence = build_frame_sequence,
	build_pingpong_frames = build_pingpong_frames,
}
