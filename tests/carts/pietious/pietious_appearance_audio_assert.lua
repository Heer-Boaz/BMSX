local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')

local selected_apu_source<const>: *word = 0x0800018c
local appearance_source_address<const> = rom_dir.audio('appearance').addr

__bmsx_host_test = {
	frames = 0,
	triggered = false,
}

function __bmsx_host_test.setup()
	return host.press('Enter', 2)
end

function __bmsx_host_test.ready()
	return registry:get('c') ~= nil
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 60, 'appearance audio scenario timed out')
	if not test.triggered then
		test.triggered = true
		registry:get('c').events:emit('appearance')
		return false
	end
	return *selected_apu_source == appearance_source_address
end
