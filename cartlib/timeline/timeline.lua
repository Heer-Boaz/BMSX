local clamp<const> = require('cartlib/util/clamp')
local timeline_program<const> = require('cartlib/timeline/program')

local timelinestart_index<const> = -1
local update_method<const> = {
	play = 0,
	jump = 1,
	scrub = 2,
}
local playback_mode<const> = timeline_program.playback_mode
local playback_once<const> = playback_mode.once
local playback_loop<const> = playback_mode.loop
local playback_pingpong<const> = playback_mode.pingpong
local play_update_method<const> = update_method.play
local jump_update_method<const> = update_method.jump
local scrub_update_method<const> = update_method.scrub

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

local update_continuous<const> = function(self, delta_time)
	local program<const> = self.program
	local previous_frame = self.head
	local frame = previous_frame
	if frame < 0 then
		frame = 0
	end
	self.head = frame
	local previous_time_ms = self.position_ms
	local duration_ms<const> = program.duration_ms
	if duration_ms == nil then
		local time_ms<const> = previous_time_ms + delta_time * self.direction
		self.position_ms = time_ms
		write_evaluation(
			self,
			previous_frame,
			frame,
			previous_time_ms,
			time_ms,
			play_update_method,
			self.direction,
			true,
			false,
			false
		)
		return self
	end
	local mode<const> = program.playback_mode
	if mode == playback_once then
		local time_ms = previous_time_ms + delta_time
		local ended<const> = time_ms >= duration_ms
		if ended then
			time_ms = duration_ms
			self.ended = true
		end
		self.position_ms = time_ms
		write_evaluation(
			self,
			previous_frame,
			frame,
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
	local remaining = delta_time
	if mode == playback_loop then
		while previous_time_ms + remaining >= duration_ms do
			remaining = remaining - (duration_ms - previous_time_ms)
			write_evaluation(
				self,
				previous_frame,
				frame,
				previous_time_ms,
				0,
				play_update_method,
				1,
				true,
				true,
				true
			)
			previous_frame = frame
			previous_time_ms = 0
		end
		if remaining > 0 or self.evaluation_count == 0 then
			local time_ms<const> = previous_time_ms + remaining
			write_evaluation(
				self,
				previous_frame,
				frame,
				previous_time_ms,
				time_ms,
				play_update_method,
				1,
				true,
				false,
				false
			)
			previous_time_ms = time_ms
		end
		self.position_ms = previous_time_ms
		return self
	end
	while remaining > 0 do
		local direction<const> = self.direction
		local boundary_ms
		local distance_ms
		if direction > 0 then
			boundary_ms = duration_ms
			distance_ms = duration_ms - previous_time_ms
		else
			boundary_ms = 0
			distance_ms = previous_time_ms
		end
		local time_ms
		local ended
		if remaining >= distance_ms then
			time_ms = boundary_ms
			remaining = remaining - distance_ms
			ended = true
			self.direction = -direction
		else
			time_ms = previous_time_ms + remaining * direction
			remaining = 0
			ended = false
		end
		write_evaluation(
			self,
			previous_frame,
			frame,
			previous_time_ms,
			time_ms,
			play_update_method,
			direction,
			true,
			ended,
			false
		)
		previous_frame = frame
		previous_time_ms = time_ms
	end
	self.position_ms = previous_time_ms
	return self
end

function timeline:update(delta_time)
	local program<const> = self.program
	if not program.auto_tick or self.ended then
		return nil
	end
	clear_evaluations(self)
	if program.continuous then
		return update_continuous(self, delta_time)
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

local move_time<const> = function(self, requested_time_ms, method)
	clear_evaluations(self)
	local program<const> = self.program
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local time_ms
	if program.duration_ms == nil then
		if requested_time_ms < 0 then
			time_ms = 0
		else
			time_ms = requested_time_ms
		end
	else
		time_ms = clamp(requested_time_ms, 0, program.duration_ms)
	end
	local frame
	if program.continuous then
		frame = 0
	else
		frame = (time_ms / program.frame_duration) // 1
		if frame >= program.length then
			frame = program.length - 1
		end
	end
	local direction = 0
	if time_ms > previous_time_ms then
		direction = 1
	elseif time_ms < previous_time_ms then
		direction = -1
	end
	self.head = frame
	if program.continuous then
		self.frame_elapsed = 0
	else
		self.frame_elapsed = time_ms - frame * program.frame_duration
	end
	self.position_ms = time_ms
	self.ended = false
	write_evaluation(
		self,
		previous_frame,
		frame,
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

function timeline:seek_time(time_ms)
	return move_time(self, time_ms, jump_update_method)
end

function timeline:scrub_time(time_ms)
	return move_time(self, time_ms, scrub_update_method)
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
	local traversal_direction<const> = program.playback_mode == playback_pingpong and self.direction or 1
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
		if program.playback_mode == playback_loop then
			current_frame = 0
			wrapped = true
			self.direction = 1
		elseif program.playback_mode == playback_pingpong then
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
	elseif ended and program.playback_mode ~= playback_pingpong then
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
	playback_mode = playback_mode,
	timeline = timeline,
	range = range,
	build_frame_sequence = build_frame_sequence,
	build_pingpong_frames = build_pingpong_frames,
}
