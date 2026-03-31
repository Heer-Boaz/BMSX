-- timeline.lua
-- timeline runtime for system rom
--
local clamp_int<const> = require('util/clamp_int')
--
-- DESIGN PRINCIPLES — timeline authoring
--
-- 1. ALWAYS USE A PLAIN def TABLE; NEVER CALL timeline.new() IN CART CODE.
--    When declaring a timeline inside an FSM state's `timelines` block, pass
--    a plain Lua table to the `def` field.  The FSM runtime calls
--    timeline.new(def) internally.  The `id` field inside `def` is optional
--    and defaults to the timeline's dictionary key in the `timelines` table.
--
--    WRONG — manual timeline object construction in cart code:
--      local tl = timeline.new({ id = 'my_tl', frames = timeline.range(10),
--                                playback_mode = 'once' })
--      timelines = { my_tl = { def = tl, ... } }  -- passing object, not table
--    RIGHT — plain table; id defaults to key:
--      timelines = { my_tl = { def = { frames = timeline.range(10),
--                                      playback_mode = 'once' }, ... } }
--
-- 2. USE timeline.range() FOR SEQUENTIAL FRAME RANGES.
--    timeline.range(n) is a convenience that returns a frame list
--    [0, 1, 2, …, n-1].  Use it instead of spelling out the list manually
--    for simple single-sprite or timer-only timelines.
--
-- 3. PLAYBACK MODES.
--      'once'      — plays from start to end once, stops at the last frame.
--      'loop'      — loops back to frame 0 after the last frame.
--      'pingpong'  — reverses direction at each end.
--
-- 4. MARKERS AND WINDOWS.
--    Markers fire events at specific frames.  Windows are marker pairs that
--    also add/remove tags for their duration; declare them in `windows` to
--    avoid writing the start/end markers manually.

local timeline_start_index<const> = -1

local timeline<const> = {}
timeline.__index = timeline
timeline.__is_timeline = true

local clear_step_events<const> = function(self)
	self.step_has_frame_event = false
	self.step_has_end_event = false
end

local write_frame_event<const> = function(self, previous, current, value, rewound, direction, reason)
	local event<const> = self.step_frame_event
	event.previous = previous
	event.current = current
	event.value = value
	event.rewound = rewound
	event.direction = direction
	event.reason = reason
	self.step_has_frame_event = true
end

local write_end_event<const> = function(self, frame, mode, wrapped)
	local event<const> = self.step_end_event
	event.frame = frame
	event.mode = mode
	event.wrapped = wrapped
	self.step_has_end_event = true
end

local expand_timeline_windows<const> = function(markers, windows)
	if not windows or #windows == 0 then
		return markers or {}
	end
	local out<const> = {}
	if markers then
		for i = 1, #markers do
			out[#out + 1] = markers[i]
		end
	end
	for i = 1, #windows do
		local window_def<const> = windows[i]
		local name<const> = window_def.name
		local tag<const> = window_def.tag or ('timeline.window.' .. name)
		local start_at<const> = window_def.start
		local start<const> = {
			frame = start_at.frame,
			u = start_at.u,
			event = 'window.' .. name .. '.start',
			payload = window_def.payloadstart,
			add_tags = { tag },
		}
		local end_at<const> = window_def['end']
		local finish<const> = {
			frame = end_at.frame,
			u = end_at.u,
			event = 'window.' .. name .. '.end',
			payload = window_def.payloadend,
			remove_tags = { tag },
		}
		out[#out + 1] = start
		out[#out + 1] = finish
	end
	return out
end

local clamp_marker_frame<const> = function(at, length)
	if at.frame ~= nil then
		return clamp_int(at.frame, 0, length - 1)
	end
	local normalized<const> = clamp_int(at.u or 0, 0, 1)
	return clamp_int(math.floor(normalized * (length - 1)), 0, length - 1)
end

local compile_timeline_markers<const> = function(def, length)
	local cache<const> = { by_frame = {}, controlled_tags = {} }
	local markers<const> = expand_timeline_windows(def.markers or {}, def.windows or {})
	local controlled<const> = {}
	for i = 1, #markers do
		local marker<const> = markers[i]
		local adds<const> = marker.add_tags
		if adds then
			for j = 1, #adds do
				controlled[adds[j]] = true
			end
		end
		local removes<const> = marker.remove_tags
		if removes then
			for j = 1, #removes do
				controlled[removes[j]] = true
			end
		end
		if length > 0 then
			local frame<const> = clamp_marker_frame(marker, length)
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

local expand_frames<const> = function(frames, repetitions)
	if repetitions <= 1 then
		return frames
	end
	local out<const> = {}
	for r = 1, repetitions do
		for i = 1, #frames do
			out[#out + 1] = frames[i]
		end
	end
	return out
end

local build_frame_sequence<const> = function(sequence)
	local out<const> = {}
	for i = 1, #sequence do
		local entry<const> = sequence[i]
		local hold<const> = entry.hold or 1
		for h = 1, hold do
			out[#out + 1] = entry.value
		end
	end
	return out
end

local build_pingpong_frames<const> = function(frames, include_endpoints)
	local out<const> = {}
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

-- timeline.range(n): returns a sequential frame list [0, 1, 2, …, n-1].
-- Use for simple timer or single-row sprite timelines instead of writing
-- out the list manually.  Example: timeline.range(30) = 30-frame once timer.
local range<const> = function(frame_count)
	local frames<const> = {}
	for i = 0, frame_count - 1 do
		frames[#frames + 1] = i
	end
	return frames
end

-- timeline.new(def): construct a timeline object from a definition table.
-- In cart code this is called automatically by the FSM runtime when a state's
-- `timelines` block contains a `def` table.  Do NOT call timeline.new()
-- directly in cart code — pass a plain table to `def` and let the FSM handle
-- construction.  See DESIGN PRINCIPLES rule 1 at the top of this file.
function timeline.new(def)
	local self<const> = setmetatable({}, timeline)
	self.def = def
	self.id = def.id
	self.tracks = def.tracks
	self.repetitions = def.repetitions or 1
	local continuous = def.continuous
	local frame_source<const> = def.frames
	if frame_source == nil and self.tracks ~= nil then
		self.frames = { {} }
		self.length = 1
		self.built = true
	end
	local source_type<const> = type(frame_source)
	if source_type == 'function' then
		self.frame_builder = frame_source
		self.frames = {}
		self.length = 0
		self.built = false
	elseif source_type == 'table' then
		self.frames = expand_frames(frame_source, self.repetitions)
		self.length = #self.frames
		self.built = true
	elseif frame_source ~= nil then
		error('[timeline] timeline "' .. tostring(def.id) .. '" requires a frames table or builder function.')
	end
	if def.ticks_per_frame ~= nil then
		self.ticks_per_frame = def.ticks_per_frame
	else
		self.ticks_per_frame = 1
	end
	self.playback_mode = def.playback_mode or 'once'
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
	self.step_frame_event = {}
	self.step_end_event = {}
	self.step_has_frame_event = false
	self.step_has_end_event = false
	return self
end

function timeline:build(params)
	if not self.frame_builder then
		error('[timeline] timeline "' .. tostring(self.id) .. '" has no frame builder.')
	end
	local frames<const> = self.frame_builder(params)
	if type(frames) ~= 'table' then
		error('[timeline] timeline "' .. tostring(self.id) .. '" frame builder must return a table.')
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
	clear_step_events(self)
end

function timeline:update(dt)
	clear_step_events(self)
	if not self.auto_tick or self.length == 0 then
		return nil
	end
	if self.ended then
		return nil
	end
	self.ticks = self.ticks + dt
	self.time_ms = self.time_ms + dt
	if self.continuous then
		local head = self.head
		if head < 0 then
			head = 0
		end
		self:apply_frame(head, 'update')
		if self.duration_ms and self.time_ms >= self.duration_ms then
			self.ended = true
			write_end_event(self, self.head, self.playback_mode, false)
		end
		if self.step_has_frame_event or self.step_has_end_event then
			return self
		end
		return nil
	end
	if self.ticks_per_frame <= 0 or self.ticks >= self.ticks_per_frame then
		return self:advance_internal('advance')
	end
	return nil
end

function timeline:advance()
	clear_step_events(self)
	return self:advance_internal('advance')
end

-- timeline:seek(frame): move the playhead to an absolute frame index.
-- Does NOT fire frame markers for skipped frames.  Use force_seek() if you
-- need markers to fire (e.g. to sync tag state after a manual jump).
function timeline:seek(frame)
	clear_step_events(self)
	return self:apply_frame(frame, 'seek')
end

function timeline:snap_to_start()
	clear_step_events(self)
	return self:apply_frame(0, 'snap')
end

function timeline:force_seek(frame)
	clear_step_events(self)
	if self.length == 0 then
		self.head = timeline_start_index
		self.ticks = 0
		self.direction = 1
		return
	end
	local clamped<const> = clamp_int(frame, timeline_start_index, self.length - 1)
	self.head = clamped
	self.ticks = 0
	if self.playback_mode ~= 'pingpong' then
		self.direction = 1
	elseif clamped <= 0 then
		self.direction = 1
	end
end

function timeline:advance_internal(reason)
	if self.length == 0 then
		return nil
	end
	local delta<const> = self.playback_mode == 'pingpong' and self.direction or 1
	local target<const> = self.head + (self.head == timeline_start_index and 1 or delta)
	return self:apply_frame(target, reason)
end

function timeline:apply_frame(target, reason)
	if self.length == 0 then
		return nil
	end
	local last_index<const> = self.length - 1
	local previous<const> = self.head
	local next = target
	local rewound
	local emit_frame
	local emit_end
	local wrapped

	if reason == 'seek' then
		self.direction = 1
	end

	if next < 0 then
		next = 0
		self.direction = 1
		emit_end = true
	elseif next > last_index then
		if self.playback_mode == 'loop' then
			next = 0
			rewound = true
			emit_end = true
			wrapped = true
			self.direction = 1
		elseif self.playback_mode == 'pingpong' then
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

	if previous == next and not rewound and not emit_end and reason == 'advance' then
		return nil
	end

	if emit_frame == nil then
		emit_frame = true
	end

	self.head = next
	self.ticks = 0

	if emit_frame then
		write_frame_event(self, previous, next, self.frames[next + 1], rewound, self.direction, reason)
	end

	if emit_end then
		write_end_event(self, self.head, self.playback_mode, wrapped)
	end

	if self.step_has_frame_event or self.step_has_end_event then
		return self
	end
	return nil
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
