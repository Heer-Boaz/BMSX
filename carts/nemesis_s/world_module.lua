local actioneffectsystem<const> = require('cartlib/actioneffects/actioneffectsystem')
local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local input_actioneffectsystem<const> = require('cartlib/input/actioneffect/system')
local inputsystem<const> = require('cartlib/input/inputsystem')
local timelinesystem<const> = require('cartlib/timeline/timelinesystem')

return {
	spaces = { 'main' },
	systems = {
		inputsystem,
		input_actioneffectsystem,
		actioneffectsystem,
		fsmsystem,
		timelinesystem,
	},
}
