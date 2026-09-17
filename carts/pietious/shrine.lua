local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/shrine')
-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
require('constants')

local shrine<const> = {}
shrine.__index = shrine

function shrine:ctor()
	self.presentation = scene_library.instantiate(scene.id)
	self.members = self.presentation.members
	self.text_component = self.members.caption.text_component
end

local room_shrine<const> = {}
room_shrine.__index = room_shrine

local define_shrine_fsm<const> = function()
	fsm_library.register('shrine', {
		initial = 'active',
		on = {
			['shrine'] = {
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

local register_shrine_definition<const> = function()
	scene.register()
	prefab.define({
		def_id = 'shrine',
		class = shrine,
		components = {
			fsm_component.factory({ 'shrine' }),
		},
		defaults = {
			id = 'shrine',
		},
	})
end

local register_room_shrine_definition<const> = function()
	prefab.define({
		def_id = 'room_shrine',
		class = room_shrine,
		base = sprite_object,
		defaults = {
			imgid = 'shrine',
		},
	})
end

return {
	shrine = shrine,
	room_shrine = room_shrine,
	define_shrine_fsm = define_shrine_fsm,
	register_shrine_definition = register_shrine_definition,
	register_room_shrine_definition = register_room_shrine_definition,
}
