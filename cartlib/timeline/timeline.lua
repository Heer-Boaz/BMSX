local clamp<const> = require('cartlib/util/clamp')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_playback<const> = require('cartlib/timeline/playback')

local timelinestart_index<const> = timeline_playback.start_index
local playback_once<const> = timeline_playback.mode.once
local playback_loop<const> = timeline_playback.mode.loop
local boundary_none<const> = timeline_playback.boundary.none
local boundary_loop<const> = timeline_playback.boundary.loop
local boundary_turn<const> = timeline_playback.boundary.turn
local sample_flag<const> = timeline_playback.evaluation_flag.sample
local wrapped_flag<const> = timeline_playback.evaluation_flag.wrapped
local initial_flag<const> = timeline_playback.evaluation_flag.initial
local update_method<const> = {
	play = timeline_playback.update_method.play,
	jump = timeline_playback.update_method.jump,
	scrub = timeline_playback.update_method.scrub,
}
local playback_mode<const> = {
	once = playback_once,
	loop = playback_loop,
	pingpong = timeline_playback.mode.pingpong,
}
local playback_boundary<const> = {
	none = boundary_none,
	loop = boundary_loop,
	turn = boundary_turn,
}
-- Traversal publishes initial state once at this boundary. Evaluators consume
-- the bit directly instead of rediscovering it from the frame sentinel.
local sample_range_flags<const> = sample_flag | boundary_none
local initial_sample_range_flags<const> = sample_range_flags | initial_flag
local loop_boundary_flags<const> = wrapped_flag | boundary_loop

-- Identity-rate playback keeps the selected transport updater as the entry's
-- direct hot-path call. A non-identity rate pays one dispatch and multiply on
-- that playback only; changing the rate never rewrites authored time or seek
-- coordinates.
local update_scaled<const> = function(self, owner, delta_time)
	return self.transport_update(self, owner, delta_time * self.play_rate)
end

local bind_update<const> = function(self, update)
	if self.play_rate == 1 then
		self.update = update
		return
	end
	self.transport_update = update
	self.update = update_scaled
end

-- A timeline is the single mutable playback record scheduled by a component or
-- parent sequence. Its immutable program remains shareable across playbacks;
-- steady transport operands are retained directly on this datapath.
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

-- Playback mode is immutable program data. Frame traversal retains one
-- mode-specific datapath instead of decoding once, loop and pingpong policy on
-- every frame.
local advance_frame_once<const> = function(self, owner)
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local current_frame<const> = previous_frame + 1
	local last_frame<const> = self.last_frame
	if current_frame > last_frame then
		local duration_ms<const> = self.duration_ms
		self.head = last_frame
		self.position_ms = duration_ms
		self.ended = true
		self.direction = 1
		local time_ms
		local flags
		if previous_frame == timelinestart_index then
			time_ms = 0
			flags = initial_flag
		else
			time_ms = duration_ms
			if previous_frame ~= last_frame then
				flags = sample_flag
			else
				flags = boundary_none
			end
		end
		self.evaluate_play(
			self,
			owner,
			previous_frame,
			last_frame,
			previous_time_ms,
			time_ms,
			1,
			flags
		)
		return true
	end
	local time_ms
	local flags
	if previous_frame == timelinestart_index then
		time_ms = 0
		flags = sample_flag | initial_flag
	else
		time_ms = previous_time_ms + self.frame_duration
		flags = sample_flag
	end
	self.head = current_frame
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		1,
		flags
	)
end

local advance_frame_loop<const> = function(self, owner)
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local current_frame<const> = previous_frame + 1
	if current_frame > self.last_frame then
		self.head = 0
		self.position_ms = 0
		self.direction = 1
		self.wrapped = true
		local flags = sample_flag | wrapped_flag | boundary_loop
		if previous_frame == timelinestart_index then
			flags = flags | initial_flag
		end
		self.evaluate_play(
			self,
			owner,
			previous_frame,
			0,
			previous_time_ms,
			0,
			1,
			flags
		)
		return
	end
	local time_ms
	local flags
	if previous_frame == timelinestart_index then
		time_ms = 0
		flags = sample_flag | initial_flag
	else
		time_ms = previous_time_ms + self.frame_duration
		flags = sample_flag
	end
	self.head = current_frame
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		1,
		flags
	)
end

local advance_frame_pingpong<const> = function(self, owner)
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local direction<const> = self.direction
	local last_frame<const> = self.last_frame
	if previous_frame == timelinestart_index then
		local current_frame = 0
		local flags = sample_flag | initial_flag
		if current_frame > last_frame then
			current_frame = last_frame
			flags = initial_flag | boundary_turn
			if current_frame ~= previous_frame then
				flags = flags | sample_flag
			end
			if current_frame > 0 then
				self.direction = -1
			end
		end
		self.head = current_frame
		self.position_ms = 0
		self.evaluate_play(
			self,
			owner,
			previous_frame,
			current_frame,
			previous_time_ms,
			0,
			direction,
			flags
		)
		return
	end
	local current_frame = previous_frame + direction
	local time_ms
	local flags
	if current_frame < 0 then
		current_frame = 0
		self.direction = 1
		flags = sample_flag | boundary_turn
		time_ms = previous_time_ms
	elseif current_frame > last_frame then
		current_frame = last_frame
		flags = boundary_turn
		if current_frame ~= previous_frame then
			time_ms = previous_time_ms + direction * self.frame_duration
			flags = flags | sample_flag
		else
			time_ms = previous_time_ms
		end
		if current_frame > 0 then
			self.direction = -1
		end
	else
		time_ms = previous_time_ms + direction * self.frame_duration
		flags = sample_flag
	end
	self.head = current_frame
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		previous_frame,
		current_frame,
		previous_time_ms,
		time_ms,
		direction,
		flags
	)
end

local select_frame_advance<const> = function(program)
	if program.playback_mode == playback_once then
		return advance_frame_once
	end
	if program.playback_mode == playback_loop then
		return advance_frame_loop
	end
	return advance_frame_pingpong
end

-- Entering or positioning continuous playback publishes frame zero once. Each
-- retained steady updater consumes that playback-state invariant directly;
-- 50 Hz evaluation does not rediscover the start sentinel every tick.
-- Unbounded, once and pingpong transport never assert wrapped; admission and
-- explicit positioning clear that latch, while loop/frame traversal owns it
-- per advance.
local update_continuous_unbounded<const> = function(self, owner, delta_time)
	local previous_time_ms<const> = self.position_ms
	local direction<const> = self.direction
	local time_ms<const> = previous_time_ms + delta_time * direction
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		0,
		0,
		previous_time_ms,
		time_ms,
		direction,
		sample_range_flags
	)
end

local update_continuous_unbounded_initial<const> = function(self, owner, delta_time)
	self.head = 0
	bind_update(self, update_continuous_unbounded)
	local previous_time_ms<const> = self.position_ms
	local direction<const> = self.direction
	local time_ms<const> = previous_time_ms + delta_time * direction
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		timelinestart_index,
		0,
		previous_time_ms,
		time_ms,
		direction,
		initial_sample_range_flags
	)
end

local update_continuous_once<const> = function(self, owner, delta_time)
	local previous_time_ms<const> = self.position_ms
	local duration_ms<const> = self.duration_ms
	local time_ms<const> = previous_time_ms + delta_time
	if time_ms >= duration_ms then
		self.ended = true
		self.position_ms = duration_ms
		self.evaluate_play(
			self,
			owner,
			0,
			0,
			previous_time_ms,
			duration_ms,
			1,
			sample_range_flags
		)
		return true
	end
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		0,
		0,
		previous_time_ms,
		time_ms,
		1,
		sample_range_flags
	)
end

local update_continuous_once_initial<const> = function(self, owner, delta_time)
	self.head = 0
	bind_update(self, update_continuous_once)
	local previous_time_ms<const> = self.position_ms
	local duration_ms<const> = self.duration_ms
	local time_ms<const> = previous_time_ms + delta_time
	if time_ms >= duration_ms then
		self.ended = true
		self.position_ms = duration_ms
		self.evaluate_play(
			self,
			owner,
			timelinestart_index,
			0,
			previous_time_ms,
			duration_ms,
			1,
			initial_sample_range_flags
		)
		return true
	end
	self.position_ms = time_ms
	self.evaluate_play(
		self,
		owner,
		timelinestart_index,
		0,
		previous_time_ms,
		time_ms,
		1,
		initial_sample_range_flags
	)
end

local update_continuous_loop<const> = function(self, owner, delta_time)
	self.wrapped = false
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.duration_ms
	local evaluate_play<const> = self.evaluate_play
	local remaining = delta_time
	local evaluated = false
	while previous_time_ms + remaining >= duration_ms do
		remaining = remaining - (duration_ms - previous_time_ms)
		evaluate_play(
			self,
			owner,
			0,
			0,
			previous_time_ms,
			0,
			1,
			sample_range_flags | loop_boundary_flags
		)
		self.wrapped = true
		evaluated = true
		previous_time_ms = 0
	end
	if remaining > 0 or not evaluated then
		local time_ms<const> = previous_time_ms + remaining
		evaluate_play(
			self,
			owner,
			0,
			0,
			previous_time_ms,
			time_ms,
			1,
			sample_range_flags
		)
		previous_time_ms = time_ms
	end
	self.position_ms = previous_time_ms
end

local update_continuous_loop_initial<const> = function(self, owner, delta_time)
	self.wrapped = false
	self.head = 0
	bind_update(self, update_continuous_loop)
	local previous_frame = timelinestart_index
	local flags = initial_sample_range_flags
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.duration_ms
	local evaluate_play<const> = self.evaluate_play
	local remaining = delta_time
	local evaluated = false
	while previous_time_ms + remaining >= duration_ms do
		remaining = remaining - (duration_ms - previous_time_ms)
		evaluate_play(
			self,
			owner,
			previous_frame,
			0,
			previous_time_ms,
			0,
			1,
			flags | loop_boundary_flags
		)
		self.wrapped = true
		evaluated = true
		previous_frame = 0
		previous_time_ms = 0
		flags = sample_range_flags
	end
	if remaining > 0 or not evaluated then
		local time_ms<const> = previous_time_ms + remaining
		evaluate_play(
			self,
			owner,
			previous_frame,
			0,
			previous_time_ms,
			time_ms,
			1,
			flags
		)
		previous_time_ms = time_ms
	end
	self.position_ms = previous_time_ms
end

local update_continuous_pingpong<const> = function(self, owner, delta_time)
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.duration_ms
	local evaluate_play<const> = self.evaluate_play
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
			self,
			owner,
			0,
			0,
			previous_time_ms,
			time_ms,
			direction,
			sample_flag | boundary
		)
		previous_time_ms = time_ms
	end
	self.position_ms = previous_time_ms
end

local update_continuous_pingpong_initial<const> = function(self, owner, delta_time)
	self.head = 0
	bind_update(self, update_continuous_pingpong)
	local previous_frame = timelinestart_index
	local flags = initial_sample_range_flags
	local previous_time_ms = self.position_ms
	local duration_ms<const> = self.duration_ms
	local evaluate_play<const> = self.evaluate_play
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
			self,
			owner,
			previous_frame,
			0,
			previous_time_ms,
			time_ms,
			direction,
			flags | boundary
		)
		previous_frame = 0
		previous_time_ms = time_ms
		flags = sample_flag
	end
	self.position_ms = previous_time_ms
end

local update_immediate_frames<const> = function(self, owner)
	self.wrapped = false
	self.frame_elapsed = 0
	return self.advance_frame(self, owner)
end

local update_timed_frames<const> = function(self, owner, delta_time)
	self.wrapped = false
	local frame_elapsed = self.frame_elapsed + delta_time
	local frame_duration<const> = self.frame_duration
	if frame_elapsed < frame_duration then
		self.frame_elapsed = frame_elapsed
		return false
	end
	local advance_frame<const> = self.advance_frame
	repeat
		frame_elapsed = frame_elapsed - frame_duration
		if advance_frame(self, owner) then
			self.frame_elapsed = frame_elapsed
			return true
		end
	until frame_elapsed < frame_duration
	self.frame_elapsed = frame_elapsed
	return false
end

-- A frame sequence with no evaluation work advances its retained transport
-- directly. Consumers read the destination frame through value(); no track,
-- event, binding or sequence work exists to traverse.
local update_timed_loop_transport<const> = function(self, _owner, delta_time)
	self.wrapped = false
	local frame_elapsed<const> = self.frame_elapsed + delta_time
	local frame_duration<const> = self.frame_duration
	if frame_elapsed < frame_duration then
		self.frame_elapsed = frame_elapsed
		return false
	end
	local advanced_frames<const> = frame_elapsed // frame_duration
	local frame_count<const> = self.last_frame + 1
	local frame<const> = self.head + advanced_frames
	self.wrapped = frame >= frame_count
	self.head = frame % frame_count
	self.frame_elapsed = frame_elapsed - advanced_frames * frame_duration
	self.position_ms = self.head * frame_duration
	self.direction = 1
	return false
end

-- Discrete loop playback without authored evaluation callbacks advances one
-- monotonic range per wrap, not one evaluator call per crossed frame. Sampled
-- state is written at the destination while event, tag and sequence programs
-- consume the complete crossed range.
local update_timed_loop<const> = function(self, owner, delta_time)
	self.wrapped = false
	local frame_elapsed<const> = self.frame_elapsed + delta_time
	local frame_duration<const> = self.frame_duration
	if frame_elapsed < frame_duration then
		self.frame_elapsed = frame_elapsed
		return false
	end
	local remaining_frames = frame_elapsed // frame_duration
	local next_frame_elapsed<const> = frame_elapsed - remaining_frames * frame_duration
	local previous_frame = self.head
	local previous_time_ms = self.position_ms
	local frame_count<const> = self.last_frame + 1
	local evaluate_play<const> = self.evaluate_play
	local flags = sample_flag
	if previous_frame == timelinestart_index then
		flags = flags | initial_flag
	end
	while remaining_frames > 0 do
		local frames_to_wrap<const> = frame_count - previous_frame
		if remaining_frames < frames_to_wrap then
			local frame<const> = previous_frame + remaining_frames
			local time_ms<const> = frame * frame_duration
			self.head = frame
			self.position_ms = time_ms
			evaluate_play(
				self,
				owner,
				previous_frame,
				frame,
				previous_time_ms,
				time_ms,
				1,
				flags
			)
			self.frame_elapsed = next_frame_elapsed
			return false
		end
		remaining_frames = remaining_frames - frames_to_wrap
		self.head = 0
		self.position_ms = 0
		self.direction = 1
		self.wrapped = true
		evaluate_play(
			self,
			owner,
			previous_frame,
			0,
			previous_time_ms,
			0,
			1,
			flags | loop_boundary_flags
		)
		previous_frame = 0
		previous_time_ms = 0
		flags = sample_flag
	end
	self.frame_elapsed = next_frame_elapsed
	return false
end

local select_updater<const> = function(program, positioned)
	if not program.continuous then
		if program.frame_duration <= 0 then
			return update_immediate_frames
		end
		if program.playback_mode == playback_loop
		and program.length > 0 then
			if not program.has_evaluation_work then
				return update_timed_loop_transport
			end
			if not program.requires_frame_sampling then
				return update_timed_loop
			end
		end
		return update_timed_frames
	end
	if program.duration_ms == nil then
		if not positioned then
			return update_continuous_unbounded_initial
		end
		return update_continuous_unbounded
	end
	local mode<const> = program.playback_mode
	if mode == playback_once then
		if not positioned then
			return update_continuous_once_initial
		end
		return update_continuous_once
	end
	if mode == playback_loop then
		if not positioned then
			return update_continuous_loop_initial
		end
		return update_continuous_loop
	end
	if not positioned then
		return update_continuous_pingpong_initial
	end
	return update_continuous_pingpong
end

function timeline.new(id, program)
	local self<const> = setmetatable({}, timeline)
	self.id = id
	self.program = program
	self.evaluate_play = program.evaluate_play
	self.duration_ms = program.duration_ms
	self.frame_duration = program.frame_duration
	self.last_frame = program.last_frame
	self.advance_frame = select_frame_advance(program)
	self.play_rate = 1
	bind_update(self, select_updater(program, false))
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
	self.evaluate_play = program.evaluate_play
	self.duration_ms = program.duration_ms
	self.frame_duration = program.frame_duration
	self.last_frame = program.last_frame
	self.advance_frame = select_frame_advance(program)
	bind_update(self, select_updater(program, self.head >= 0))
	self.wrapped = false
end

function timeline:set_play_rate(play_rate)
	self.play_rate = play_rate
	bind_update(self, select_updater(self.program, self.head >= 0))
end

function timeline:build(params)
	self:rebind_program(timeline_frame_program.build(self.program, params))
	self:rewind()
end

function timeline:value()
	return timeline_frame_program.value(self.program, self.head)
end

function timeline:rewind()
	bind_update(self, select_updater(self.program, false))
	self.head = timelinestart_index
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.direction = 1
	self.wrapped = false
end

function timeline:advance(owner)
	self.wrapped = false
	self.frame_elapsed = 0
	return self.advance_frame(self, owner)
end

local move_to<const> = function(self, owner, frame, evaluate)
	self.wrapped = false
	local program<const> = self.program
	local previous_frame<const> = self.head
	local current_frame<const> = clamp(frame, 0, program.last_frame)
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
	bind_update(self, select_updater(program, true))
	self.frame_elapsed = 0
	self.position_ms = time_ms
	self.ended = false
	evaluate(
		self,
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

function timeline:advance_to(owner, frame)
	return move_to(self, owner, frame, self.evaluate_play)
end

-- A seek reconstructs destination state. Event tracks remain play-only unless
-- they explicitly opt into swept seek dispatch with `fire_on_seek`.
function timeline:seek(owner, frame)
	return move_to(self, owner, frame, self.program.evaluate_jump)
end

local move_time<const> = function(self, owner, requested_time_ms, evaluate)
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
			frame = program.last_frame
		end
	end
	local direction = 0
	if time_ms > previous_time_ms then
		direction = 1
	elseif time_ms < previous_time_ms then
		direction = -1
	end
	self.head = frame
	bind_update(self, select_updater(program, true))
	if program.continuous then
		self.frame_elapsed = 0
	else
		self.frame_elapsed = time_ms - frame * program.frame_duration
	end
	self.position_ms = time_ms
	self.ended = false
	evaluate(
		self,
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
function timeline:advance_time_to(owner, time_ms)
	return move_time(self, owner, time_ms, self.evaluate_play)
end

function timeline:seek_time(owner, time_ms)
	return move_time(self, owner, time_ms, self.program.evaluate_jump)
end

function timeline:scrub_time(owner, time_ms)
	return move_time(self, owner, time_ms, self.program.evaluate_scrub)
end

function timeline:snap_to_start(owner)
	self.wrapped = false
	local previous_frame<const> = self.head
	local previous_time_ms<const> = self.position_ms
	local flags = sample_range_flags
	if previous_frame == timelinestart_index then
		flags = initial_sample_range_flags
	end
	self.head = 0
	bind_update(self, select_updater(self.program, true))
	self.frame_elapsed = 0
	self.position_ms = 0
	self.ended = false
	self.evaluate_play(
		self,
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
	self.head = clamp(frame, timelinestart_index, self.last_frame)
	self.frame_elapsed = 0
	if self.head < 0 then
		self.position_ms = 0
	else
		self.position_ms = self.head * self.frame_duration
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
