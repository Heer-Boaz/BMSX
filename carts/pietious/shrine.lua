-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local prefab<const> = require('cartlib/prefab')
local spritecomponent<const> = require('cartlib/component/spritecomponent')
local spriteobject<const> = require('cartlib/sprite')
local textcomponent<const> = require('cartlib/text/textcomponent')
require('constants')
local font_module<const> = require('cartlib/font')

local shrine<const> = {}
shrine.__index = shrine

function shrine:ctor()
	self:add_component(spritecomponent.new({
		imgid = 'shrine_inside',
		offset_y = room_tile_origin_y,
	}))
	local text<const> = self:get_component(textcomponent)
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset_x = shrine_text_x
	text.offset_y = shrine_text_y
	text:set_offset_z(1)
	self.text_component = text
end

local room_shrine<const> = {}
room_shrine.__index = room_shrine

function room_shrine:ctor()
	self.collider:set_enabled(false)
	self:set_imgid('shrine')
end

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
	prefab.define({
		def_id = 'shrine',
		class = shrine,
		components = {
			textcomponent.new,
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
		base = spriteobject,
		defaults = {
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
