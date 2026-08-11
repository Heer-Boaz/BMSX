local playback<const> = {}

playback.start_index = -1
playback.mode = {
	once = 0,
	loop = 1,
	pingpong = 2,
}
playback.update_method = {
	play = 0,
	jump = 1,
	scrub = 2,
}

return playback
