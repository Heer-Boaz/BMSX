local clamp<const> = require('cartlib/util/clamp')
local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_playback<const> = require('cartlib/timeline/playback')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local timeline<const> = timeline_module.timeline
local evaluation_flag<const> = timeline_playback.evaluation_flag
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial
local jump_update_method<const> = timeline_playback.update_method.jump

-- Nested clips retain child runtime entries, resolved binding slots and active
-- interval state under their parent entry. They never become ECS systems or
-- independently ticking timeline-component entries.
local sequence_evaluator<const> = {}

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

local first_boundary_after<const> = function(times, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if times[middle] <= time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

-- Arbitrary positioning establishes the chronological playback cursor and
-- returns the start-sorted prefix consumed by the overlap tree.
local position_sequence_cursors<const> = function(state, sequence, time_ms)
	state.next_boundary_index = first_boundary_after(
		sequence.boundary_times,
		sequence.boundary_count,
		time_ms
	)
	return first_start_after(sequence.clips_by_start, sequence.clip_count, time_ms)
end

-- Clip processing owns the inactive-to-active transition; this insertion path
-- therefore never rechecks state already represented by `initial`.
local activate_clip<const> = function(state, child_entry)
	state.candidate_snapshot_current = false
	local active_count<const> = state.active_count + 1
	state.active_count = active_count
	local active_index = active_count
	local active_entries<const> = state.active_entries
	local order<const> = child_entry.clip.order
	while active_index > 1 and active_entries[active_index - 1].clip.order > order do
		local moved_entry<const> = active_entries[active_index - 1]
		active_entries[active_index] = moved_entry
		moved_entry.active_index = active_index
		active_index = active_index - 1
	end
	active_entries[active_index] = child_entry
	child_entry.active_index = active_index
end

local remove_active_clip<const> = function(state, child_entry)
	local active_index<const> = child_entry.active_index
	if active_index == nil then
		return
	end
	state.candidate_snapshot_current = false
	local active_count<const> = state.active_count
	child_entry.active_index = nil
	local active_entries<const> = state.active_entries
	for index = active_index + 1, active_count do
		local moved_entry<const> = active_entries[index]
		active_entries[index - 1] = moved_entry
		moved_entry.active_index = index - 1
	end
	active_entries[active_count] = nil
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
		local child_entry<const> = state.active_entries[state.active_count]
		clear_child(child_entry, owner)
		remove_active_clip(state, child_entry)
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
		active_entries = {},
		active_count = 0,
		candidate_entries = {},
		candidate_generation = 0,
		candidate_count = 0,
		candidate_snapshot_current = false,
		active_runner_factories = sequence.active_runner_factories,
		active_runner = nil,
		position_tree_stack = {},
		next_boundary_index = 1,
		play_backward = nil,
	}
	entry.sequence_state = state
	for clip_index = 1, sequence.clip_count do
		local clip<const> = sequence.clips[clip_index]
		local child_program<const> = clip.program
		local child_entry<const> = {
			instance = timeline.new(entry.instance.id .. '/' .. clip.id, child_program),
			clip = clip,
			duration_ms = child_program.duration_ms,
			play_evaluator = child_program.evaluate_play,
		}
		if child_program.has_evaluation_callbacks or clip.on_loop ~= nil or clip.on_turn ~= nil then
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
				remove_active_clip(state, child_entry)
			end
			local child_program<const> = timeline_frame_program.build(clip.program, child_entry.params)
			child_entry.instance:rebind_program(child_program)
			child_entry.duration_ms = child_program.duration_ms
			child_entry.play_evaluator = child_program.evaluate_play
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

-- Parent direction changes are transport boundaries. Retain the selected clip
-- datapath on each child entry there, rather than resolving it through the
-- immutable clip record for every active child on every tick.
local bind_play_direction<const> = function(state, clip_count, backward)
	local entries<const> = state.entries
	if backward then
		for index = 1, clip_count do
			local child_entry<const> = entries[index]
			child_entry.play_transform = child_entry.clip.play_backward_transform
			child_entry.active_play_transform = child_entry.clip.active_play_backward_transform
		end
	else
		for index = 1, clip_count do
			local child_entry<const> = entries[index]
			child_entry.play_transform = child_entry.clip.play_forward_transform
			child_entry.active_play_transform = child_entry.clip.active_play_forward_transform
		end
	end
	state.play_backward = backward
end

local add_candidate<const> = function(state, child_entry)
	local generation<const> = state.candidate_generation
	if child_entry.active_index ~= nil or child_entry.candidate_generation == generation then
		return
	end
	child_entry.candidate_generation = generation
	state.candidate_snapshot_current = false
	local count<const> = state.candidate_count + 1
	state.candidate_count = count
	state.candidate_entries[count] = child_entry
end

-- Candidate iteration retains a snapshot because callbacks may mutate the live
-- active set. Stable active sets reuse it; admission and removal invalidate it.
local begin_candidates<const> = function(state)
	local generation<const> = state.candidate_generation + 1
	state.candidate_generation = generation
	local count<const> = state.active_count
	state.candidate_count = count
	if state.candidate_snapshot_current then
		return count
	end
	local active_entries<const> = state.active_entries
	local candidate_entries<const> = state.candidate_entries
	for index = 1, count do
		candidate_entries[index] = active_entries[index]
	end
	if count == 0 then
		state.active_runner = nil
	else
		state.active_runner = state.active_runner_factories[count](candidate_entries)
	end
	state.candidate_snapshot_current = true
	return count
end

local sort_candidates<const> = function(state, sorted_count)
	local candidate_entries<const> = state.candidate_entries
	for index = sorted_count + 1, state.candidate_count do
		local child_entry<const> = candidate_entries[index]
		local order<const> = child_entry.clip.order
		local insertion = index - 1
		while insertion > 0 and candidate_entries[insertion].clip.order > order do
			candidate_entries[insertion + 1] = candidate_entries[insertion]
			insertion = insertion - 1
		end
		candidate_entries[insertion + 1] = child_entry
	end
end

local process_position_clip<const> = function(
	state,
	owner,
	child_entry,
	previous_time_ms,
	time_ms,
	method
)
	local clip<const> = child_entry.clip
	local initial<const> = child_entry.active_index == nil
	local start_time_ms<const> = clip.start_time_ms
	local end_time_ms<const> = clip.end_time_ms
	local destination_active<const> = time_ms >= start_time_ms and time_ms < end_time_ms
	local source_time_ms = previous_time_ms
	if initial then
		source_time_ms = clamp(previous_time_ms, start_time_ms, end_time_ms)
	end
	local instance<const> = child_entry.instance
	local evaluate = instance.program.evaluate_scrub
	if method == jump_update_method then
		evaluate = instance.program.evaluate_jump
	end
	clip.position_transform(
		child_entry,
		owner,
		source_time_ms,
		time_ms,
		evaluate,
		initial
	)
	instance.ended = false
	if destination_active then
		if initial then
			activate_clip(state, child_entry)
		end
	else
		clear_child(child_entry, owner)
		remove_active_clip(state, child_entry)
	end
end

local evaluate_play_range<const> = function(
	sequence,
	entry,
	owner,
	previous_time_ms,
	time_ms,
	direction,
	initial
)
	local state<const> = entry.sequence_state
	local forward<const> = direction > 0
	local backward<const> = direction < 0
	if state.play_backward ~= backward then
		bind_play_direction(state, sequence.clip_count, backward)
	end
	-- Retained boundary cursors prove when the published candidate snapshot is
	-- still exact, so stable playback never opens a new candidate generation.
	if not initial and state.candidate_snapshot_current then
		local boundary_index<const> = state.next_boundary_index
		local boundary_times<const> = sequence.boundary_times
		if forward then
			if boundary_index > sequence.boundary_count
			or boundary_times[boundary_index] > time_ms then
				local active_runner<const> = state.active_runner
				if active_runner ~= nil then
					active_runner(owner, previous_time_ms, time_ms)
				end
				return
			end
		elseif backward then
			local previous_boundary_index<const> = boundary_index - 1
			if previous_boundary_index == 0
			or boundary_times[previous_boundary_index] <= time_ms then
				local active_runner<const> = state.active_runner
				if active_runner ~= nil then
					active_runner(owner, previous_time_ms, time_ms)
				end
				return
			end
		end
	end
	local sorted_candidate_count<const> = begin_candidates(state)
	if initial then
		position_sequence_cursors(state, sequence, previous_time_ms)
		for clip_index = 1, sequence.clip_count do
			local clip<const> = sequence.clips[clip_index]
			if previous_time_ms >= clip.start_time_ms and previous_time_ms < clip.end_time_ms then
				add_candidate(state, state.entries[clip_index])
			end
		end
	end
	if forward then
		local boundary_count<const> = sequence.boundary_count
		local boundary_times<const> = sequence.boundary_times
		local boundary_clip_indices<const> = sequence.boundary_clip_indices
		local index = state.next_boundary_index
		while index <= boundary_count and boundary_times[index] <= time_ms do
			local clip_index<const> = boundary_clip_indices[index]
			if clip_index > 0 then
				add_candidate(state, state.entries[clip_index])
			end
			index = index + 1
		end
		state.next_boundary_index = index
	elseif backward then
		local boundary_times<const> = sequence.boundary_times
		local boundary_clip_indices<const> = sequence.boundary_clip_indices
		local index = state.next_boundary_index - 1
		while index > 0 and boundary_times[index] > time_ms do
			local clip_index<const> = boundary_clip_indices[index]
			if clip_index < 0 then
				add_candidate(state, state.entries[-clip_index])
			end
			index = index - 1
		end
		state.next_boundary_index = index + 1
	end
	if state.candidate_count > sorted_candidate_count then
		sort_candidates(state, sorted_candidate_count)
	end
	-- Candidate admission guarantees that this range intersects each clip. Its
	-- monotonic direction determines the only interval edge it can cross. Keep
	-- that direction outside the candidate loop, as the boundary indexes above
	-- already do.
	local candidate_entries<const> = state.candidate_entries
	local candidate_count<const> = state.candidate_count
	if forward then
		for candidate_index = 1, candidate_count do
			local child_entry<const> = candidate_entries[candidate_index]
			local clip<const> = child_entry.clip
			local clip_initial<const> = child_entry.active_index == nil
			local source_time_ms = previous_time_ms
			if clip_initial then
				local start_time_ms<const> = clip.start_time_ms
				if source_time_ms < start_time_ms then
					source_time_ms = start_time_ms
				end
			end
			local destination_time_ms = time_ms
			local destination_active = true
			local end_time_ms<const> = clip.end_time_ms
			if destination_time_ms >= end_time_ms then
				destination_time_ms = end_time_ms
				destination_active = false
			end
			local child_timeline<const> = child_entry.instance
			if clip_initial then
				child_entry.play_transform(
					child_entry,
					owner,
					source_time_ms,
					destination_time_ms,
					true
				)
			else
				child_entry.active_play_transform(
					child_entry,
					owner,
					source_time_ms,
					destination_time_ms
				)
			end
			if destination_active then
				if clip_initial then
					child_timeline.ended = false
					activate_clip(state, child_entry)
				end
			else
				child_timeline.ended = true
				clear_child(child_entry, owner)
				remove_active_clip(state, child_entry)
				local on_finished<const> = clip.on_finished
				if on_finished ~= nil then
					on_finished(child_entry.primary_binding, child_timeline)
				end
			end
		end
	elseif backward then
		for candidate_index = 1, candidate_count do
			local child_entry<const> = candidate_entries[candidate_index]
			local clip<const> = child_entry.clip
			local clip_initial<const> = child_entry.active_index == nil
			local source_time_ms = previous_time_ms
			if clip_initial then
				local end_time_ms<const> = clip.end_time_ms
				if source_time_ms > end_time_ms then
					source_time_ms = end_time_ms
				end
			end
			local destination_time_ms = time_ms
			local destination_active = true
			local start_time_ms<const> = clip.start_time_ms
			if destination_time_ms < start_time_ms then
				destination_time_ms = start_time_ms
				destination_active = false
			end
			local child_timeline<const> = child_entry.instance
			if clip_initial then
				child_entry.play_transform(
					child_entry,
					owner,
					source_time_ms,
					destination_time_ms,
					true
				)
			else
				child_entry.active_play_transform(
					child_entry,
					owner,
					source_time_ms,
					destination_time_ms
				)
			end
			if destination_active then
				if clip_initial then
					child_timeline.ended = false
					activate_clip(state, child_entry)
				end
			else
				child_timeline.ended = true
				clear_child(child_entry, owner)
				remove_active_clip(state, child_entry)
				local on_finished<const> = clip.on_finished
				if on_finished ~= nil then
					on_finished(child_entry.primary_binding, child_timeline)
				end
			end
		end
	else
		for candidate_index = 1, candidate_count do
			local child_entry<const> = candidate_entries[candidate_index]
			local clip<const> = child_entry.clip
			local clip_initial<const> = child_entry.active_index == nil
			local child_timeline<const> = child_entry.instance
			if clip_initial then
				child_entry.play_transform(
					child_entry,
					owner,
					previous_time_ms,
					time_ms,
					true
				)
			else
				child_entry.active_play_transform(
					child_entry,
					owner,
					previous_time_ms,
					time_ms
				)
			end
			if clip_initial then
				child_timeline.ended = false
				activate_clip(state, child_entry)
			end
		end
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
	local position_clip_count<const> = position_sequence_cursors(state, sequence, time_ms) - 1
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
					add_candidate(state, state.entries[clips_by_start[low].order])
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
		local child_entry<const> = state.candidate_entries[candidate_index]
		local clip<const> = child_entry.clip
		if time_ms >= clip.start_time_ms and time_ms <= clip.end_time_ms then
			process_position_clip(
				state,
				owner,
				child_entry,
				previous_time_ms,
				time_ms,
				method
			)
		else
			clear_child(child_entry, owner)
			remove_active_clip(state, child_entry)
		end
	end
end

function sequence_evaluator.bind_play(program)
	local sequence<const> = program.subsequences
	local duration_ms<const> = program.duration_ms
	return function(entry, owner, previous_time_ms, time_ms, direction, flags)
		if flags & wrapped_flag ~= 0 then
			if direction > 0 then
				evaluate_play_range(
					sequence,
					entry,
					owner,
					previous_time_ms,
					duration_ms,
					direction,
					flags & initial_flag ~= 0
				)
				clear_active_clips(entry, owner)
				evaluate_play_range(sequence, entry, owner, 0, time_ms, direction, true)
			else
				evaluate_play_range(
					sequence,
					entry,
					owner,
					previous_time_ms,
					0,
					direction,
					flags & initial_flag ~= 0
				)
				clear_active_clips(entry, owner)
				evaluate_play_range(sequence, entry, owner, duration_ms, time_ms, direction, true)
			end
			return
		end
		evaluate_play_range(
			sequence,
			entry,
			owner,
			previous_time_ms,
			time_ms,
			direction,
			flags & initial_flag ~= 0
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
