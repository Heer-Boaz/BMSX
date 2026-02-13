local constants = require('constants')

local ui = {}
ui.__index = ui

local function animate_level(current, target)
	if current < target then
		return current + 1
	end
	if current > target then
		return current - 1
	end
	return current
end

local function secondary_weapon_sprite_id(item_type)
	if item_type == 'none' then
		return nil
	end
	if item_type == 'pepernoot' then
		return 'pepernoot_16'
	end
	if item_type == 'spyglass' then
		return 'spyglass'
	end
	error('pietious ui invalid secondary_weapon=' .. tostring(item_type))
end

function ui:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_ui()
	end
end

function ui:ctor()
	self:bind_visual()
	local player = object(constants.ids.player_instance)
	local health = clamp_int(math.modf(player.health), 0, constants.damage.max_health)
	local weapon = clamp_int(math.modf(player.weapon_level), 0, constants.hud.weapon_level)
	self.hud_health_level = health
	self.hud_health_target = health
	self.hud_health_anim_ticks = 0
	self.hud_weapon_level = weapon
	self.hud_weapon_target = weapon
	self.hud_weapon_anim_ticks = 0
end

function ui:tick()
	local player = object(constants.ids.player_instance)
	self.hud_health_target = clamp_int(math.modf(player.health), 0, constants.damage.max_health)
	self.hud_weapon_target = clamp_int(math.modf(player.weapon_level), 0, constants.hud.weapon_level)

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
	local player = object(constants.ids.player_instance)
	put_sprite('game_header', 0, 0, 200)
	local equipped_sprite_id = secondary_weapon_sprite_id(player.secondary_weapon)
	if equipped_sprite_id ~= nil then
		put_sprite(equipped_sprite_id, constants.hud.equipped_item_x * constants.room.tile_size, constants.hud.equipped_item_y * constants.room.tile_size, 202)
	end

	for i = 0, (self.hud_health_level - 1) do
		put_sprite('energybar_stripe_blue', constants.hud.health_bar_x + i, constants.hud.health_bar_y, 201)
	end

	for i = 0, (self.hud_weapon_level - 1) do
		put_sprite('energybar_stripe_red', constants.hud.weapon_bar_x + i, constants.hud.weapon_bar_y, 201)
	end
end

local function define_ui_fsm()
	define_fsm(constants.ids.ui_fsm, {
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
	define_prefab({
		def_id = constants.ids.ui_def,
		class = ui,
		fsms = { constants.ids.ui_fsm },
			components = { 'customvisualcomponent' },
			defaults = {
				hud_health_level = constants.hud.health_level,
				hud_health_target = constants.hud.health_level,
			hud_health_anim_ticks = 0,
			hud_weapon_level = constants.hud.weapon_level,
			hud_weapon_target = constants.hud.weapon_level,
			hud_weapon_anim_ticks = 0,
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
