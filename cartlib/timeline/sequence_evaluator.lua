local clamp<const> = require('cartlib/util/clamp')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_playback<const> = require('cartlib/timeline/playback')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local timeline<const> = timeline_module.timeline
local playback_boundary<const> = timeline_playback.boundary
local boundary_loop<const> = playback_boundary.loop
local boundary_turn<const> = playback_boundary.turn
local evaluation_flag<const> = timeline_playback.evaluation_flag
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial

-- Nested clips retain child runtime entries, resolved binding slots and active
-- interval state under their parent entry. They never become ECS systems or
-- independently ticking timeline-component entries.
local sequence_evaluator<const> = {}

local notify_loop<const> = function(clip, target, evaluation)
	if evaluation.boundary == boundary_loop then
		clip.on_loop(target, evaluation)
	end
end

local notify_turn<const> = function(clip, target, evaluation)
	if evaluation.boundary == boundary_turn then
		clip.on_turn(target, evaluation)
	end
end

local notify_loop_or_turn<const> = function(clip, target, evaluation)
	local boundary<const> = evaluation.boundary
	if boundary == boundary_loop then
		clip.on_loop(target, evaluation)
	elseif boundary == boundary_turn then
		clip.on_turn(target, evaluation)
	end
end

local first_start_after<const> = function(clips, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if clips[middle].start_time_ms <= time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local first_end_after<const> = function(clips, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if clips[middle].end_time_ms <= time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local activate_clip<const> = function(state, clip_index, child_entry)
	if child_entry.active_index ~= nil then
		return
	end
	local active_count<const> = state.active_count + 1
	state.active_count = active_count
	local active_index = active_count
	local entries<const> = state.entries
	while active_index > 1 and state.active_clips[active_index - 1] > clip_index do
		local moved_clip_index<const> = state.active_clips[active_index - 1]
		state.active_clips[active_index] = moved_clip_index
		entries[moved_clip_index].active_index = active_index
		active_index = active_index - 1
	end
	state.active_clips[active_index] = clip_index
	child_entry.active_index = active_index
end

local remove_active_clip<const> = function(state, clip_index, child_entry)
	local active_index<const> = child_entry.active_index
	if active_index == nil then
		return
	end
	local active_count<const> = state.active_count
	child_entry.active_index = nil
	local entries<const> = state.entries
	for index = active_index + 1, active_count do
		local moved_clip_index<const> = state.active_clips[index]
		state.active_clips[index - 1] = moved_clip_index
		entries[moved_clip_index].active_index = index - 1
	end
	state.active_clips[active_count] = nil
	state.active_count = active_count - 1
end

local bind_child<const> = function(parent_entry, child_entry, clip)
	local params = clip.params
	if params == nil then
		params = clip.program.default_params
		if params == nil then
			params = parent_entry.params
		end
	end
	child_entry.params = params
	local binding_indices<const> = clip.binding_indices
	local parent_binding_index<const> = binding_indices[1]
	if parent_binding_index == 1 then
		child_entry.primary_binding = parent_entry.primary_binding
	elseif parent_entry.bindings ~= nil then
		child_entry.primary_binding = parent_entry.bindings[parent_binding_index]
	else
		child_entry.primary_binding = nil
	end
	local child_program<const> = child_entry.instance.program
	if child_program.binding_count == 1 then
		return
	end
	local bindings<const> = child_entry.bindings
	bindings[1] = child_entry.primary_binding
	for binding_index = 2, child_program.binding_count do
		local parent_index<const> = binding_indices[binding_index]
		if parent_index == 1 then
			bindings[binding_index] = parent_entry.primary_binding
		elseif parent_entry.bindings ~= nil then
			bindings[binding_index] = parent_entry.bindings[parent_index]
		else
			bindings[binding_index] = nil
		end
	end
end

local clear_child<const> = function(child_entry, owner)
	timeline_track_evaluator.clear_tags(child_entry, owner)
	sequence_evaluator.clear_entry(child_entry, owner)
end

local clear_active_clips<const> = function(entry, owner)
	local state<const> = entry.sequence_state
	while state.active_count > 0 do
		local clip_index<const> = state.active_clips[state.active_count]
		local child_entry<const> = state.entries[clip_index]
		clear_child(child_entry, owner)
		remove_active_clip(state, clip_index, child_entry)
	end
end

function sequence_evaluator.init_entry(entry)
	local sequence<const> = entry.instance.program.subsequences
	if sequence.clip_count == 0 then
		entry.sequence_state = nil
		return
	end
	local state<const> = {
		entries = {},
		active_clips = {},
		active_count = 0,
		candidates = {},
		candidate_generation = 0,
		candidate_count = 0,
		position_tree_stack = {},
	}
	entry.sequence_state = state
	for clip_index = 1, sequence.clip_count do
		local clip<const> = sequence.clips[clip_index]
		local child_program<const> = clip.program
		local child_entry<const> = {
			instance = timeline.new(entry.instance.id .. '/' .. clip.id, child_program),
			clip = clip,
			duration_ms = child_program.duration_ms,
		}
		if clip.on_loop ~= nil then
			if clip.on_turn ~= nil then
				child_entry.notify_boundary = notify_loop_or_turn
			else
				child_entry.notify_boundary = notify_loop
			end
		elseif clip.on_turn ~= nil then
			child_entry.notify_boundary = notify_turn
		end
		if child_program.has_evaluation_callbacks or child_entry.notify_boundary ~= nil then
			child_entry.evaluation_context = {}
		end
		if child_program.binding_count > 1 then
			child_entry.bindings = {}
		end
		state.entries[clip_index] = child_entry
		bind_child(entry, child_entry, clip)
		timeline_track_evaluator.init_entry(child_entry)
		sequence_evaluator.init_entry(child_entry)
	end
end

function sequence_evaluator.bind_entry(entry, owner)
	local sequence<const> = entry.instance.program.subsequences
	if sequence.clip_count == 0 then
		return
	end
	local state<const> = entry.sequence_state
	for clip_index = 1, sequence.clip_count do
		local clip<const> = sequence.clips[clip_index]
		local child_entry<const> = state.entries[clip_index]
		bind_child(entry, child_entry, clip)
		if clip.program.frame_builder ~= nil then
			if child_entry.active_index ~= nil then
				clear_child(child_entry, owner)
				remove_active_clip(state, clip_index, child_entry)
			end
			local child_program<const> = timeline_frame_program.build(clip.program, child_entry.params)
			child_entry.instance:rebind_program(child_program)
			child_entry.duration_ms = child_program.duration_ms
			child_entry.instance:rewind()
			timeline_track_evaluator.init_entry(child_entry)
			sequence_evaluator.init_entry(child_entry)
		else
			sequence_evaluator.bind_entry(child_entry, owner)
		end
	end
end

function sequence_evaluator.clear_entry(entry, owner)
	if entry.sequence_state ~= nil then
		clear_active_clips(entry, owner)
	end
end

local add_candidate<const> = function(state, clip_index)
	local generation<const> = state.candidate_generation
	local child_entry<const> = state.entries[clip_index]
	if child_entry.active_index ~= nil or child_entry.candidate_generation == generation then
		return
	end
	child_entry.candidate_generation = generation
	local count<const> = state.candidate_count + 1
	state.candidate_count = count
	state.candidates[count] = clip_index
end

-- active_clips is retained in authored clip order. Copy that ordered prefix
-- directly; only clips appended by the evaluated range need insertion sorting.
local begin_candidates<const> = function(state)
	local generation<const> = state.candidate_generation + 1
	state.candidate_generation = generation
	local count<const> = state.active_count
	state.candidate_count = count
	local active_clips<const> = state.active_clips
	local candidates<const> = state.candidates
	for index = 1, count do
		candidates[index] = active_clips[index]
	end
	return count
end

local sort_candidates<const> = function(state, sorted_count)
	local candidates<const> = state.candidates
	for index = sorted_count + 1, state.candidate_count do
		local clip_index<const> = candidates[index]
		local insertion = index - 1
		while insertion > 0 and candidates[insertion] > clip_index do
			candidates[insertion + 1] = candidates[insertion]
			insertion = insertion - 1
		end
		candidates[insertion + 1] = clip_index
	end
end

-- Candidate admission guarantees that a play range intersects the clip. Its
-- monotonic direction therefore determines the only interval edge it can
-- cross; positioning remains the owner of arbitrary destination clamping.
local process_play_clip<const> = function(
	state,
	owner,
	clip_index,
	previous_time_ms,
	time_ms,
	direction
)
	local child_entry<const> = state.entries[clip_index]
	local clip<const> = child_entry.clip
	local initial<const> = child_entry.active_index == nil
	local start_time_ms<const> = clip.start_time_ms
	local end_time_ms<const> = clip.end_time_ms
	local source_time_ms = previous_time_ms
	local destination_time_ms = time_ms
	local destination_active = true
	if direction > 0 then
		if initial and source_time_ms < start_time_ms then
			source_time_ms = start_time_ms
		end
		if destination_time_ms >= end_time_ms then
			destination_time_ms = end_time_ms
			destination_active = false
		end
	elseif direction < 0 then
		if initial and source_time_ms > end_time_ms then
			source_time_ms = end_time_ms
		end
		if destination_time_ms < start_time_ms then
			destination_time_ms = start_time_ms
			destination_active = false
		end
	end
	local child_timeline<const> = child_entry.instance
	child_timeline:evaluate_clip_play_range(
		child_entry,
		owner,
		clip,
		source_time_ms,
		destination_time_ms,
		direction,
		initial,
		not destination_active
	)
	if destination_active then
		activate_clip(state, clip_index, child_entry)
	else
		clear_child(child_entry, owner)
		remove_active_clip(state, clip_index, child_entry)
		local on_finished<const> = clip.on_finished
		if on_finished ~= nil then
			on_finished(child_entry.primary_binding, child_timeline)
		end
	end
end

local process_position_clip<const> = function(
	state,
	owner,
	clip_index,
	previous_time_ms,
	time_ms,
	method
)
	local child_entry<const> = state.entries[clip_index]
	local clip<const> = child_entry.clip
	local initial<const> = child_entry.active_index == nil
	local start_time_ms<const> = clip.start_time_ms
	local end_time_ms<const> = clip.end_time_ms
	local destination_active<const> = time_ms >= start_time_ms and time_ms < end_time_ms
	local source_time_ms = previous_time_ms
	if initial then
		source_time_ms = clamp(previous_time_ms, start_time_ms, end_time_ms)
	end
	child_entry.instance:evaluate_clip_at(
		child_entry,
		owner,
		clip,
		source_time_ms,
		time_ms,
		method,
		initial
	)
	if destination_active then
		activate_clip(state, clip_index, child_entry)
	else
		clear_child(child_entry, owner)
		remove_active_clip(state, clip_index, child_entry)
	end
end

local evaluate_play_range<const> = function(sequence, entry, owner, previous_time_ms, time_ms, initial)
	local state<const> = entry.sequence_state
	local direction = 0
	if time_ms > previous_time_ms then
		direction = 1
	elseif time_ms < previous_time_ms then
		direction = -1
	end
	local sorted_candidate_count<const> = begin_candidates(state)
	if initial then
		for clip_index = 1, sequence.clip_count do
			local clip<const> = sequence.clips[clip_index]
			if previous_time_ms >= clip.start_time_ms and previous_time_ms < clip.end_time_ms then
				add_candidate(state, clip_index)
			end
		end
	end
	if direction > 0 then
		local clips<const> = sequence.clips_by_start
		local first<const> = first_start_after(clips, sequence.clip_count, previous_time_ms)
		local finish<const> = first_start_after(clips, sequence.clip_count, time_ms) - 1
		for index = first, finish do
			add_candidate(state, clips[index].order)
		end
	elseif direction < 0 then
		local clips<const> = sequence.clips_by_end
		local first<const> = first_end_after(clips, sequence.clip_count, time_ms)
		local finish<const> = first_end_after(clips, sequence.clip_count, previous_time_ms) - 1
		for index = first, finish do
			add_candidate(state, clips[index].order)
		end
	end
	if state.candidate_count > sorted_candidate_count then
		sort_candidates(state, sorted_candidate_count)
	end
	for index = 1, state.candidate_count do
		process_play_clip(
			state,
			owner,
			state.candidates[index],
			previous_time_ms,
			time_ms,
			direction
		)
	end
end

local evaluate_position<const> = function(
	sequence,
	entry,
	owner,
	previous_time_ms,
	time_ms,
	method
)
	local state<const> = entry.sequence_state
	local sorted_candidate_count<const> = begin_candidates(state)

	local clips_by_start<const> = sequence.clips_by_start
	local position_clip_count<const> = first_start_after(clips_by_start, sequence.clip_count, time_ms) - 1
	if position_clip_count > 0 then
		local stack<const> = state.position_tree_stack
		local stack_count = 3
		stack[1] = 1
		stack[2] = 1
		stack[3] = sequence.position_tree_leaf_count
		local max_end_time_ms<const> = sequence.position_tree_max_end_time_ms
		while stack_count > 0 do
			local high<const> = stack[stack_count]
			local low<const> = stack[stack_count - 1]
			local node_index<const> = stack[stack_count - 2]
			stack_count = stack_count - 3
			if low <= position_clip_count and max_end_time_ms[node_index] >= time_ms then
				if low == high then
					add_candidate(state, clips_by_start[low].order)
				else
					local middle<const> = (low + high) // 2
					local left_node_index<const> = node_index * 2
					local right_stack_index<const> = stack_count + 1
					stack[right_stack_index] = left_node_index + 1
					stack[right_stack_index + 1] = middle + 1
					stack[right_stack_index + 2] = high
					local left_stack_index<const> = right_stack_index + 3
					stack[left_stack_index] = left_node_index
					stack[left_stack_index + 1] = low
					stack[left_stack_index + 2] = middle
					stack_count = stack_count + 6
				end
			end
		end
	end

	if state.candidate_count > sorted_candidate_count then
		sort_candidates(state, sorted_candidate_count)
	end
	for candidate_index = 1, state.candidate_count do
		local clip_index<const> = state.candidates[candidate_index]
		local clip<const> = sequence.clips[clip_index]
		if time_ms >= clip.start_time_ms and time_ms <= clip.end_time_ms then
			process_position_clip(
				state,
				owner,
				clip_index,
				previous_time_ms,
				time_ms,
				method
			)
		else
			local child_entry<const> = state.entries[clip_index]
			clear_child(child_entry, owner)
			remove_active_clip(state, clip_index, child_entry)
		end
	end
end

function sequence_evaluator.bind_play(program)
	local sequence<const> = program.subsequences
	local duration_ms<const> = program.duration_ms
	return function(entry, owner, previous_frame, previous_time_ms, time_ms, direction, flags)
		if flags & wrapped_flag ~= 0 then
			if direction > 0 then
				evaluate_play_range(
					sequence,
					entry,
					owner,
					previous_time_ms,
					duration_ms,
					flags & initial_flag ~= 0
				)
				clear_active_clips(entry, owner)
				evaluate_play_range(sequence, entry, owner, 0, time_ms, true)
			else
				evaluate_play_range(
					sequence,
					entry,
					owner,
					previous_time_ms,
					0,
					flags & initial_flag ~= 0
				)
				clear_active_clips(entry, owner)
				evaluate_play_range(sequence, entry, owner, duration_ms, time_ms, true)
			end
			return
		end
		evaluate_play_range(
			sequence,
			entry,
			owner,
			previous_time_ms,
			time_ms,
			flags & initial_flag ~= 0 or previous_frame < 0
		)
	end
end

function sequence_evaluator.bind_position(program, method)
	local sequence<const> = program.subsequences
	return function(entry, owner, previous_time_ms, time_ms)
		evaluate_position(
			sequence,
			entry,
			owner,
			previous_time_ms,
			time_ms,
			method
		)
	end
end

function sequence_evaluator.sync_entry(entry, owner, time_ms)
	local sequence<const> = entry.instance.program.subsequences
	if sequence.clip_count > 0 then
		evaluate_position(sequence, entry, owner, time_ms, time_ms, timeline_playback.update_method.jump)
	end
end

return sequence_evaluator
