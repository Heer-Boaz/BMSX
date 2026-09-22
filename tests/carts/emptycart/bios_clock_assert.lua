local time_ms<const>: *word = 0x08010228
return {
	kind = 'integration',
	tests = {
		machine_clock = function(t)
			local before_ms<const> = time_ms[0]
			local before_clock<const> = os.clock()
			t:wait_ticks(7)
			local after_ms<const> = time_ms[0]
			local delta<const> = after_ms - before_ms
			assert(delta >= 7, 'machine time did not advance')
			assert(math.abs(os.clock() - before_clock - delta / 1000) < 0.000001, 'os.clock delta mismatch')
			local seconds<const> = os.time()
			assert(seconds * 1000 <= after_ms and after_ms < (seconds + 1) * 1000, 'os.time machine-time mismatch')
		end,
	},
}
