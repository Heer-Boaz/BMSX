local timeline_apply<const> = {}
local format<const> = string.format

local append_path<const> = function(parts, root, path)
	parts[#parts + 1] = root
	for index = 1, #path do
		local key<const> = path[index]
		parts[#parts + 1] = '['
		parts[#parts + 1] = type(key) == 'number' and key or format('%q', key)
		parts[#parts + 1] = ']'
	end
end

local append_frame_assignments
append_frame_assignments = function(parts, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			append_frame_assignments(parts, value, path)
		else
			append_path(parts, 'target', path)
			parts[#parts + 1] = ' = '
			append_path(parts, 'frame', path)
			parts[#parts + 1] = '\n'
		end
		path[path_index] = nil
	end
end

local compile_frame_apply<const> = function(frame, shape_cache)
	local parts<const> = { 'return function(target, frame)\n' }
	append_frame_assignments(parts, frame, {})
	parts[#parts + 1] = 'end'
	local source<const> = table.concat(parts)
	local apply_frame = shape_cache[source]
	if apply_frame == nil then
		apply_frame = load(source, '[timeline.apply.frame]', 't')()
		shape_cache[source] = apply_frame
	end
	return apply_frame
end

function timeline_apply.compile_frames(frames)
	local frame_appliers<const> = {}
	local applier_by_frame<const> = {}
	local shape_cache<const> = {}
	for i = 1, #frames do
		local frame<const> = frames[i]
		local apply_frame = applier_by_frame[frame]
		if apply_frame == nil then
			apply_frame = compile_frame_apply(frame, shape_cache)
			applier_by_frame[frame] = apply_frame
		end
		frame_appliers[i] = apply_frame
	end
	return frame_appliers
end

function timeline_apply.compile_setter(path)
	local parts<const> = { 'return function(target, value)\n' }
	append_path(parts, 'target', path)
	parts[#parts + 1] = ' = value\nend'
	return load(table.concat(parts), '[timeline.apply.setter]', 't')()
end

local append_scalar_track<const> = function(
	parts,
	track_list_name,
	track_index,
	track,
	position_key,
	cubic
)
	local track_expression<const> = 'channels['
		.. format('%q', track_list_name)
		.. '][' .. tostring(track_index) .. ']'
	if track.apply ~= nil then
		parts[#parts + 1] = 'track = '
		parts[#parts + 1] = track_expression
		parts[#parts + 1] = '\nkeys = track["keys"]\n'
	else
		parts[#parts + 1] = 'keys = '
		parts[#parts + 1] = track_expression
		parts[#parts + 1] = '["keys"]\n'
	end
	local key_count<const> = #track.keys
	if key_count == 1 then
		parts[#parts + 1] = 'value = keys[1]["value"]\n'
	else
		parts[#parts + 1] = 'first_key = keys[1]\n'
		parts[#parts + 1] = 'if position <= first_key['
		parts[#parts + 1] = format('%q', position_key)
		parts[#parts + 1] = '] then\nvalue = first_key["value"]\nelse\n'
		parts[#parts + 1] = 'last_key = keys['
		parts[#parts + 1] = key_count
		parts[#parts + 1] = ']\nif position >= last_key['
		parts[#parts + 1] = format('%q', position_key)
		parts[#parts + 1] = '] then\nvalue = last_key["value"]\nelse\n'
		if key_count == 2 then
			parts[#parts + 1] = 'key = first_key\n'
		else
			parts[#parts + 1] = 'low = 1\nhigh = '
			parts[#parts + 1] = key_count + 1
			parts[#parts + 1] = '\nwhile low < high do\nmiddle = (low + high) // 2\nif keys[middle]['
			parts[#parts + 1] = format('%q', position_key)
			parts[#parts + 1] = '] <= position then\nlow = middle + 1\nelse\nhigh = middle\nend\nend\nkey = keys[low - 1]\n'
		end
		if cubic then
			parts[#parts + 1] = 'u = (position - key['
			parts[#parts + 1] = format('%q', position_key)
			parts[#parts + 1] = ']) * key["span_inv"]\nvalue = ((key["cubic3"] * u + key["cubic2"]) * u + key["cubic1"]) * u + key["value"]\n'
		else
			parts[#parts + 1] = 'value = key["value"] + key["value_delta"] * ((position - key['
			parts[#parts + 1] = format('%q', position_key)
			parts[#parts + 1] = ']) * key["span_inv"])\n'
		end
		parts[#parts + 1] = 'end\nend\n'
	end
	local binding_expression
	if track.binding_index == 1 then
		binding_expression = 'primary_binding'
	else
		binding_expression = 'bindings[' .. tostring(track.binding_index) .. ']'
	end
	if track.apply ~= nil then
		parts[#parts + 1] = 'track["apply"]('
		parts[#parts + 1] = binding_expression
		parts[#parts + 1] = ', value, params, evaluation)\n'
	else
		append_path(parts, binding_expression, track.path)
		parts[#parts + 1] = ' = value\n'
	end
end

local append_scalar_lane<const> = function(
	parts,
	track_list_name,
	definitions,
	interpolation,
	time_domain,
	position_key,
	cubic
)
	local has_callback = false
	local has_primary_binding = false
	local has_secondary_binding = false
	local max_key_count = 0
	local track_index = 0
	for definition_index = 1, #definitions do
		local track<const> = definitions[definition_index]
		if track.interpolation == interpolation
		and (track.keys[1].time_ms ~= nil) == time_domain then
			track_index = track_index + 1
			if track.apply ~= nil then
				has_callback = true
			end
			if track.binding_index == 1 then
				has_primary_binding = true
			else
				has_secondary_binding = true
			end
			local key_count<const> = #track.keys
			if key_count > max_key_count then
				max_key_count = key_count
			end
			append_scalar_track(
				parts,
				track_list_name,
				track_index,
				track,
				position_key,
				cubic
			)
		end
	end
	return has_callback,
		has_primary_binding,
		has_secondary_binding,
		max_key_count
end

function timeline_apply.compile_scalar_runner(definitions)
	local has_callback = false
	local has_primary_binding = false
	local has_secondary_binding = false
	local max_key_count = 0
	local has_frame_tracks = false
	local has_time_tracks = false
	local has_cubic_tracks = false
	for index = 1, #definitions do
		local definition<const> = definitions[index]
		if definition.keys[1].time_ms ~= nil then
			has_time_tracks = true
		else
			has_frame_tracks = true
		end
		if definition.interpolation == 'cubic' then
			has_cubic_tracks = true
		end
	end
	local parts<const> = {
		'return function(channels, entry, evaluation)\n',
		'local track\nlocal keys\nlocal value\n',
		'',
		'',
		'',
		'',
		'',
		'',
	}
	if has_frame_tracks then
		parts[#parts + 1] = 'if evaluation["sample"] then\n'
		local position_part_index<const> = #parts + 1
		parts[position_part_index] = ''
		local lane_callback<const>, lane_primary<const>, lane_secondary<const>, lane_max<const>
			= append_scalar_lane(
				parts,
				'linear_tracks',
				definitions,
				'linear',
				false,
				'frame',
				false
		)
		has_callback = has_callback or lane_callback
		has_primary_binding = has_primary_binding or lane_primary
		has_secondary_binding = has_secondary_binding or lane_secondary
		if lane_max > max_key_count then
			max_key_count = lane_max
		end
		local cubic_callback<const>, cubic_primary<const>, cubic_secondary<const>, cubic_max<const>
			= append_scalar_lane(
				parts,
				'cubic_tracks',
				definitions,
				'cubic',
				false,
				'frame',
				true
		)
		has_callback = has_callback or cubic_callback
		has_primary_binding = has_primary_binding or cubic_primary
		has_secondary_binding = has_secondary_binding or cubic_secondary
		if cubic_max > max_key_count then
			max_key_count = cubic_max
		end
		if lane_max > 1 or cubic_max > 1 then
			parts[position_part_index] = 'position = evaluation["frame"]\n'
		end
		parts[#parts + 1] = 'end\n'
	end
	if has_time_tracks then
		local position_part_index<const> = #parts + 1
		parts[position_part_index] = ''
		local lane_callback<const>, lane_primary<const>, lane_secondary<const>, lane_max<const>
			= append_scalar_lane(
				parts,
				'linear_time_tracks',
				definitions,
				'linear',
				true,
				'time_ms',
				false
		)
		has_callback = has_callback or lane_callback
		has_primary_binding = has_primary_binding or lane_primary
		has_secondary_binding = has_secondary_binding or lane_secondary
		if lane_max > max_key_count then
			max_key_count = lane_max
		end
		local cubic_callback<const>, cubic_primary<const>, cubic_secondary<const>, cubic_max<const>
			= append_scalar_lane(
				parts,
				'cubic_time_tracks',
				definitions,
				'cubic',
				true,
				'time_ms',
				true
		)
		has_callback = has_callback or cubic_callback
		has_primary_binding = has_primary_binding or cubic_primary
		has_secondary_binding = has_secondary_binding or cubic_secondary
		if cubic_max > max_key_count then
			max_key_count = cubic_max
		end
		if lane_max > 1 or cubic_max > 1 then
			parts[position_part_index] = 'position = evaluation["time_ms"]\n'
		end
	end
	if has_primary_binding then
		parts[3] = 'local primary_binding = entry["primary_binding"]\n'
	end
	if has_secondary_binding then
		parts[4] = 'local bindings = entry["bindings"]\n'
	end
	if has_callback then
		parts[5] = 'local params = entry["params"]\n'
	end
	if max_key_count > 1 then
		parts[6] = 'local position\nlocal first_key\nlocal last_key\nlocal key\n'
	end
	if max_key_count > 2 then
		parts[7] = 'local low\nlocal high\nlocal middle\n'
	end
	if has_cubic_tracks then
		parts[8] = 'local u\n'
	end
	parts[#parts + 1] = 'end'
	return load(table.concat(parts), '[timeline.apply.scalar]', 't')()
end

return timeline_apply
