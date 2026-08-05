-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.

local fsmlibrary<const> = require('cartlib/fsm/library')
local fsmcomponent<const> = require('cartlib/fsm/component')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/prefab')
local customvisualcomponent<const> = require('cartlib/render/custom_visual_component')
local spriteobject<const> = require('cartlib/sprite')
local textcomponent<const> = require('cartlib/text/component')
require('constants')
local font_module<const> = require('cartlib/font')

local shrine<const> = {}
shrine.__index = shrine
shrine.background = image.resolve('shrine_inside')

local draw_shrine_visual<const> = function(parent, draw)
	image.draw(draw, parent.background, 0, room_tile_origin_y, 0xffffffff, 0, gp0.draw_mode_blend_half)
end

function shrine:ctor()
	local text<const> = self:get_component(textcomponent.type_name)
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset_x = shrine_text_x
	text.offset_y = shrine_text_y
	text:set_offset_z(1)
	self.text_component = text
	self:get_component(customvisualcomponent.type_name).producer = draw_shrine_visual
end

local room_shrine<const> = {}
room_shrine.__index = room_shrine

function room_shrine:ctor()
	self.collider:set_enabled(false)
	self:gfx('shrine')
end

local define_shrine_fsm<const> = function()
	fsmlibrary.register('shrine', {
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
			customvisualcomponent.new,
			textcomponent.new,
			fsmcomponent.factory({ 'shrine' }),
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
