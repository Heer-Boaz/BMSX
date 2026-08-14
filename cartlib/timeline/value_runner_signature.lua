-- The value-runner signature is owned once at admission. Evaluation programs
-- and generated runners consume the same ordered operand list, so absent track
-- domains never cross the 50 Hz call boundary. Callback-bearing runners receive
-- the private sample latch separately from the authored evaluation table.
local value_runner_signature<const> = {}
local operand<const> = {
	entry = 1,
	previous_frame = 2,
	frame = 3,
	previous_time_ms = 4,
	time_ms = 5,
	direction = 6,
	flags = 7,
	sample = 8,
	evaluation = 9,
}

value_runner_signature.operand = operand

function value_runner_signature.compile(values, position)
	local operands<const> = { operand.entry }
	local mask = 0
	if values.has_frame_steps and not position then
		operands[#operands + 1] = operand.previous_frame
		mask = mask | 0x01
	end
	if values.has_frame_steps or values.has_scalar_frame_channels then
		operands[#operands + 1] = operand.frame
		mask = mask | 0x02
	end
	if values.has_time_steps and not position then
		operands[#operands + 1] = operand.previous_time_ms
		mask = mask | 0x04
	end
	if values.has_time_steps or values.has_scalar_time_channels or values.has_sample_tracks then
		operands[#operands + 1] = operand.time_ms
		mask = mask | 0x08
	end
	if values.has_frame_steps and not position then
		operands[#operands + 1] = operand.direction
		mask = mask | 0x10
	end
	if values.has_frame_steps
	or values.has_time_steps
	or (
		(values.has_scalar_frame_channels or values.has_sample_tracks)
		and not values.value_has_evaluation_context
	) then
		operands[#operands + 1] = operand.flags
		mask = mask | 0x20
	end
	if values.value_has_evaluation_context
	and (values.has_scalar_frame_channels or values.has_sample_tracks) then
		operands[#operands + 1] = operand.sample
		mask = mask | 0x80
	end
	if values.value_has_evaluation_context then
		operands[#operands + 1] = operand.evaluation
		mask = mask | 0x40
	end
	return operands, mask
end

return value_runner_signature
