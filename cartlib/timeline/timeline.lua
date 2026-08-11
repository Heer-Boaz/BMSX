local clamp<const> = require('cartlib/util/clamp')
local timeline_program<const> = require('cartlib/timeline/program')

local timelinestart_index<const> = -1
local update_method<const> = {
	play = 0,
	jump = 1,
	scrub = 2,
}
local play_update_method<const> = update_method.play
local jump_update_method<const> = update_method.jump

local timeline<const> = {}
timeline.__index = timeline

local clear_evaluations<const> = function(self)
	self.evaluation_count = 0
	self.wrapped = false
end

local write_evaluation<const> = function(
	self,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	method,
	direction,
	sample,
	ended,
	wrapped
)
	local count<const> = self.evaluation_count + 1
	local evaluation = self.evaluations[count]
	if evaluation == nil then
		evaluation = {}
		self.evaluations[count] = evaluation
	end
	evaluation.previous_frame = previous_frame
	evaluation.frame = frame
	evaluation.previous_time_ms = previous_time_ms
	evaluation.time_ms = time_ms
	evaluation.method = method
	evaluation.direction = direction
	evaluation.sample = sample
	evaluation.ended = ended
	evaluation.wrapped = wrapped
	if sample then
		evaluation.value = timeline_program.frame_value(self.program, frame)
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

function timeline.new(id, program)
	local self<const> = setmetatable({}, timeline)
	self.id = id
	self.program = program
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.direction = 1
	self.wrapped = false
	self.evaluations = {}
	self.evaluation_count = 0
	return self
end

function timeline:rebind_program(program)
	self.program = program
end

function timeline:build(params)
	self.program = timeline_program.build(self.program, params)
	self:rewind()
end

function timeline:value()
	return timeline_program.frame_value(self.program, self.head)
end

function timeline:rewind()
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.position_ms = 0
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
	if program.continuous then
		local previous_time_ms<const> = self.position_ms
		local time_ms = previous_time_ms + delta_time
		local current = self.head
		if current < 0 then
			current = 0
		end
		self.head = current
		local ended<const> = program.duration_ms ~= nil and time_ms >= program.duration_ms
		if ended then
			time_ms = program.duration_ms
			self.ended = true
		end
		self.position_ms = time_ms
		write_evaluation(
			self,
			current,
			current,
			previous_time_ms,
			time_ms,
			play_update_method,
			1,
			true,
			ended,
			false
		)
		return self
	end
	self.frame_elapsed = self.frame_elapsed + delta_time
	local frame_duration<const> = program.frame_duration
	if frame_duration <= 0 then
		return self:advance_internal(false)
	end
	while self.frame_elapsed >= frame_duration do
		self.frame_elapsed = self.frame_elapsed - frame_duration
		self:advance_internal(true)
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
	return self:advance_internal(false)
end

local move_to<const> = function(self, frame, method)
	clear_evaluations(self)
	local previous_frame<const> = self.head
	local current_frame<const> = clamp(frame, 0, self.program.length - 1)
	local direction = 0
	if current_frame > previous_frame then
		direction = 1
	elseif current_frame < previous_frame then
		direction = -1
	end
	local previous_time_ms<const> = self.position_ms
	local time_ms<const> = current_frame * self.program.frame_duration
	self.head = current_frame
	self.frame_elapsed = 0
	self.position_ms = time_ms
	self.ended = false
	write_evaluation(
		self,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		method,
		direction,
		true,
		false,
		false
	)
	return self
end

function timeline:advance_to(frame)
	return move_to(self, frame, play_update_method)
end

-- A seek samples the destination and reconstructs persistent tags and
-- step-interpolated values without firing event keys crossed by the jump.
-- advance_to() traverses those one-shot keys.
function timeline:seek(frame)
	return move_to(self, frame, jump_update_method)
end

function timeline:snap_to_start()
	clear_evaluations(self)
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	self.head = 0
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	write_evaluation(
		self,
		previous_frame,
		0,
		previous_time_ms,
		0,
		play_update_method,
		1,
		true,
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
	if self.head < 0 then
		self.position_ms = 0
	else
		self.position_ms = self.head * self.program.frame_duration
	end
end

function timeline:advance_internal(preserve_elapsed)
	local program<const> = self.program
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local traversal_direction<const> = program.playback_mode == 'pingpong' and self.direction or 1
	local current_frame = previous_frame + (previous_frame == timelinestart_index and 1 or traversal_direction)
	local sample = true
	local ended = false
	local wrapped = false
	local last_index<const> = program.length - 1
	if current_frame < 0 then
		current_frame = 0
		self.direction = 1
		ended = true
	elseif current_frame > last_index then
		ended = true
		if program.playback_mode == 'loop' then
			current_frame = 0
			wrapped = true
			self.direction = 1
		elseif program.playback_mode == 'pingpong' then
			current_frame = last_index
			if last_index > 0 then
				self.direction = -1
			end
			sample = previous_frame ~= current_frame
		else
			current_frame = last_index
			sample = previous_frame ~= current_frame
			self.ended = true
			self.direction = 1
		end
	end
	if previous_frame == current_frame and not ended then
		return nil
	end
	local time_ms
	if previous_frame == timelinestart_index or wrapped then
		time_ms = 0
	elseif ended and program.playback_mode ~= 'pingpong' then
		time_ms = program.duration_ms
	elseif current_frame == previous_frame then
		time_ms = previous_time_ms
	else
		time_ms = previous_time_ms + traversal_direction * program.frame_duration
	end
	self.head = current_frame
	self.position_ms = time_ms
	if not preserve_elapsed then
		self.frame_elapsed = 0
	end
	write_evaluation(
		self,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		play_update_method,
		traversal_direction,
		sample,
		ended,
		wrapped
	)
	return self
end

return {
	timelinestart_index = timelinestart_index,
	update_method = update_method,
	timeline = timeline,
	range = range,
	build_frame_sequence = build_frame_sequence,
	build_pingpong_frames = build_pingpong_frames,
}
