__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	assert(cartlib_test_gte_plus_interlock_ready == true, 'cart raw GTE+ command interlock did not resume')
	assert(cartlib_test_gte_plus_ready == true, 'cart firmware did not complete GTE+ VMAD3')
	assert(cartlib_test_gte_plus_x == 6 and cartlib_test_gte_plus_y == -26 and cartlib_test_gte_plus_z == 32, 'cart firmware returned the wrong GTE+ VMAD3 vector')
end

function __bmsx_host_test.update(_frame)
	return true
end
