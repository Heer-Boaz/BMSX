local actioneffectsystem<const> = require('cartlib/actioneffects/actioneffectsystem')
local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local inputactioneffectsystem<const> = require('cartlib/input/actioneffect/system')
local inputsystem<const> = require('cartlib/input/inputsystem')
local timeline_system<const> = require('cartlib/timeline/timeline_system')

return {
	spaces = { 'main' },
	systems = {
		inputsystem,
		inputactioneffectsystem,
		actioneffectsystem,
		fsmsystem,
		timeline_system,
	},
}
