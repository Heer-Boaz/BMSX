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
	assert(__bmsx_host_test.frames < 120, 'nemesis_s boot timed out')
	return __bmsx_host_test.frames >= 10
end
