local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local inputsystem<const> = require('cartlib/input/inputsystem')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = { 'main' },
	systems = {
		inputsystem,
		fsmsystem,
		timeline_system,
	},
}
