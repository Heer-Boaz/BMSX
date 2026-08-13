local playback<const> = {}

playback.start_index = -1
playback.mode = {
	once = 0,
	loop = 1,
	pingpong = 2,
}
playback.boundary = {
	none = 0,
	loop = 1,
	turn = 2,
}
-- Evaluation ranges cross the compiled transport/evaluator boundary as scalar
-- register values. Boundary occupies the low bits so evaluators can consume it
-- directly; the remaining bits describe traversal without allocating or
-- rewriting a Lua record for engine-internal tracks.
playback.evaluation_flag = {
	boundary_mask = 0x03,
	sample = 0x04,
	wrapped = 0x08,
	initial = 0x10,
}
playback.update_method = {
	play = 0,
	jump = 1,
	scrub = 2,
}

return playback
