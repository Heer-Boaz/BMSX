local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/lithograph')
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
require('constants')

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen

function lithograph_screen:ctor()
	self.members = scene_library.instantiate(scene.id)
	self.text_component = self.members.caption.text_component
end

local define_lithograph_screen_fsm<const> = function()
	fsm_library.register('lithograph_screen', {
		initial = 'active',
		on = {
			['lithograph'] = {
				emitter = 'd',
				go = function(self, _state, event)
					self.text_component:set_text(event.lines)
				end,
			},
			['room'] = {
				emitter = 'd',
				go = function(self)
					self.text_component:set_text(nil)
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_lithograph_screen_definition<const> = function()
	scene.register()
	prefab.define({
		def_id = 'lithograph_screen',
		class = lithograph_screen,
		components = {
			fsm_component.factory({ 'lithograph_screen' }),
		},
		defaults = {
			id = 'lithograph',
		},
	})
end

return {
	lithograph_screen = lithograph_screen,
	define_lithograph_screen_fsm = define_lithograph_screen_fsm,
	register_lithograph_screen_definition = register_lithograph_screen_definition,
}
