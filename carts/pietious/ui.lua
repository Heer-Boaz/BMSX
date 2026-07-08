local clamp<const> = require('bios/util/clamp')
require('constants')

local ui<const> = {}
ui.__index = ui

local animate_level<const> = function(current, target)
	if current < target then
		return current + 1
	end
	if current > target then
		return current - 1
	end
	return current
end

local secondary_weapon_sprite_id<const> = function(item_type)
	if item_type == nil then
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
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function()
		self:draw_ui()
	end
end

function ui:set_health_target(value)
	self.hud_health_target = clamp(value // 1, 0, damage_max_health)
end

function ui:set_weapon_target(value)
	self.hud_weapon_target = clamp(value // 1, 0, hud_weapon_level)
end

function ui:ctor()
	self:bind_visual()
	local player<const> = oget('pietolon')
	local health<const> = clamp(player.health // 1, 0, damage_max_health)
	local weapon<const> = clamp(player.weapon_level // 1, 0, hud_weapon_level)
	self.hud_visible = true
	self.hud_health_level = health
	self.hud_health_target = health
	self.hud_health_anim_ticks = 0
	self.hud_weapon_level = weapon
	self.hud_weapon_target = weapon
	self.hud_weapon_anim_ticks = 0
end

function ui:show_hud()
	self.hud_visible = true
end

function ui:hide_hud()
	self.hud_visible = false
end

function ui:update_hud_animation()
	if self.hud_health_level ~= self.hud_health_target then
		self.hud_health_anim_ticks = self.hud_health_anim_ticks + 1
		if self.hud_health_anim_ticks >= hud_health_anim_step_frames then
			self.hud_health_anim_ticks = 0
			self.hud_health_level = animate_level(self.hud_health_level, self.hud_health_target)
		end
	else
		self.hud_health_anim_ticks = 0
	end

	if self.hud_weapon_level ~= self.hud_weapon_target then
		self.hud_weapon_anim_ticks = self.hud_weapon_anim_ticks + 1
		if self.hud_weapon_anim_ticks >= hud_weapon_anim_step_frames then
			self.hud_weapon_anim_ticks = 0
			self.hud_weapon_level = animate_level(self.hud_weapon_level, self.hud_weapon_target)
		end
	else
		self.hud_weapon_anim_ticks = 0
	end
end

function ui:draw_ui()
	if not self.hud_visible then
		return
	end
	local player<const> = oget('pietolon')
	vdp_blit_img_color('game_header', 0, 0, 200, 0x00000001, 1, 1, 0, 0xffffffff, 0)
	local equipped_sprite_id<const> = secondary_weapon_sprite_id(player.secondary_weapon)
	if equipped_sprite_id ~= nil then
		vdp_blit_img_color(equipped_sprite_id, hud_equipped_item_x * room_tile_size, hud_equipped_item_y * room_tile_size, 202, 0x00000001, 1, 1, 0, 0xffffffff, 0)
	end
	for i = 0, (self.hud_health_level - 1) do
		vdp_blit_img_color('energybar_stripe_blue', hud_health_bar_x + i, hud_health_bar_y, 201, 0x00000001, 1, 1, 0, 0xffffffff, 0)
	end
	for i = 0, (self.hud_weapon_level - 1) do
		vdp_blit_img_color('energybar_stripe_red', hud_weapon_bar_x + i, hud_weapon_bar_y, 201, 0x00000001, 1, 1, 0, 0xffffffff, 0)
	end
end

local define_ui_fsm<const> = function()
	define_fsm('ui', {
		initial = 'active',
		on = {
			['room'] = {
				emitter = 'd',
				go = '/active',
			},
			['title'] = {
				emitter = 'd',
				go = '/hidden',
			},
			['title_wait'] = {
				emitter = 'd',
				go = '/hidden',
			},
			['player.health_changed'] = {
				emitter = 'pietolon',
				go = function(self, _state, event)
					self:set_health_target(event.value)
				end,
			},
			['player.weapon_changed'] = {
				emitter = 'pietolon',
				go = function(self, _state, event)
					self:set_weapon_target(event.value)
				end,
			},
		},
		states = {
			active = {
				entering_state = ui.show_hud,
				update = ui.update_hud_animation,
			},
			hidden = {
				entering_state = ui.hide_hud,
			},
		},
	})
end

local register_ui_definition<const> = function()
	define_prefab({
		def_id = 'ui',
		class = ui,
		fsms = { 'ui' },
		components = { 'customvisualcomponent' },
		defaults = {
			hud_health_level = hud_health_level,
			hud_health_target = hud_health_level,
			hud_health_anim_ticks = 0,
			hud_weapon_level = hud_weapon_level,
			hud_weapon_target = hud_weapon_level,
			hud_weapon_anim_ticks = 0,
		},
	})
end

return {
	ui = ui,
	define_ui_fsm = define_ui_fsm,
	register_ui_definition = register_ui_definition,
}
