local constants = require('constants.lua')

local ui = {}
ui.__index = ui

local ui_fsm_id = constants.ids.ui_fsm

function ui:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_ui()
	end
end

function ui:tick(_dt)
	local player = object(self.player_id)
	self.hud_health_level = math.floor(player.health)
	if self.hud_health_level < 0 then
		self.hud_health_level = 0
	end
	if self.hud_health_level > constants.damage.max_health then
		self.hud_health_level = constants.damage.max_health
	end
end

function ui:draw_ui()
	local hud = constants.hud
	put_sprite('game_header', 0, 0, 200)

	local health_x = hud.health_bar_x
	local health_y = hud.health_bar_y
	for i = 0, (self.hud_health_level - 1) do
		put_sprite('energybar_stripe_blue', health_x + i, health_y, 201)
	end

	local weapon_x = hud.weapon_bar_x
	local weapon_y = hud.weapon_bar_y
	for i = 0, (self.hud_weapon_level - 1) do
		put_sprite('energybar_stripe_red', weapon_x + i, weapon_y, 201)
	end
end

local function define_ui_fsm()
	define_fsm(ui_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_visual()
					return '/playing'
				end,
			},
			playing = {},
		},
	})
end

local function register_ui_definition()
	define_world_object({
		def_id = constants.ids.ui_def,
		class = ui,
		fsms = { ui_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			player_id = constants.ids.player_instance,
			hud_health_level = constants.hud.health_level,
			hud_weapon_level = constants.hud.weapon_level,
		},
	})
end

return {
	ui = ui,
	define_ui_fsm = define_ui_fsm,
	register_ui_definition = register_ui_definition,
	ui_def_id = constants.ids.ui_def,
	ui_instance_id = constants.ids.ui_instance,
	ui_fsm_id = constants.ids.ui_fsm,
}
