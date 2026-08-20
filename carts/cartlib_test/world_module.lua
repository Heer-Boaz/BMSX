local clock<const> = require('cartlib/clock')
local input_system<const> = require('cartlib/input/input_system')

local update_interval_vblanks<const> = 1

return {
	update_milliseconds = clock.configure_update_interval(update_interval_vblanks),
	spaces = { 'main' },
	systems = { input_system },
}
