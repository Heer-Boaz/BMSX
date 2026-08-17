local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local clamp<const> = require('cartlib/util/clamp')
require('constants')

local ui<const> = {}
ui.__index = ui
local sources<const> = {
	header = image.resolve('game_header'),
	health_stripe = image.resolve('energybar_stripe_blue'),
	weapon_stripe = image.resolve('energybar_stripe_red'),
	secondary_weapon = {
		pepernoot = image.resolve('pepernoot_16'),
		spyglass = image.resolve('spyglass'),
	},
}

local animate_level<const> = function(current, target)
	if current < target then
		return current + 1
	end
	if current > target then
		return current - 1
	end
	return current
end

local draw_ui<const> = function(component, draw)
	local owner<const> = component.parent
	if not owner.hud_visible then
		return
	end
	local player<const> = owner.player
	sources.header:blit(draw, 0, 0)
	for i = 0, (owner.hud_health_level - 1) do
		sources.health_stripe:blit(draw, hud_health_bar_x + i, hud_health_bar_y)
	end
	for i = 0, (owner.hud_weapon_level - 1) do
		sources.weapon_stripe:blit(draw, hud_weapon_bar_x + i, hud_weapon_bar_y)
	end
	local equipped_source<const> = sources.secondary_weapon[player.secondary_weapon]
	if equipped_source ~= nil then
		equipped_source:blit(draw, hud_equipped_item_x * room_tile_size, hud_equipped_item_y * room_tile_size)
	end
end

function ui:set_health_target(value)
	self.hud_health_target = clamp(value // 1, 0, damage_max_health)
end

function ui:sync_health()
	local health<const> = clamp(self.player.health // 1, 0, damage_max_health)
	self.hud_health_level = health
	self.hud_health_target = health
	self.hud_health_anim_ticks = 0
end

function ui:set_weapon_target(value)
	self.hud_weapon_target = clamp(value // 1, 0, hud_weapon_level)
end

function ui:ctor()
	self:get_component(custom_visual_component):set_draw_function(draw_ui)
	local player<const> = self.player
	local weapon<const> = clamp(player.weapon_level // 1, 0, hud_weapon_level)
	self.hud_visible = true
	self:sync_health()
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

local define_ui_fsm<const> = function()
	fsm_library.register('ui', {
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
			['respawn'] = {
				emitter = 'pietolon',
				go = ui.sync_health,
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
	prefab.define({
		def_id = 'ui',
		class = ui,
		components = { custom_visual_component.new, fsm_component.factory({ 'ui' }) },
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
