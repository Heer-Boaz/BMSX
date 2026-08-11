local clamp<const> = require('cartlib/util/clamp')
local timeline_dispatch<const> = require('cartlib/timeline/dispatch')
local timeline_program<const> = require('cartlib/timeline/program')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_track_evaluator<const> = require('cartlib/timeline/track_evaluator')
local timeline<const> = timeline_module.timeline
local play_update_method<const> = timeline_module.update_method.play

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

local activate_clip<const> = function(state, clip_index)
	if state.active_index_by_clip[clip_index] ~= nil then
		return
	end
	local active_count<const> = state.active_count + 1
	state.active_count = active_count
	local active_index = active_count
	while active_index > 1 and state.active_clips[active_index - 1] > clip_index do
		local moved_clip_index<const> = state.active_clips[active_index - 1]
		state.active_clips[active_index] = moved_clip_index
		state.active_index_by_clip[moved_clip_index] = active_index
		active_index = active_index - 1
	end
	state.active_clips[active_index] = clip_index
	state.active_index_by_clip[clip_index] = active_index
end

local remove_active_clip<const> = function(state, clip_index)
	local active_index<const> = state.active_index_by_clip[clip_index]
	if active_index == nil then
		return
	end
	local active_count<const> = state.active_count
	state.active_index_by_clip[clip_index] = nil
	for index = active_index + 1, active_count do
		local moved_clip_index<const> = state.active_clips[index]
		state.active_clips[index - 1] = moved_clip_index
		state.active_index_by_clip[moved_clip_index] = index - 1
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
		clear_child(state.entries[clip_index], owner)
		remove_active_clip(state, clip_index)
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
		active_index_by_clip = {},
		active_count = 0,
		candidates = {},
		candidate_marks = {},
		candidate_generation = 0,
		candidate_count = 0,
	}
	entry.sequence_state = state
	for clip_index = 1, sequence.clip_count do
		local clip<const> = sequence.clips[clip_index]
		local child_program<const> = clip.program
		local child_entry<const> = {
			instance = timeline.new(entry.instance.id .. '/' .. clip.id, child_program),
		}
		if child_program.binding_count > 1 then
			child_entry.bindings = {}
		end
		state.entries[clip_index] = child_entry
		bind_child(entry, child_entry, clip)
		timeline_dispatch.init_entry(child_entry)
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
			if state.active_index_by_clip[clip_index] ~= nil then
				clear_child(child_entry, owner)
				remove_active_clip(state, clip_index)
			end
			child_entry.instance:rebind_program(timeline_program.build(clip.program, child_entry.params))
			child_entry.instance:rewind()
			timeline_dispatch.init_entry(child_entry)
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
	if state.candidate_marks[clip_index] == generation then
		return
	end
	state.candidate_marks[clip_index] = generation
	local count<const> = state.candidate_count + 1
	state.candidate_count = count
	state.candidates[count] = clip_index
end

local begin_candidates<const> = function(state)
	state.candidate_generation = state.candidate_generation + 1
	state.candidate_count = 0
end

local sort_candidates<const> = function(state)
	local candidates<const> = state.candidates
	for index = 2, state.candidate_count do
		local clip_index<const> = candidates[index]
		local insertion = index - 1
		while insertion > 0 and candidates[insertion] > clip_index do
			candidates[insertion + 1] = candidates[insertion]
			insertion = insertion - 1
		end
		candidates[insertion + 1] = clip_index
	end
end

local process_clip<const> = function(
	entry,
	owner,
	clip_index,
	previous_time_ms,
	time_ms,
	method,
	on_evaluation
)
	local sequence<const> = entry.instance.program.subsequences
	local clip<const> = sequence.clips[clip_index]
	local state<const> = entry.sequence_state
	local child_entry<const> = state.entries[clip_index]
	local initial<const> = state.active_index_by_clip[clip_index] == nil
	local source_time_ms<const> = clamp(previous_time_ms, clip.start_time_ms, clip.end_time_ms)
	local destination_time_ms<const> = clamp(time_ms, clip.start_time_ms, clip.end_time_ms)
	local destination_active<const> = time_ms >= clip.start_time_ms and time_ms < clip.end_time_ms
	child_entry.instance:evaluate_clip_range(
		clip,
		source_time_ms,
		destination_time_ms,
		method,
		initial,
		method == play_update_method and not destination_active
	)
	timeline_dispatch.process_instance_evaluations(child_entry, owner, on_evaluation)
	if destination_active then
		activate_clip(state, clip_index)
	else
		clear_child(child_entry, owner)
		remove_active_clip(state, clip_index)
	end
end

local evaluate_play_range<const> = function(entry, owner, previous_time_ms, time_ms, initial, on_evaluation)
	local sequence<const> = entry.instance.program.subsequences
	local state<const> = entry.sequence_state
	local direction = 0
	if time_ms > previous_time_ms then
		direction = 1
	elseif time_ms < previous_time_ms then
		direction = -1
	end
	begin_candidates(state)
	for active_index = 1, state.active_count do
		add_candidate(state, state.active_clips[active_index])
	end
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
	sort_candidates(state)
	for index = 1, state.candidate_count do
		process_clip(
			entry,
			owner,
			state.candidates[index],
			previous_time_ms,
			time_ms,
			play_update_method,
			on_evaluation
		)
	end
end

local evaluate_at<const> = function(entry, owner, previous_time_ms, time_ms, method, on_evaluation)
	local sequence<const> = entry.instance.program.subsequences
	local state<const> = entry.sequence_state
	for clip_index = 1, sequence.clip_count do
		local clip<const> = sequence.clips[clip_index]
		if time_ms >= clip.start_time_ms and time_ms <= clip.end_time_ms then
			process_clip(
				entry,
				owner,
				clip_index,
				previous_time_ms,
				time_ms,
				method,
				on_evaluation
			)
		elseif state.active_index_by_clip[clip_index] ~= nil then
			clear_child(state.entries[clip_index], owner)
			remove_active_clip(state, clip_index)
		end
	end
end

function sequence_evaluator.evaluate(entry, owner, evaluation, on_evaluation)
	local sequence<const> = entry.instance.program.subsequences
	if sequence.clip_count == 0 then
		return
	end
	if evaluation.method ~= play_update_method then
		evaluate_at(
			entry,
			owner,
			evaluation.previous_time_ms,
			evaluation.time_ms,
			evaluation.method,
			on_evaluation
		)
		return
	end
	if evaluation.wrapped then
		local duration_ms<const> = entry.instance.program.duration_ms
		if evaluation.direction > 0 then
			evaluate_play_range(
				entry,
				owner,
				evaluation.previous_time_ms,
				duration_ms,
				evaluation.initial,
				on_evaluation
			)
			clear_active_clips(entry, owner)
			evaluate_play_range(entry, owner, 0, evaluation.time_ms, true, on_evaluation)
		else
			evaluate_play_range(
				entry,
				owner,
				evaluation.previous_time_ms,
				0,
				evaluation.initial,
				on_evaluation
			)
			clear_active_clips(entry, owner)
			evaluate_play_range(entry, owner, duration_ms, evaluation.time_ms, true, on_evaluation)
		end
		return
	end
	evaluate_play_range(
		entry,
		owner,
		evaluation.previous_time_ms,
		evaluation.time_ms,
		evaluation.initial or evaluation.previous_frame < 0,
		on_evaluation
	)
end

function sequence_evaluator.sync_entry(entry, owner, time_ms, on_evaluation)
	if entry.instance.program.subsequences.clip_count > 0 then
		evaluate_at(entry, owner, time_ms, time_ms, timeline_module.update_method.jump, on_evaluation)
	end
end

return sequence_evaluator
