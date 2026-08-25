local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local font<const> = require('cartlib/font')
local atlas<const> = require('cartlib/gx/atlas')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local game_text_module<const> = require('game_text')
require('constants')

local game_text<const>: *game_text_record = game_text_module.game_text
local end_demo<const> = {}
end_demo.__index = end_demo
local message_y<const> = screen_height - room_tile_size2

local draw_message_background<const> = function(_, draw)
	draw:rect(0, message_y, screen_width, message_y + room_tile_size, 0xff000000)
end

function end_demo:ctor()
	local background<const> = self:get_component(custom_visual_component)
	background:set_offset_z(1)
	background:set_draw_function(draw_message_background)
	local text<const> = self:get_component(text_component)
	text:set_font(font.get('pietious'))
	text:set_text(game_text[0].end_demo_message)
	text.offset_y = message_y
	text:set_offset_z(2)
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
	prefab.define({
		def_id = 'end_demo',
		class = end_demo,
		base = sprite_object,
		components = {
			custom_visual_component.new,
			text_component.new,
			fsm_component.factory({ 'end_demo' }),
		},
		defaults = {
			id = 'end_demo',
			imgid = 'end_demo',
		},
	})
end

return {
	define_end_demo_fsm = define_end_demo_fsm,
	register_end_demo_definition = register_end_demo_definition,
}
