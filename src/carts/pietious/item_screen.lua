local constants = require('constants.lua')
local engine = require('engine')

local item_screen = {}
item_screen.__index = item_screen

local item_screen_fsm_id = constants.ids.item_screen_fsm

function item_screen:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function item_screen:get_player()
	return engine.object(self.player_id)
end

function item_screen:get_health_level()
	local player = self:get_player()
	if player == nil then
		return constants.damage.max_health
	end
	local value = math.floor(player.health)
	if value < 0 then
		value = 0
	end
	if value > constants.damage.max_health then
		value = constants.damage.max_health
	end
	return value
end

function item_screen:draw_background()
	local width = display_width()
	local height = display_height()
	for y = 0, height - 1, 8 do
		for x = 0, width - 1, 8 do
			put_sprite('castle_tile_stone_dark_2', x, y, 320)
		end
	end
	put_sprite('game_header', 0, 0, 321)
end

function item_screen:draw_slots()
	local base_x = 24
	local base_y = 44
	local step_x = 26
	local step_y = 26
	for row = 0, 3 do
		for col = 0, 7 do
			local x = base_x + (col * step_x)
			local y = base_y + (row * step_y)
			put_sprite('castle_block_stone', x, y, 322)
		end
	end
	put_sprite('pietolon_slash_sword_r', base_x + 4, base_y + 2, 323)
	put_sprite('pietolon_stand_r', base_x + step_x + 4, base_y + 2, 323)
end

function item_screen:draw_bars()
	local hud = constants.hud
	local health = self:get_health_level()
	for i = 0, health - 1 do
		put_sprite('energybar_stripe_blue', hud.health_bar_x + i, hud.health_bar_y, 324)
	end
	for i = 0, hud.weapon_level - 1 do
		put_sprite('energybar_stripe_red', hud.weapon_bar_x + i, hud.weapon_bar_y, 324)
	end
end

function item_screen:draw_screen()
	self:draw_background()
	self:draw_slots()
	self:draw_bars()
end

local function define_item_screen_fsm()
	define_fsm(item_screen_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_visual()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_item_screen_definition()
	define_world_object({
		def_id = constants.ids.item_screen_def,
		class = item_screen,
		fsms = { item_screen_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			player_id = constants.ids.player_instance,
			space_id = constants.spaces.item,
		},
	})
end

return {
	item_screen = item_screen,
	define_item_screen_fsm = define_item_screen_fsm,
	register_item_screen_definition = register_item_screen_definition,
	item_screen_def_id = constants.ids.item_screen_def,
	item_screen_instance_id = constants.ids.item_screen_instance,
	item_screen_fsm_id = item_screen_fsm_id,
}
