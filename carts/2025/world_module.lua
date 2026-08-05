local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local inputsystem<const> = require('cartlib/input/inputsystem')
local timelinesystem<const> = require('cartlib/timeline/timelinesystem')

return {
	spaces = { 'main' },
	systems = {
		inputsystem,
		fsmsystem,
		timelinesystem,
	},
}
