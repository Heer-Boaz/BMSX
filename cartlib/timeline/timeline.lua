local clamp<const> = require('cartlib/util/clamp')
local timeline_evaluation_context<const> = require('cartlib/timeline/evaluation_context')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_playback<const> = require('cartlib/timeline/playback')

local timelinestart_index<const> = timeline_playback.start_index
local update_method<const> = timeline_playback.update_method
local playback_mode<const> = timeline_playback.mode
local playback_once<const> = playback_mode.once
local playback_loop<const> = playback_mode.loop
local playback_pingpong<const> = playback_mode.pingpong
local playback_boundary<const> = timeline_playback.boundary
local boundary_none<const> = playback_boundary.none
local boundary_loop<const> = playback_boundary.loop
local boundary_turn<const> = playback_boundary.turn
local evaluation_flag<const> = timeline_playback.evaluation_flag
local sample_flag<const> = evaluation_flag.sample
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial
-- Traversal publishes initial state once at this boundary. Evaluators consume
-- the bit directly instead of rediscovering it from the frame sentinel.
local sample_range_flags<const> = sample_flag | boundary_none
local initial_sample_range_flags<const> = sample_range_flags | initial_flag
local loop_boundary_flags<const> = wrapped_flag | boundary_loop
local play_update_method<const> = update_method.play
local jump_update_method<const> = update_method.jump
local scrub_update_method<const> = update_method.scrub

local timeline<const> = {}
timeline.__index = timeline

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

local advance_internal<const> = function(self, entry, owner, preserve_elapsed)
	local program<const> = self.program
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local initial<const> = previous_frame == timelinestart_index
	local traversal_direction<const> = program.playback_mode == playback_pingpong and self.direction or 1
	local current_frame = previous_frame + (initial and 1 or traversal_direction)
	local sample = true
	local at_boundary = false
	local boundary = boundary_none
	local wrapped = false
	local last_index<const> = program.length - 1
	if current_frame < 0 then
		current_frame = 0
		self.direction = 1
		at_boundary = true
		boundary = boundary_turn
	elseif current_frame > last_index then
		at_boundary = true
		if program.playback_mode == playback_loop then
			current_frame = 0
			boundary = boundary_loop
			wrapped = true
			self.direction = 1
		elseif program.playback_mode == playback_pingpong then
			current_frame = last_index
			boundary = boundary_turn
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
	if previous_frame == current_frame and not at_boundary then
		return nil
	end
	local time_ms
	if initial or wrapped then
		time_ms = 0
	elseif at_boundary and program.playback_mode ~= playback_pingpong then
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
	local flags = boundary
	if sample then
		flags = flags | sample_flag
	end
	if wrapped then
		flags = flags | wrapped_flag
		self.wrapped = true
	end
	if initial then
		flags = flags | initial_flag
	end
	program.evaluate_play(
		entry,
		owner,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		traversal_direction,
		flags
	)
	return self.ended
end

local update_continuous_unbounded<const> = function(self, entry, owner, delta_time)
	self.wrapped = false
	local previous_frame<const> = self.head
	local frame = previous_frame
	local flags = sample_range_flags
	if frame < 0 then
		frame = 0
		self.head = frame
		flags = initial_sample_range_flags
	end
	local previous_time_ms<const> = self.position_ms
	local direction<const> = self.direction
	local time_ms<const> = previous_time_ms + delta_time * direction
	self.position_ms = time_ms
	self.program.evaluate_play(
		entry,
		owner,
		previous_frame,
		frame,
		previous_time_ms,
		time_ms,
		direction,
		flags
	)
end

local update_continuous_once<const> = function(self, entry, owner, delta_time)
	self.wrapped = false
	local previous_frame<const> = self.head
	local frame = previous_frame
	local flags = sample_range_flags
	if frame < 0 then
		frame = 0
		self.head = frame
		flags = initial_sample_range_flags
	end
	local previous_time_ms<const> = self.position_ms
	local duration_ms<const> = self.program.duration_ms
	local time_ms = previous_time_ms + delta_time
	local ended<const> = time_ms >= duration_ms
	if ended then
		time_ms = duration_ms
		self.ended = true
	end
	self.position_ms = time_ms
	self.program.evaluate_play(
		entry,
		owner,
		previous_frame,
		frame,
		previous_time_ms,
		time_ms,
		1,
		flags
	)
	return ended
end

local update_continuous_loop<const> = function(self, entry, owner, delta_time)
	self.wrapped = false
	local previous_frame = self.head
	local frame = previous_frame
	local flags = sample_range_flags
	if frame < 0 then
		frame = 0
		self.head = frame
		flags = initial_sample_range_flags
	end
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.program.duration_ms
	local evaluate_play<const> = self.program.evaluate_play
	local remaining = delta_time
	local evaluated = false
	while previous_time_ms + remaining >= duration_ms do
		remaining = remaining - (duration_ms - previous_time_ms)
		evaluate_play(
			entry,
			owner,
			previous_frame,
			frame,
			previous_time_ms,
			0,
			1,
			flags | loop_boundary_flags
		)
		self.wrapped = true
		evaluated = true
		previous_frame = frame
		previous_time_ms = 0
		flags = sample_range_flags
	end
	if remaining > 0 or not evaluated then
		local time_ms<const> = previous_time_ms + remaining
		evaluate_play(
			entry,
			owner,
			previous_frame,
			frame,
			previous_time_ms,
			time_ms,
			1,
			flags
		)
		previous_time_ms = time_ms
	end
	self.position_ms = previous_time_ms
end

local update_continuous_pingpong<const> = function(self, entry, owner, delta_time)
	self.wrapped = false
	local previous_frame = self.head
	local frame = previous_frame
	local flags = sample_flag
	if frame < 0 then
		frame = 0
		self.head = frame
		flags = initial_sample_range_flags
	end
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.program.duration_ms
	local evaluate_play<const> = self.program.evaluate_play
	local remaining = delta_time
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
		local boundary
		if remaining >= distance_ms then
			time_ms = boundary_ms
			remaining = remaining - distance_ms
			boundary = boundary_turn
			self.direction = -direction
		else
			time_ms = previous_time_ms + remaining * direction
			remaining = 0
			boundary = boundary_none
		end
		evaluate_play(
			entry,
			owner,
			previous_frame,
			frame,
			previous_time_ms,
			time_ms,
			direction,
			flags | boundary
		)
		previous_frame = frame
		previous_time_ms = time_ms
		flags = sample_flag
	end
	self.position_ms = previous_time_ms
end

local update_immediate_frames<const> = function(self, entry, owner)
	self.wrapped = false
	return advance_internal(self, entry, owner, false)
end

local update_timed_frames<const> = function(self, entry, owner, delta_time)
	self.wrapped = false
	local frame_elapsed = self.frame_elapsed + delta_time
	local frame_duration<const> = self.program.frame_duration
	local evaluated = false
	while frame_elapsed >= frame_duration do
		frame_elapsed = frame_elapsed - frame_duration
		advance_internal(self, entry, owner, true)
		evaluated = true
		if self.ended then
			break
		end
	end
	self.frame_elapsed = frame_elapsed
	return evaluated and self.ended
end

local select_updater<const> = function(program)
	if not program.continuous then
		if program.frame_duration <= 0 then
			return update_immediate_frames
		end
		return update_timed_frames
	end
	if program.duration_ms == nil then
		return update_continuous_unbounded
	end
	local mode<const> = program.playback_mode
	if mode == playback_once then
		return update_continuous_once
	end
	if mode == playback_loop then
		return update_continuous_loop
	end
	return update_continuous_pingpong
end

function timeline.new(id, program)
	local self<const> = setmetatable({}, timeline)
	self.id = id
	self.program = program
	self.update = select_updater(program)
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.direction = 1
	self.wrapped = false
	return self
end

function timeline:rebind_program(program)
	self.program = program
	self.update = select_updater(program)
end

function timeline:build(params)
	self:rebind_program(timeline_frame_program.build(self.program, params))
	self:rewind()
end

function timeline:value()
	return timeline_frame_program.value(self.program, self.head)
end

function timeline:rewind()
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.direction = 1
	self.wrapped = false
end

function timeline:advance(entry, owner)
	self.wrapped = false
	return advance_internal(self, entry, owner, false)
end

local move_to<const> = function(self, entry, owner, frame, evaluate)
	self.wrapped = false
	local program<const> = self.program
	local previous_frame<const> = self.head
	local current_frame<const> = clamp(frame, 0, program.length - 1)
	local direction = 0
	if current_frame > previous_frame then
		direction = 1
	elseif current_frame < previous_frame then
		direction = -1
	end
	local previous_time_ms<const> = self.position_ms
	local time_ms<const> = current_frame * program.frame_duration
	local flags = sample_range_flags
	if previous_frame == timelinestart_index then
		flags = initial_sample_range_flags
	end
	self.head = current_frame
	self.frame_elapsed = 0
	self.position_ms = time_ms
	self.ended = false
	evaluate(
		entry,
		owner,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		direction,
		flags
	)
	return self
end

function timeline:advance_to(entry, owner, frame)
	return move_to(self, entry, owner, frame, self.program.evaluate_play)
end

-- A seek reconstructs destination state. Event tracks remain play-only unless
-- they explicitly opt into swept seek dispatch with `fire_on_seek`.
function timeline:seek(entry, owner, frame)
	return move_to(self, entry, owner, frame, self.program.evaluate_jump)
end

local move_time<const> = function(self, entry, owner, requested_time_ms, evaluate)
	self.wrapped = false
	local program<const> = self.program
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local flags = sample_range_flags
	if previous_frame == timelinestart_index then
		flags = initial_sample_range_flags
	end
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
	evaluate(
		entry,
		owner,
		previous_frame,
		frame,
		previous_time_ms,
		time_ms,
		direction,
		flags
	)
	return self
end

-- Explicit play traversal emits every crossed one-shot key. seek_time() and
-- scrub_time() reconstruct destination state and emit only tracks which opted
-- into their respective positioning method.
function timeline:advance_time_to(entry, owner, time_ms)
	return move_time(self, entry, owner, time_ms, self.program.evaluate_play)
end

function timeline:seek_time(entry, owner, time_ms)
	return move_time(self, entry, owner, time_ms, self.program.evaluate_jump)
end

function timeline:scrub_time(entry, owner, time_ms)
	return move_time(self, entry, owner, time_ms, self.program.evaluate_scrub)
end

local write_external_time_range<const> = function(
	entry,
	owner,
	previous_time_ms,
	time_ms,
	method,
	direction,
	initial,
	boundary,
	wrapped
)
	local self<const> = entry.instance
	local program<const> = self.program
	local previous_frame
	local frame
	local continuous<const> = program.continuous
	if continuous then
		previous_frame = self.head
		if previous_frame < 0 then
			previous_frame = 0
		end
		frame = previous_frame
	else
		local frame_duration<const> = program.frame_duration
		local last_frame<const> = program.length - 1
		previous_frame = (previous_time_ms / frame_duration) // 1
		if previous_frame > last_frame then
			previous_frame = last_frame
		end
		frame = (time_ms / frame_duration) // 1
		if frame > last_frame then
			frame = last_frame
		end
	end
	local sample<const> = continuous or initial or frame ~= previous_frame
	self.head = frame
	if continuous then
		self.frame_elapsed = 0
	else
		self.frame_elapsed = time_ms - frame * program.frame_duration
	end
	self.position_ms = time_ms
	self.direction = direction
	local flags = boundary
	if sample then
		flags = flags | sample_flag
	end
	if wrapped then
		flags = flags | wrapped_flag
		self.wrapped = true
	end
	if initial then
		flags = flags | initial_flag
	end
	local evaluate
	if method == play_update_method then
		evaluate = program.evaluate_play
	elseif method == jump_update_method then
		evaluate = program.evaluate_jump
	else
		evaluate = program.evaluate_scrub
	end
	evaluate(
		entry,
		owner,
		previous_frame,
		frame,
		previous_time_ms,
		time_ms,
		direction,
		flags
	)
	local notify_boundary<const> = entry.notify_boundary
	if notify_boundary ~= nil then
		local context<const> = entry.evaluation_context
		if not program.has_evaluation_callbacks then
			timeline_evaluation_context.write(
				context,
				program,
				method,
				previous_frame,
				frame,
				previous_time_ms,
				time_ms,
				direction,
				flags
			)
		end
		notify_boundary(entry.clip, entry.primary_binding, context)
	end
	return self
end

-- Play traversal emits every monotonic range produced by loop and ping-pong
-- warps. Positioning evaluates only the transformed destination range below.
function timeline:evaluate_clip_play_range(
	entry,
	owner,
	clip,
	previous_parent_time_ms,
	parent_time_ms,
	parent_direction,
	initial,
	finished
)
	self.wrapped = false
	local play_transform = clip.play_forward_transform
	if parent_direction < 0 then
		play_transform = clip.play_backward_transform
	end
	play_transform(
		clip,
		previous_parent_time_ms,
		parent_time_ms,
		initial,
		entry,
		owner,
		write_external_time_range
	)
	self.ended = finished
	return self
end

function timeline:evaluate_clip_at(entry, owner, clip, previous_parent_time_ms, parent_time_ms, method, initial)
	self.wrapped = false
	clip.position_transform(
		clip,
		previous_parent_time_ms,
		parent_time_ms,
		method,
		initial,
		entry,
		owner,
		write_external_time_range
	)
	self.ended = false
	return self
end

function timeline:snap_to_start(entry, owner)
	self.wrapped = false
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local flags = sample_range_flags
	if previous_frame == timelinestart_index then
		flags = initial_sample_range_flags
	end
	self.head = 0
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.program.evaluate_play(
		entry,
		owner,
		previous_frame,
		0,
		previous_time_ms,
		0,
		1,
		flags
	)
	return self
end

-- Position-only access for frame-sequence consumers; no evaluation is emitted.
function timeline:set_frame(frame)
	self.wrapped = false
	self.head = clamp(frame, timelinestart_index, self.program.length - 1)
	self.frame_elapsed = 0
	if self.head < 0 then
		self.position_ms = 0
	else
		self.position_ms = self.head * self.program.frame_duration
	end
end

return {
	timelinestart_index = timelinestart_index,
	update_method = update_method,
	playback_mode = playback_mode,
	playback_boundary = playback_boundary,
	timeline = timeline,
	range = range,
	build_frame_sequence = build_frame_sequence,
	build_pingpong_frames = build_pingpong_frames,
}
