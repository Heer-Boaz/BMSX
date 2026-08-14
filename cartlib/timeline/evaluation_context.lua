local timeline_frame_program<const> = require('cartlib/timeline/frame_program')
local timeline_playback<const> = require('cartlib/timeline/playback')

local evaluation_context<const> = {}
local evaluation_flag<const> = timeline_playback.evaluation_flag
local boundary_mask<const> = evaluation_flag.boundary_mask
local sample_flag<const> = evaluation_flag.sample
local wrapped_flag<const> = evaluation_flag.wrapped
local initial_flag<const> = evaluation_flag.initial

evaluation_context.value = timeline_frame_program.value

-- Engine evaluators consume scalar ranges. This retained table exists only for
-- authored callbacks whose public contract exposes named evaluation fields.
function evaluation_context.write(
	context,
	program,
	method,
	previous_frame,
	frame,
	previous_time_ms,
	time_ms,
	direction,
	flags
)
	context.previous_frame = previous_frame
	context.frame = frame
	context.previous_time_ms = previous_time_ms
	context.time_ms = time_ms
	context.method = method
	context.direction = direction
	context.sample = flags & sample_flag ~= 0
	context.boundary = flags & boundary_mask
	context.wrapped = flags & wrapped_flag ~= 0
	context.initial = flags & initial_flag ~= 0
	if flags & sample_flag ~= 0 then
		context.value = timeline_frame_program.value(program, frame)
	end
	return context
end

return evaluation_context
