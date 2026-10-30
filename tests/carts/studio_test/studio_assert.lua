return { kind = 'integration', tests = {
	boot = function(t)
		t:wait_until('Studio test cartridge published render work', function()
			return studio_test_ready and studio_test_rendered_frames > 0
		end, 120)
		assert(studio_test_actor.world ~= nil)
	end,
} }
