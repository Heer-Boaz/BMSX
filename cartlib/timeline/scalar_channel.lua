-- Numeric curve channels own their compiled segment representation and hot
-- evaluator. Generic step values remain track-program data because they may
-- carry non-numeric cart values.
local scalar_channel<const> = {}

scalar_channel.empty = {
	track_count = 0,
	linear_tracks = {},
	linear_track_count = 0,
	linear_time_tracks = {},
	linear_time_track_count = 0,
	cubic_tracks = {},
	cubic_track_count = 0,
	cubic_time_tracks = {},
	cubic_time_track_count = 0,
}

local compare_frame_key<const> = function(left, right)
	if left.frame == right.frame then
		return left.order < right.order
	end
	return left.frame < right.frame
end

local compare_time_key<const> = function(left, right)
	if left.time_ms == right.time_ms then
		return left.order < right.order
	end
	return left.time_ms < right.time_ms
end

local frame_at<const> = function(position, length)
	if position.frame ~= nil then
		return position.frame
	end
	return (position.u * (length - 1)) // 1
end

function scalar_channel.compile(definitions, length)
	if #definitions == 0 then
		return scalar_channel.empty
	end
	local linear_tracks<const> = {}
	local linear_time_tracks<const> = {}
	local cubic_tracks<const> = {}
	local cubic_time_tracks<const> = {}
	for track_index = 1, #definitions do
		local definition<const> = definitions[track_index]
		local interpolation<const> = definition.interpolation
		local time_domain<const> = definition.keys[1].time_ms ~= nil
		local keys<const> = {}
		for key_index = 1, #definition.keys do
			local source<const> = definition.keys[key_index]
			local key<const> = {
				value = source.value,
				order = key_index,
			}
			if time_domain then
				key.time_ms = source.time_ms
			else
				key.frame = frame_at(source, length)
			end
			if interpolation == 'cubic' then
				key.arrive_tangent = source.arrive_tangent
				key.leave_tangent = source.leave_tangent
			end
			keys[key_index] = key
		end
		if time_domain then
			table.sort(keys, compare_time_key)
		else
			table.sort(keys, compare_frame_key)
		end
		for key_index = 1, #keys do
			keys[key_index].order = nil
		end
		for key_index = 1, #keys - 1 do
			local key<const> = keys[key_index]
			local next_key<const> = keys[key_index + 1]
			local span
			if time_domain then
				span = next_key.time_ms - key.time_ms
			else
				span = next_key.frame - key.frame
			end
			key.span_inv = 1 / span
			if interpolation == 'linear' then
				key.value_delta = next_key.value - key.value
			else
				local leave<const> = key.leave_tangent * span
				local arrive<const> = next_key.arrive_tangent * span
				key.cubic3 = 2 * key.value - 2 * next_key.value + leave + arrive
				key.cubic2 = -3 * key.value + 3 * next_key.value - 2 * leave - arrive
				key.cubic1 = leave
			end
		end
		if interpolation == 'cubic' then
			for key_index = 1, #keys do
				local key<const> = keys[key_index]
				key.arrive_tangent = nil
				key.leave_tangent = nil
			end
		end
		local track<const> = {
			binding_index = definition.binding_index,
			apply = definition.apply,
			keys = keys,
			key_count = #keys,
		}
		if interpolation == 'linear' then
			if time_domain then
				linear_time_tracks[#linear_time_tracks + 1] = track
			else
				linear_tracks[#linear_tracks + 1] = track
			end
		elseif time_domain then
			cubic_time_tracks[#cubic_time_tracks + 1] = track
		else
			cubic_tracks[#cubic_tracks + 1] = track
		end
	end
	return {
		track_count = #definitions,
		linear_tracks = linear_tracks,
		linear_track_count = #linear_tracks,
		linear_time_tracks = linear_time_tracks,
		linear_time_track_count = #linear_time_tracks,
		cubic_tracks = cubic_tracks,
		cubic_track_count = #cubic_tracks,
		cubic_time_tracks = cubic_time_tracks,
		cubic_time_track_count = #cubic_time_tracks,
	}
end

local first_frame_after<const> = function(keys, count, frame)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if keys[middle].frame <= frame then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

local first_time_after<const> = function(keys, count, time_ms)
	local low = 1
	local high = count + 1
	while low < high do
		local middle<const> = (low + high) // 2
		if keys[middle].time_ms <= time_ms then
			low = middle + 1
		else
			high = middle
		end
	end
	return low
end

-- Domain and interpolation are split during compilation. The four direct loops
-- below intentionally avoid a per-track mode branch or sampler closure on the
-- 50 Hz path.
function scalar_channel.evaluate(channels, entry, evaluation)
	local params<const> = entry.params
	local primary_binding<const> = entry.primary_binding
	local bindings<const> = entry.bindings
	if evaluation.sample then
		local frame<const> = evaluation.frame
		local tracks<const> = channels.linear_tracks
		for track_index = 1, channels.linear_track_count do
			local track<const> = tracks[track_index]
			local keys<const> = track.keys
			local key_count<const> = track.key_count
			local first_key<const> = keys[1]
			local value
			if frame <= first_key.frame then
				value = first_key.value
			else
				local last_key<const> = keys[key_count]
				if frame >= last_key.frame then
					value = last_key.value
				else
					local key<const> = keys[first_frame_after(keys, key_count, frame) - 1]
					value = key.value + key.value_delta * ((frame - key.frame) * key.span_inv)
				end
			end
			local binding
			if track.binding_index == 1 then
				binding = primary_binding
			else
				binding = bindings[track.binding_index]
			end
			track.apply(binding, value, params, evaluation)
		end
		local cubic_tracks<const> = channels.cubic_tracks
		for track_index = 1, channels.cubic_track_count do
			local track<const> = cubic_tracks[track_index]
			local keys<const> = track.keys
			local key_count<const> = track.key_count
			local first_key<const> = keys[1]
			local value
			if frame <= first_key.frame then
				value = first_key.value
			else
				local last_key<const> = keys[key_count]
				if frame >= last_key.frame then
					value = last_key.value
				else
					local key<const> = keys[first_frame_after(keys, key_count, frame) - 1]
					local u<const> = (frame - key.frame) * key.span_inv
					value = ((key.cubic3 * u + key.cubic2) * u + key.cubic1) * u + key.value
				end
			end
			local binding
			if track.binding_index == 1 then
				binding = primary_binding
			else
				binding = bindings[track.binding_index]
			end
			track.apply(binding, value, params, evaluation)
		end
	end
	local time_ms<const> = evaluation.time_ms
	local time_tracks<const> = channels.linear_time_tracks
	for track_index = 1, channels.linear_time_track_count do
		local track<const> = time_tracks[track_index]
		local keys<const> = track.keys
		local key_count<const> = track.key_count
		local first_key<const> = keys[1]
		local value
		if time_ms <= first_key.time_ms then
			value = first_key.value
		else
			local last_key<const> = keys[key_count]
			if time_ms >= last_key.time_ms then
				value = last_key.value
			else
				local key<const> = keys[first_time_after(keys, key_count, time_ms) - 1]
				value = key.value + key.value_delta * ((time_ms - key.time_ms) * key.span_inv)
			end
		end
		local binding
		if track.binding_index == 1 then
			binding = primary_binding
		else
			binding = bindings[track.binding_index]
		end
		track.apply(binding, value, params, evaluation)
	end
	local cubic_time_tracks<const> = channels.cubic_time_tracks
	for track_index = 1, channels.cubic_time_track_count do
		local track<const> = cubic_time_tracks[track_index]
		local keys<const> = track.keys
		local key_count<const> = track.key_count
		local first_key<const> = keys[1]
		local value
		if time_ms <= first_key.time_ms then
			value = first_key.value
		else
			local last_key<const> = keys[key_count]
			if time_ms >= last_key.time_ms then
				value = last_key.value
			else
				local key<const> = keys[first_time_after(keys, key_count, time_ms) - 1]
				local u<const> = (time_ms - key.time_ms) * key.span_inv
				value = ((key.cubic3 * u + key.cubic2) * u + key.cubic1) * u + key.value
			end
		end
		local binding
		if track.binding_index == 1 then
			binding = primary_binding
		else
			binding = bindings[track.binding_index]
		end
		track.apply(binding, value, params, evaluation)
	end
end

return scalar_channel
