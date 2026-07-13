__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
}

local components<const> = require('cartlib/components')

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	local boundary<const> = components.screenboundarycomponent.new({})
	assert(boundary.boundary_right == 256 and boundary.boundary_bottom == 192,
		'Nemesis screen boundary does not use its GX display mode')
end

function __bmsx_host_test.update(_frame)
	__bmsx_host_test.frames = __bmsx_host_test.frames + 1
	assert(__bmsx_host_test.frames < 120, 'nemesis_s boot timed out')
	return __bmsx_host_test.frames >= 10
end
