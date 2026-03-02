local constants = require('constants')
local font = require('font')

local lithograph_screen = {}
lithograph_screen.__index = lithograph_screen

local lithograph_mode_sprite_id = 'lithograph_mode'

function lithograph_screen:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function lithograph_screen:draw_screen()
	put_sprite(lithograph_mode_sprite_id, constants.room.tile_size4, constants.room.tile_origin_y + constants.room.tile_size2, 340)
	local lines = self.lines
	if #lines > 0 then
		put_glyphs(lines, 0, constants.room.tile_origin_y + (constants.room.tile_size * 6), 341, {
			font = self.text_font,
			center_block_width = display_width(),
		})
	end
end

function lithograph_screen:bind_events()
	self.events:on({
		event = 'lithograph.open',
		emitter = 'd',
		subscriber = self,
		handler = function(event)
			self.lines = event.lines
		end,
	})
	self.events:on({
		event = 'lithograph.clear',
		emitter = 'd',
		subscriber = self,
		handler = function()
			self.lines = {}
		end,
	})
end

function lithograph_screen:ctor()
	self.text_font = font.get('pietious')
	self.lines = {}
	self:bind_visual()
	self:bind_events()
end

local function define_lithograph_screen_fsm()
	define_fsm('lithograph_screen', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_lithograph_screen_definition()
	define_prefab({
		def_id = 'lithograph_screen',
		class = lithograph_screen,
		fsms = { 'lithograph_screen' },
		components = { 'customvisualcomponent' },
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
