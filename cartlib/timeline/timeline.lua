local clamp<const> = require('cartlib/util/clamp')
local timelineprogram<const> = require('cartlib/timeline/program')

local timelinestart_index<const> = -1

local timeline<const> = {}
timeline.__index = timeline

local clear_evaluations<const> = function(self)
	self.evaluation_count = 0
	self.wrapped = false
end

local write_evaluation<const> = function(
	self,
	previous,
	current,
	reason,
	direction,
	time_ms,
	sample,
	ended,
	wrapped,
	jumped
)
	local count<const> = self.evaluation_count + 1
	local evaluation = self.evaluations[count]
	if evaluation == nil then
		evaluation = {}
		self.evaluations[count] = evaluation
	end
	evaluation.previous = previous
	evaluation.current = current
	evaluation.reason = reason
	evaluation.direction = direction
	evaluation.time_ms = time_ms
	evaluation.sample = sample
	evaluation.ended = ended
	evaluation.wrapped = wrapped
	evaluation.jumped = jumped
	if sample then
		evaluation.value = timelineprogram.frame_value(self.program, current)
	end
	self.evaluation_count = count
	if wrapped then
		self.wrapped = true
	end
	return evaluation
end

local build_frame_sequence<const> = function(sequence)
	local frames<const> = {}
	for index = 1, #sequence do
		local entry<const> = sequence[index]
		local hold<const> = entry.hold or 1
		for _ = 1, hold do
			frames[#frames + 1] = entry.value
		end
	end
	return frames
end

local build_pingpong_frames<const> = function(frames, include_endpoints)
	local sequence<const> = {}
	for index = 1, #frames do
		sequence[#sequence + 1] = frames[index]
	end
	if #frames <= 1 then
		return sequence
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
	for index = from_index, to_index, -1 do
		sequence[#sequence + 1] = frames[index]
	end
	return sequence
end

local range<const> = function(frame_count)
	return {
		__timelinerange = true,
		length = frame_count,
		source_length = frame_count,
	}
end

function timeline.new(program)
	local self<const> = setmetatable({}, timeline)
	self.id = program.id
	self.program = program
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.time_ms = 0
	self.ended = false
	self.direction = 1
	self.wrapped = false
	self.evaluations = {}
	self.evaluation_count = 0
	return self
end

function timeline:rebind_program(program)
	self.id = program.id
	self.program = program
end

function timeline:build(params)
	self.program = timelineprogram.build(self.program, params)
	self:rewind()
end

function timeline:value()
	return timelineprogram.frame_value(self.program, self.head)
end

function timeline:rewind()
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.time_ms = 0
	self.ended = false
	self.direction = 1
	clear_evaluations(self)
end

function timeline:update(delta_time)
	local program<const> = self.program
	if not program.auto_tick or self.ended then
		return nil
	end
	clear_evaluations(self)
	self.frame_elapsed = self.frame_elapsed + delta_time
	self.time_ms = self.time_ms + delta_time
	if program.continuous then
		local current = self.head
		if current < 0 then
			current = 0
		end
		self.head = current
		local ended<const> = program.duration_ms ~= nil and self.time_ms >= program.duration_ms
		if ended then
			self.ended = true
		end
		write_evaluation(
			self,
			current,
			current,
			'update',
			self.direction,
			self.time_ms,
			true,
			ended,
			false,
			false
		)
		return self
	end
	local frame_duration<const> = program.frame_duration
	if frame_duration <= 0 then
		return self:advance_internal('advance', self.time_ms, false)
	end
	while self.frame_elapsed >= frame_duration do
		self.frame_elapsed = self.frame_elapsed - frame_duration
		local event_time_ms<const> = self.time_ms - self.frame_elapsed
		self:advance_internal('advance', event_time_ms, true)
		if self.ended then
			break
		end
	end
	if self.evaluation_count > 0 then
		return self
	end
	return nil
end

function timeline:advance()
	clear_evaluations(self)
	return self:advance_internal('advance', self.time_ms, false)
end

local move_to<const> = function(self, frame, reason, jumped)
	clear_evaluations(self)
	local previous<const> = self.head
	local current<const> = clamp(frame, 0, self.program.length - 1)
	local direction = 0
	if current > previous then
		direction = 1
	elseif current < previous then
		direction = -1
	end
	self.head = current
	self.frame_elapsed = 0
	self.ended = false
	write_evaluation(
		self,
		previous,
		current,
		reason,
		direction,
		self.time_ms,
		true,
		false,
		false,
		jumped
	)
	return self
end

function timeline:advance_to(frame)
	return move_to(self, frame, 'advance_to', false)
end

-- A seek samples the destination and reconstructs persistent windows without
-- firing one-shot markers crossed by the jump. advance_to() traverses them.
function timeline:seek(frame)
	return move_to(self, frame, 'seek', true)
end

function timeline:snap_to_start()
	clear_evaluations(self)
	local previous<const> = self.head
	self.head = 0
	self.frame_elapsed = 0
	self.ended = false
	write_evaluation(
		self,
		previous,
		0,
		'snap',
		1,
		self.time_ms,
		true,
		false,
		false,
		false
	)
	return self
end

-- Position-only access for frame-sequence consumers; no evaluation is emitted.
function timeline:set_frame(frame)
	clear_evaluations(self)
	self.head = clamp(frame, timelinestart_index, self.program.length - 1)
	self.frame_elapsed = 0
end

function timeline:advance_internal(reason, event_time_ms, preserve_elapsed)
	local program<const> = self.program
	local previous<const> = self.head
	local traversal_direction<const> = program.playback_mode == 'pingpong' and self.direction or 1
	local current = previous + (previous == timelinestart_index and 1 or traversal_direction)
	local sample = true
	local ended = false
	local wrapped = false
	local last_index<const> = program.length - 1
	if current < 0 then
		current = 0
		self.direction = 1
		ended = true
	elseif current > last_index then
		ended = true
		if program.playback_mode == 'loop' then
			current = 0
			wrapped = true
			self.direction = 1
		elseif program.playback_mode == 'pingpong' then
			current = last_index
			if last_index > 0 then
				self.direction = -1
			end
			sample = previous ~= current
		else
			current = last_index
			sample = previous ~= current
			self.ended = true
			self.direction = 1
		end
	end
	if previous == current and not ended and reason == 'advance' then
		return nil
	end
	self.head = current
	if not preserve_elapsed then
		self.frame_elapsed = 0
	end
	write_evaluation(
		self,
		previous,
		current,
		reason,
		traversal_direction,
		event_time_ms,
		sample,
		ended,
		wrapped,
		false
	)
	return self
end

return {
	timelinestart_index = timelinestart_index,
	timeline = timeline,
	range = range,
	build_frame_sequence = build_frame_sequence,
	build_pingpong_frames = build_pingpong_frames,
}
