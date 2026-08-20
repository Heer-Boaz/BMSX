-- Active states precede terminal states so compiled nodes retain their path
-- with one comparison. `waiting` is active but has no per-frame task work.
return {
	waiting = 0,
	running = 1,
	success = 2,
	failure = 3,
}
