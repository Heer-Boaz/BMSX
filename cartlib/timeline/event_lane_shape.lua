-- Event definitions are cooked into one lane shape per update method.
-- The track producer, evaluator cache and syntax lowerer share this exact
-- representation; runtime traversal never reconstructs domain membership.
local event_lane_shape<const> = {
	forward_frame = 0x1,
	backward_frame = 0x2,
	forward_time = 0x4,
	backward_time = 0x8,
	forward_single_time = 0x10,
	backward_single_time = 0x20,
	frame_mask = 0x3,
	time_mask = 0xc,
	forward_mask = 0x5,
	backward_mask = 0xa,
	single_time_shift = 2,
	bit_count = 6,
}

-- A lane is single only while exactly one composed source contributes exactly
-- one time key. Presence overlaps therefore demote that direction to a normal
-- sorted range without retaining admission counters in the runtime program.
function event_lane_shape.merge(left, right)
	local overlapping_time<const> = left & right & event_lane_shape.time_mask
	return (left | right)
		& ~(overlapping_time << event_lane_shape.single_time_shift)
end

return event_lane_shape
