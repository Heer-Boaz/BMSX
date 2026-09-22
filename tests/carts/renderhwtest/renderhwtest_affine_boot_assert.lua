return {
	kind = 'integration',
	tests = {
		affine_quads_reach_presentation = function(t)
			t:wait_until('three affine draws', function()
				return renderhwtest_affine_ready == true and renderhwtest_draw_count >= 3
			end, 120)
			t:capture('affine quads')
		end,
	},
}
