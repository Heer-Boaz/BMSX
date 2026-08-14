-- Event definitions are cooked into one four-bit lane shape per update method.
-- The track producer, evaluator cache and syntax lowerer share this exact
-- representation; runtime traversal never reconstructs domain membership.
local event_lane_shape<const> = {
	forward_frame = 0x1,
	backward_frame = 0x2,
	forward_time = 0x4,
	backward_time = 0x8,
	frame_mask = 0x3,
	time_mask = 0xc,
	forward_mask = 0x5,
	backward_mask = 0xa,
}

return event_lane_shape
