local actioneffectsystem<const> = require('cartlib/actioneffects/actioneffectsystem')
local btsystem<const> = require('cartlib/behaviourtree/btsystem')
local elevator_system<const> = require('elevator/system')
local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local input_actioneffectsystem<const> = require('cartlib/input/actioneffect/system')
local inputsystem<const> = require('cartlib/input/inputsystem')
local overlap_2d_system<const> = require('cartlib/collision/overlap_2d_system')
local screen_boundary_capture_system<const> = require('cartlib/collision/screen_boundary_capture_system')
local screen_boundary_system<const> = require('cartlib/collision/screen_boundary_system')
local tilecollisionsystem<const> = require('cartlib/collision/tilecollisionsystem')
local timelinesystem<const> = require('cartlib/timeline/timelinesystem')

return {
	spaces = {
		'main',
		'title',
		'transition',
		'shrine',
		'lithograph',
		'item',
		'ui',
	},
	systems = {
		inputsystem,
		btsystem,
		input_actioneffectsystem,
		actioneffectsystem,
		fsmsystem,
		screen_boundary_capture_system,
		screen_boundary_system,
		overlap_2d_system,
		tilecollisionsystem,
		timelinesystem,
		elevator_system,
	},
}
