local fsm_system<const> = require('cartlib/fsm/fsm_system')
local input_system<const> = require('cartlib/input/input_system')

return {
	spaces = { 'main' },
	systems = {
		input_system,
		fsm_system,
	},
}
