-- timeline.lua
-- Timeline runtime for system ROM

local TIMELINE_START_INDEX = -1

local Timeline = {}
Timeline.__index = Timeline
Timeline.__is_timeline = true

local function expand_frames(frames, repetitions)
	if repetitions <= 1 then
		local out = {}
		for i = 1, #frames do
			out[i] = frames[i]
		end
		return out
	end
	local out = {}
	for r = 1, repetitions do
		for i = 1, #frames do
			out[#out + 1] = frames[i]
		end
	end
	return out
end

function Timeline.new(def)
	local self = setmetatable({}, Timeline)
	self.def = def
	self.id = def.id
	self.frames = expand_frames(def.frames, def.repetitions or 1)
	self.length = #self.frames
	self.ticks_per_frame = def.ticks_per_frame or 0
	self.playback_mode = def.playback_mode or "once"
	local autotick = def.autotick
	if autotick == nil then
		autotick = self.ticks_per_frame ~= 0
	end
	self.auto_tick = autotick
	self.head = TIMELINE_START_INDEX
	self.ticks = 0
	self.direction = 1
	return self
end

function Timeline:value()
	if self.head < 0 or self.head >= self.length then
		return nil
	end
	return self.frames[self.head + 1]
end

function Timeline:rewind()
	self.head = TIMELINE_START_INDEX
	self.ticks = 0
	self.direction = 1
end

function Timeline:tick(dt)
	if not self.auto_tick or self.length == 0 then
		return {}
	end
	self.ticks = self.ticks + dt
	if self.ticks_per_frame <= 0 or self.ticks >= self.ticks_per_frame then
		return self:advance_internal("advance")
	end
	return {}
end

function Timeline:advance()
	return self:advance_internal("advance")
end

function Timeline:seek(frame)
	return self:apply_frame(frame, "seek")
end

function Timeline:snap_to_start()
	return self:apply_frame(0, "snap")
end

function Timeline:force_seek(frame)
	if self.length == 0 then
		self.head = TIMELINE_START_INDEX
		self.ticks = 0
		self.direction = 1
		return
	end
	local clamped = math.min(math.max(frame, TIMELINE_START_INDEX), self.length - 1)
	self.head = clamped
	self.ticks = 0
	if self.playback_mode ~= "pingpong" then
		self.direction = 1
	elseif clamped <= 0 then
		self.direction = 1
	end
end

function Timeline:advance_internal(reason)
	if self.length == 0 then
		return {}
	end
	local delta = self.playback_mode == "pingpong" and self.direction or 1
	local target = self.head + (self.head == TIMELINE_START_INDEX and 1 or delta)
	return self:apply_frame(target, reason)
end

function Timeline:apply_frame(target, reason)
	local events = {}
	if self.length == 0 then
		return events
	end
	local last_index = self.length - 1
	local previous = self.head
	local next = target
	local rewound = false
	local emit_frame = true
	local emit_end = false
	local wrapped = false

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
	TIMELINE_START_INDEX = TIMELINE_START_INDEX,
	Timeline = Timeline,
}
