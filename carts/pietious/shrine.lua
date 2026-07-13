-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.

require('constants')
local font_module<const> = require('system/font')

local shrine<const> = {}
shrine.__index = shrine

local draw_shrine_visual<const> = function()
	gx_blit_img_color('shrine_inside', 0, room_tile_origin_y, 0xffffffff)
end

function shrine:ctor()
	local text<const> = self:get_component('textcomponent')
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset.x = shrine_text_x
	text.offset.y = shrine_text_y
	text.offset.z = 1
	self.text_component = text
	self:get_component('customvisualcomponent').producer = draw_shrine_visual
end

local room_shrine<const> = {}
room_shrine.__index = room_shrine

function room_shrine:ctor()
	self.collider:set_enabled(false)
	self:gfx('shrine')
end

local define_shrine_fsm<const> = function()
	define_fsm('shrine', {
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
	define_prefab({
		def_id = 'shrine',
		class = shrine,
		fsms = { 'shrine' },
		components = { 'customvisualcomponent', 'textcomponent' },
		defaults = {
			id = 'shrine',
		},
	})
end

local register_room_shrine_definition<const> = function()
	define_prefab({
		def_id = 'room_shrine',
		class = room_shrine,
		type = 'sprite',
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
