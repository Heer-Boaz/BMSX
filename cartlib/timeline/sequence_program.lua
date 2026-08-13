-- Nested sequence definitions are admitted into immutable clip records. The
-- runtime consumes dense binding maps and boundary-sorted clip references.
local timeline_time_transform<const> = require('cartlib/timeline/time_transform')

local sequence_program<const> = {}
local empty_clips<const> = {}
sequence_program.empty = {
	clips = empty_clips,
	clips_by_start = empty_clips,
	clips_by_end = empty_clips,
	position_tree_max_end_time_ms = empty_clips,
	position_tree_leaf_count = 0,
	clip_count = 0,
	duration_ms = 0,
}

-- Child programs, binding slots and parent-time transforms are resolved during
-- admission. Runtime traversal consumes only these dense clip records.

local compare_start<const> = function(left, right)
	if left.start_time_ms == right.start_time_ms then
		return left.order < right.order
	end
	return left.start_time_ms < right.start_time_ms
end

local compare_end<const> = function(left, right)
	if left.end_time_ms == right.end_time_ms then
		return left.order < right.order
	end
	return left.end_time_ms < right.end_time_ms
end

function sequence_program.compile(definitions, parent_binding_index_by_id, playback_mode_by_name, compile_timeline)
	if #definitions == 0 then
		return sequence_program.empty
	end
	local clips<const> = {}
	local clips_by_start<const> = {}
	local clips_by_end<const> = {}
	local duration_ms = 0
	for index = 1, #definitions do
		local definition<const> = definitions[index]
		local program<const> = compile_timeline(definition.sequence)
		local binding_overrides<const> = definition.bindings
		local binding_indices<const> = {}
		for binding_index = 1, program.binding_count do
			local child_binding_id<const> = program.binding_ids[binding_index]
			local parent_binding_id = child_binding_id
			if binding_overrides ~= nil and binding_overrides[child_binding_id] ~= nil then
				parent_binding_id = binding_overrides[child_binding_id]
			end
			binding_indices[binding_index] = parent_binding_index_by_id[parent_binding_id]
		end
		local start_time_ms<const> = definition.start_time_ms or 0
		local end_time_ms<const> = start_time_ms + definition.duration_ms
		local clip_in_ms<const> = definition.clip_in_ms or 0
		local time_scale<const> = definition.time_scale or 1
		local playback_mode<const> = playback_mode_by_name[definition.playback_mode or 'once']
		local play_transform<const>, position_transform<const> = timeline_time_transform.compile(playback_mode)
		local direction = 1
		if time_scale < 0 then
			direction = -1
		end
		local clip<const> = {
			id = definition.id,
			order = index,
			start_time_ms = start_time_ms,
			end_time_ms = end_time_ms,
			time_scale = time_scale,
			time_offset_ms = clip_in_ms - start_time_ms * time_scale,
			direction = direction,
			play_transform = play_transform,
			position_transform = position_transform,
			program = program,
			binding_indices = binding_indices,
			params = definition.params,
			on_loop = definition.on_loop,
			on_turn = definition.on_turn,
			on_finished = definition.on_finished,
		}
		clips[index] = clip
		clips_by_start[index] = clip
		clips_by_end[index] = clip
		if end_time_ms > duration_ms then
			duration_ms = end_time_ms
		end
	end
	table.sort(clips_by_start, compare_start)
	table.sort(clips_by_end, compare_end)

	-- Positioning can jump directly to any parent time. A flat max-end tree over
	-- start-sorted clips finds every overlapping clip without copying active
	-- sets into each time span. Runtime queries use retained entry scratch.
	local clip_count<const> = #clips
	local position_tree_leaf_count = 1
	while position_tree_leaf_count < clip_count do
		position_tree_leaf_count = position_tree_leaf_count * 2
	end
	local position_tree_max_end_time_ms<const> = {}
	for index = 1, clip_count do
		position_tree_max_end_time_ms[position_tree_leaf_count + index - 1] = clips_by_start[index].end_time_ms
	end
	for node_index = position_tree_leaf_count - 1, 1, -1 do
		local left_index<const> = node_index * 2
		local left_max<const> = position_tree_max_end_time_ms[left_index]
		local right_max<const> = position_tree_max_end_time_ms[left_index + 1]
		if right_max == nil or left_max > right_max then
			position_tree_max_end_time_ms[node_index] = left_max
		else
			position_tree_max_end_time_ms[node_index] = right_max
		end
	end
	return {
		clips = clips,
		clips_by_start = clips_by_start,
		clips_by_end = clips_by_end,
		position_tree_max_end_time_ms = position_tree_max_end_time_ms,
		position_tree_leaf_count = position_tree_leaf_count,
		clip_count = clip_count,
		duration_ms = duration_ms,
	}
end

return sequence_program
