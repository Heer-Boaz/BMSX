-- Numeric curve channels own their compiled segment representation and hot
-- evaluator. Generic step values remain track-program data because they may
-- carry non-numeric cart values.
local scalar_channel<const> = {}

scalar_channel.empty = {
	track_count = 0,
	linear_tracks = {},
	linear_time_tracks = {},
	cubic_tracks = {},
	cubic_time_tracks = {},
	runner = nil,
}

local finalize_tracks<const> = function(tracks)
	for index = 1, #tracks do
		local track<const> = tracks[index]
		track.binding_index = nil
		track.path = nil
		track.key_count = nil
	end
end

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

function scalar_channel.compile(definitions, length, runner)
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
			path = definition.path,
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
	local channels<const> = {
		track_count = #definitions,
		linear_tracks = linear_tracks,
		linear_time_tracks = linear_time_tracks,
		cubic_tracks = cubic_tracks,
		cubic_time_tracks = cubic_time_tracks,
	}
	channels.runner = runner
	finalize_tracks(linear_tracks)
	finalize_tracks(linear_time_tracks)
	finalize_tracks(cubic_tracks)
	finalize_tracks(cubic_time_tracks)
	return channels
end

return scalar_channel
