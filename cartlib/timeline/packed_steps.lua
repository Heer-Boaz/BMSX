-- Cooked frame-domain lanes borrow ROM data. The key arrays are ordered
-- within each track; each frame's span names its operations in track order.
struct packed_step_clip
	length: word
	tracks: word
	keys: word
	operations: word
	forward: word
	reverse: word
end

struct packed_step_track
	first: u16
	limit: u16
end

struct packed_step_key
	frame: word
	value: word
end

struct packed_step_operation
	track: u16
	key: u16
end

local packed_steps<const> = {}
local no_time_keys<const> = {}

function packed_steps.clip(address, index)
	local directory<const>: *word = address
	local clip<const>: *packed_step_clip = address + directory[index]
	return clip, clip->length
end

function packed_steps.bind(address, appliers)
	local clip<const>: *packed_step_clip = address
	return {
		tracks = address + clip->tracks,
		keys = address + clip->keys,
		operations = address + clip->operations,
		by_frame = address + clip->forward,
		reverse_by_frame = address + clip->reverse,
		appliers = appliers,
		track_count = #appliers,
		time_keys = no_time_keys,
		time_key_count = 0,
	}
end

function packed_steps.apply_frame(entry, steps, span_address, frame, params, evaluation)
	local spans<const>: *u16 = span_address
	local first<const> = spans[frame]
	local limit<const> = spans[frame + 1]
	if first == limit then return end
	local operations: *packed_step_operation = steps.operations + first * sizeof(packed_step_operation)
	local keys<const> = steps.keys
	local appliers<const> = steps.appliers
	for _ = first, limit - 1 do
		local key<const>: *packed_step_key = keys + operations->key * sizeof(packed_step_key)
		appliers[operations->track](entry, key->value, params, evaluation)
		operations = operations + sizeof(packed_step_operation)
	end
end

-- Positioning resolves the last key at or before the requested frame,
-- just as the ordered ordinary step lane does.
function packed_steps.sample(entry, steps, frame, params, evaluation)
	local track: *packed_step_track = steps.tracks
	local keys<const> = steps.keys
	local appliers<const> = steps.appliers
	for index = 1, steps.track_count do
		local first<const> = track->first
		local left, right = first, track->limit
		while left < right do
			local middle<const> = (left + right) // 2
			local key<const>: *packed_step_key = keys + middle * sizeof(packed_step_key)
			if key->frame <= frame then left = middle + 1 else right = middle end
		end
		if left ~= first then
			local key<const>: *packed_step_key = keys + (left - 1) * sizeof(packed_step_key)
			appliers[index](entry, key->value, params, evaluation)
		end
		track = track + sizeof(packed_step_track)
	end
end

return packed_steps
