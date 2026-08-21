local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local timeline<const> = require('cartlib/timeline/timeline')
local clamp<const> = require('cartlib/util/clamp')
local abs<const> = math.abs
require('constants')

local ui<const> = {}
ui.__index = ui
local hud_hidden_events<const> = {
	'intro',
	'story',
	'epilogue',
	'end_demo',
	'title',
}
local sources<const> = {
	header = image.resolve('game_header'),
	health_stripe = image.resolve('energybar_stripe_blue'),
	weapon_stripe = image.resolve('energybar_stripe_red'),
	secondary_weapon = {
		pepernoot = image.resolve('pepernoot_16'),
		spyglass = image.resolve('spyglass'),
	},
}
local health_animation_timeline_id<const> = 'ui.tl.health'
local weapon_animation_timeline_id<const> = 'ui.tl.weapon'

local build_meter_frames<const> = function(params)
	return timeline.range(params.frame_count)
end

local apply_health_frame<const> = function(target, frame, params)
	target.hud_health_level = params.from + params.direction * (frame // hud_health_anim_step_frames)
end

local apply_weapon_frame<const> = function(target, frame, params)
	target.hud_weapon_level = params.from + params.direction * (frame // hud_weapon_anim_step_frames)
end

local play_meter_animation<const> = function(self, timeline_id, current, target, step_frames)
	if current == target then
		self.timelines:stop(timeline_id)
		return
	end
	self.timelines:play(timeline_id, {
		snap_to_start = false,
		params = {
			from = current,
			direction = target > current and 1 or -1,
			frame_count = abs(target - current) * step_frames + 1,
		},
	})
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

function ui:animate_health_change(_state, event)
	local target<const> = clamp(event.value // 1, 0, damage_max_health)
	if target == self.hud_health_target then
		return
	end
	self.hud_health_target = target
	play_meter_animation(
		self,
		health_animation_timeline_id,
		self.hud_health_level,
		target,
		hud_health_anim_step_frames
	)
end

function ui:sync_health()
	self.timelines:stop(health_animation_timeline_id)
	local health<const> = clamp(self.player.health // 1, 0, damage_max_health)
	self.hud_health_level = health
	self.hud_health_target = health
end

function ui:animate_weapon_change(_state, event)
	local target<const> = clamp(event.value // 1, 0, hud_weapon_level)
	if target == self.hud_weapon_target then
		return
	end
	self.hud_weapon_target = target
	play_meter_animation(
		self,
		weapon_animation_timeline_id,
		self.hud_weapon_level,
		target,
		hud_weapon_anim_step_frames
	)
end

function ui:ctor()
	self:get_component(custom_visual_component):set_draw_function(draw_ui)
	local player<const> = self.player
	local weapon<const> = clamp(player.weapon_level // 1, 0, hud_weapon_level)
	self.hud_visible = true
	self:sync_health()
	self.hud_weapon_level = weapon
	self.hud_weapon_target = weapon
end

function ui:show_hud()
	self.hud_visible = true
end

function ui:hide_hud()
	self.hud_visible = false
end

local define_ui_fsm<const> = function()
	local on<const> = {
		['room'] = {
			emitter = 'd',
			go = '/active',
		},
		['victory_dance'] = {
			emitter = 'd',
			go = '/active',
		},
		['player.health_changed'] = {
			emitter = 'pietolon',
			go = ui.animate_health_change,
		},
		['respawn'] = {
			emitter = 'pietolon',
			go = ui.sync_health,
		},
		['player.weapon_changed'] = {
			emitter = 'pietolon',
			go = ui.animate_weapon_change,
		},
	}
	for i = 1, #hud_hidden_events do
		on[hud_hidden_events[i]] = {
			emitter = 'd',
			go = '/hidden',
		}
	end
	fsm_library.register('ui', {
		initial = 'active',
		timelines = {
			[health_animation_timeline_id] = {
				def = {
					frames = build_meter_frames,
					playback_mode = 'once',
					apply = apply_health_frame,
				},
				autoplay = false,
			},
			[weapon_animation_timeline_id] = {
				def = {
					frames = build_meter_frames,
					playback_mode = 'once',
					apply = apply_weapon_frame,
				},
				autoplay = false,
			},
		},
		on = on,
		states = {
			active = {
				entering_state = ui.show_hud,
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
		components = {
			custom_visual_component.new,
			timeline_component.new,
			fsm_component.factory({ 'ui' }),
		},
		defaults = {
			hud_health_level = hud_health_level,
			hud_health_target = hud_health_level,
			hud_weapon_level = hud_weapon_level,
			hud_weapon_target = hud_weapon_level,
		},
	})
end

return {
	ui = ui,
	define_ui_fsm = define_ui_fsm,
	register_ui_definition = register_ui_definition,
}
