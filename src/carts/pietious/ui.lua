local constants = require('constants.lua')

local ui = {}
ui.__index = ui

local ui_fsm_id = constants.ids.ui_fsm

local function animate_level(current, target)
	if current < target then
		return current + 1
	end
	if current > target then
		return current - 1
	end
	return current
end

function ui:get_player()
	local player = object(self.player_id)
	if player == nil then
		error('pietious ui player object missing')
	end
	return player
end

function ui:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_ui()
	end
end

function ui:ctor()
	self:bind_visual()
	local player = self:get_player()
	local health = clamp_int(math.floor(player.health), 0, constants.damage.max_health)
	self.hud_health_level = health
	self.hud_health_target = health
	self.hud_health_anim_ticks = 0
	self.hud_weapon_target = self.hud_weapon_level
	self.hud_weapon_anim_ticks = 0
end

function ui:tick()
	local player = self:get_player()
	self.hud_health_target = clamp_int(math.floor(player.health), 0, constants.damage.max_health)

	if self.hud_health_level ~= self.hud_health_target then
		self.hud_health_anim_ticks = self.hud_health_anim_ticks + 1
		if self.hud_health_anim_ticks >= constants.hud.health_anim_step_frames then
			self.hud_health_anim_ticks = 0
			self.hud_health_level = animate_level(self.hud_health_level, self.hud_health_target)
		end
	else
		self.hud_health_anim_ticks = 0
	end

	if self.hud_weapon_level ~= self.hud_weapon_target then
		self.hud_weapon_anim_ticks = self.hud_weapon_anim_ticks + 1
		if self.hud_weapon_anim_ticks >= constants.hud.weapon_anim_step_frames then
			self.hud_weapon_anim_ticks = 0
			self.hud_weapon_level = animate_level(self.hud_weapon_level, self.hud_weapon_target)
		end
	else
		self.hud_weapon_anim_ticks = 0
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
			hud_health_target = constants.hud.health_level,
			hud_health_anim_ticks = 0,
			hud_weapon_level = constants.hud.weapon_level,
			hud_weapon_target = constants.hud.weapon_level,
			hud_weapon_anim_ticks = 0,
			space_id = constants.spaces.castle,
			tick_enabled = true,
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
