local actioneffectsystem<const> = require('cartlib/actioneffects/actioneffectsystem')
local btsystem<const> = require('cartlib/behaviourtree/btsystem')
local elevatorsystem<const> = require('elevator/system')
local fsmsystem<const> = require('cartlib/fsm/fsmsystem')
local inputactioneffectsystem<const> = require('cartlib/input/actioneffect/system')
local inputsystem<const> = require('cartlib/input/inputsystem')
local overlap2dsystem<const> = require('cartlib/collision/overlap2dsystem')
local screenboundarycapturesystem<const> = require('cartlib/physics/screenboundarycapturesystem')
local screenboundarysystem<const> = require('cartlib/physics/screenboundarysystem')
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
		inputactioneffectsystem,
		actioneffectsystem,
		fsmsystem,
		screenboundarycapturesystem,
		screenboundarysystem,
		overlap2dsystem,
		tilecollisionsystem,
		timelinesystem,
		elevatorsystem,
	},
}
