-- The value-runner signature is owned once at admission. Evaluation programs
-- and generated runners consume the same ordered operand list, so absent track
-- domains never cross the 50 Hz call boundary.
local value_runner_signature<const> = {}

function value_runner_signature.of(values, position)
	local names<const> = { 'entry' }
	if values.has_frame_steps and not position then
		names[#names + 1] = 'previous_frame'
	end
	if values.has_frame_steps or values.has_scalar_frame_channels then
		names[#names + 1] = 'frame'
	end
	if values.has_time_steps and not position then
		names[#names + 1] = 'previous_time_ms'
	end
	if values.has_time_steps or values.has_scalar_time_channels or values.has_sample_tracks then
		names[#names + 1] = 'time_ms'
	end
	if values.has_frame_steps and not position then
		names[#names + 1] = 'direction'
	end
	if values.has_frame_steps
	or values.has_time_steps
	or values.has_scalar_frame_channels
	or values.has_sample_tracks then
		names[#names + 1] = 'flags'
	end
	if values.value_has_evaluation_context then
		names[#names + 1] = 'evaluation'
	end
	return names
end

return value_runner_signature
