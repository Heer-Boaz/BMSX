

return {
	kind = 'integration',
	tests = {
		firmware_interlock_and_vector_result = function(t)
			t:wait_until('game fixture', function() return cartlib_test_ready end, 120)
			assert(cartlib_test_gte_plus_interlock_ready == true, 'cart raw GTE+ command interlock did not resume')
			assert(cartlib_test_gte_plus_ready == true, 'cart firmware did not complete GTE+ VMAD3')
			assert(cartlib_test_gte_plus_x == 6 and cartlib_test_gte_plus_y == -26 and cartlib_test_gte_plus_z == 32, 'cart firmware returned the wrong GTE+ VMAD3 vector')
		end,
	},
}
