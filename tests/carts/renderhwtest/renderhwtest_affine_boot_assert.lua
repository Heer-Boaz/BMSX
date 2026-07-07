__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
end

function __bmsx_host_test.update(_frame)
	__bmsx_host_test.frames = __bmsx_host_test.frames + 1
	assert(__bmsx_host_test.frames < 120,
		'renderhwtest affine draw timed out at ready=' .. tostring(renderhwtest_affine_ready)
			.. ' draws=' .. tostring(renderhwtest_draw_count))
	if renderhwtest_affine_ready == true and renderhwtest_draw_count >= 3 then
		assert(renderhwtest_draw_count >= 3, 'renderhwtest affine quad draw count below target')
		return true
	end
	return false
end
