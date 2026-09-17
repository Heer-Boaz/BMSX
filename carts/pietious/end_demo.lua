local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/end_demo')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
require('constants')

local end_demo<const> = {}

function end_demo:ctor()
	self.presentation = scene_library.instantiate(scene.id)
	self.members = self.presentation.members
end

local define_end_demo_fsm<const> = function()
	fsm_library.register('end_demo', {
		initial = 'active',
		on = {
			['end_demo'] = {
				emitter = 'd',
				go = function()
					atlas.load('end_demo')
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_end_demo_definition<const> = function()
	scene.register()
	prefab.define({
		def_id = 'end_demo',
		class = end_demo,
		components = {
			fsm_component.factory({ 'end_demo' }),
		},
		defaults = {
			id = 'end_demo',
		},
	})
end

return {
	define_end_demo_fsm = define_end_demo_fsm,
	register_end_demo_definition = register_end_demo_definition,
}
