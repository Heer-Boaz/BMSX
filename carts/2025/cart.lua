local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240_pal()
require('cartlib/prelude')
local texture_residency<const> = require('texture_residency')
require('globals')
local story<const> = require('story')
local start_node<const> = 'title'
-- local start_node<const> = 'combat_wekker'
local irq_mask_register<const>: *word = 0x08000010
local input_control_register<const>: *word = 0x0800006c
local irq_dma_done<const> = 0x0001
local irq_vblank<const> = 0x0004
local irq_apu<const> = 0x0020
local vblank_count = 0

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

local combat_module<const> = require('combat')
local dialogue_module<const> = require('dialogue')
local transition_module<const> = require('transition')
local dialogue_node_kinds<const> = {
	dialogue = true,
	dialogue_inline = true,
}
local world_events<const> = eventemitter.events_of('world')

local director_def_id<const> = 'p3.director'
local director_fsm_id<const> = 'p3.director.fsm'
local combat_director_instance = nil

local director<const> = {}
director.__index = director

local create_rect_state<const> = function()
	return {
		visible = false,
		x = 0,
		y = 0,
		width = 0,
		height = 0,
		color = 0,
	}
end

local create_transition_visuals<const> = function()
	local overlay<const> = create_rect_state()
	overlay.blend_color = 0
	overlay.blend_mode = gx_draw_mode_blend_half
	return {
		overlay = overlay,
		panels = {
			create_rect_state(),
			create_rect_state(),
			create_rect_state(),
		},
		accent = create_rect_state(),
	}
end

local draw_director_visual<const> = function(parent)
	local results<const> = parent.combat_results_visual
	if results.visible then
		gx_fill_rect_color(results.x, results.y, results.x + results.width, results.y + results.height, results.color)
	end
	local overlay<const> = parent.transition_visual.overlay
	if overlay.color ~= 0 and overlay.visible then
		gx_fill_rect_color(overlay.x, overlay.y, overlay.x + overlay.width, overlay.y + overlay.height, overlay.color)
	end
	if overlay.blend_color ~= 0 then
		gx_set_draw_mode(overlay.blend_mode)
		gx_fill_rect_semitrans_color(overlay.x, overlay.y, overlay.x + overlay.width, overlay.y + overlay.height, overlay.blend_color)
	end
	for i = 1, #parent.transition_visual.panels do
		local panel<const> = parent.transition_visual.panels[i]
		if panel.visible then
			gx_fill_rect_color(panel.x, panel.y, panel.x + panel.width, panel.y + panel.height, panel.color)
		end
	end
	local accent<const> = parent.transition_visual.accent
	if accent.visible then
		gx_fill_rect_color(accent.x, accent.y, accent.x + accent.width, accent.y + accent.height, accent.color)
	end
end

function director:ctor()
	local transition_rc<const> = self:get_component('customvisualcomponent')
	transition_rc.offset.z = director_visual_z
	transition_rc.producer = draw_director_visual
end

function director:apply_effects(effects)
	for i = 1, #effects do
		local effect<const> = effects[i]
		self.stats[effect.stat] = self.stats[effect.stat] + effect.add
	end
end

dialogue_module.register_methods(director)

local build_director_fsm<const> = function()
	local states<const> = {
		boot = {
			entering_state = function(self)
					self.transition_visual = create_transition_visuals()
					self.combat_results_visual = create_rect_state()
				self.stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 }
				self.inline_pages = {}
				self.inline_next = nil
				self.just_finished_combat = false
				self.skip_combat_fade_in = false
				self.skip_transition_fade = false
				self.fade_hold_black = false
				clear_texts(text_ids_all)
				hide_combat_sprites()
				return '/run_node'
			end,
		},
		run_node = {
			entering_state = function(self)
				local node<const> = story[self.node_id]
				local just_finished_combat<const> = self.just_finished_combat
				world_events:emit('story.node.enter', { node_id = self.node_id, node_kind = node.kind, bg = node.bg, label = node.label, just_finished_combat = just_finished_combat, last_combat_monster_imgid = self.last_combat_monster_imgid })
				self.just_finished_combat = false
				if node.kind == 'transition' then
					return '/transition'
				end
				if dialogue_node_kinds[node.kind] then
					return '/dialogue'
				end
				if node.kind == 'ending' then
					return '/ending'
				end
				if node.kind == 'bg_only' then
					return '/bg_only'
				end
				if node.kind == 'choice' then
					return '/choice'
				end
				if node.kind == 'fade' then
					return '/fade'
				end
				if node.kind == 'combat' then
					combat_director_instance:start_combat(self.node_id, self.skip_combat_fade_in)
					world_events:emit('combat.start', { node_id = self.node_id, monster_imgid = node.monster_imgid, skip_fade_in = self.skip_combat_fade_in })
					self.skip_combat_fade_in = false
					return '/combat_wait'
				end
			end,
		},
		combat_wait = {
			on = {
				['combat.end'] = {
					go = function(self, _state, event)
						self.node_id = event.next_node_id
						self.just_finished_combat = true
						self.last_combat_monster_imgid = event.monster_imgid
						self.skip_transition_fade = event.skip_transition_fade
						self:apply_effects(event.rewards)
						return '/run_node'
					end,
				},
			},
		},
	}

	transition_module.register_states(states)
	dialogue_module.register_states(states)

	define_fsm(director_fsm_id, {
		initial = 'boot',
		states = states,
	})
end
local register_director<const> = function()
	define_prefab({
		def_id = director_def_id,
		class = director,
		type = 'object',
		fsms = { director_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			node_id = start_node,
			page_index = 1,
			choice_index = 1,
			stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 },
			inline_pages = {},
			inline_next = nil,
			pages = {},
			transition_center_x = 0,
			transition_target_bg = story.title.bg,
			transition_style = 'dialogue',
			transition_palette = p3_transition_palette_dialogue,
			transition_panels = {},
			transition_accent = {
				color = p3_transition_palette_dialogue.accent,
				width = 0,
				height = 0,
				y = 0,
				x_in = 0,
				x_hold = 0,
				x_out = 0,
				offset = 999,
			},
			transition_needs_post_fade = false,
			fade_target_bg = story.title.bg,
			fade_style = 'dialogue',
			fade_palette = p3_transition_palette_dialogue,
			skip_combat_fade_in = false,
			skip_transition_fade = false,
			fade_hold_black = false,
			just_finished_combat = false,
		},
	})
	define_prefab({
		def_id = 'p3.bg',
		class = {},
		type = 'sprite',
	})
	define_prefab({
		def_id = 'p3.text.main',
		class = {},
		type = 'textobject',
	})
	define_prefab({
		def_id = 'p3.text.choice',
		class = {},
		type = 'textobject',
	})
	define_prefab({
		def_id = 'p3.text.prompt',
		class = {},
		type = 'textobject',
	})
	define_prefab({
		def_id = 'p3.text.transition',
		class = {},
		type = 'textobject',
	})
	define_prefab({
		def_id = 'p3.text.results',
		class = {},
		type = 'textobject',
	})
	define_prefab({
		def_id = 'p3.combat.monster',
		class = {},
		type = 'sprite',
	})
	define_prefab({
		def_id = 'p3.combat.maya_a',
		class = {},
		type = 'sprite',
	})
	define_prefab({
		def_id = 'p3.combat.maya_b',
		class = {},
		type = 'sprite',
	})
	define_prefab({
		def_id = 'p3.combat.all_out',
		class = {},
		type = 'sprite',
	})
end

function init()
	on_irq(irq_dma_done, texture_residency.complete_upload)
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
	*irq_mask_register = irq_dma_done | irq_vblank | irq_apu
	gx_clear_color(0xff000000)
	combat_module.define_fsm()
	build_director_fsm()
	combat_module.register_director()
	register_director()
end

function new_game()
	reset()
	local w<const> = screen_width
	local h<const> = screen_height
	local line_height<const> = 16
	local prompt_lines<const> = 1
	local choice_lines<const> = 4
	local main_lines<const> = 4
	local prompt_top<const> = h - (line_height * prompt_lines)
	local choice_top<const> = h - (line_height * (prompt_lines + choice_lines))
	local main_top<const> = h - (line_height * (prompt_lines + choice_lines + main_lines))

	inst('p3.bg', {
		id = bg_id,
		pos = { x = 0, y = 0, z = 0 },
		visible = false,
	})

	local horizontal_margin<const> = w / 10
		inst('p3.text.main', {
			id = text_main_id,
			dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = main_top, bottom = choice_top },
			blank_lines = 1,
			pos = { z = 1000 },
		})
		inst('p3.text.choice', {
			id = text_choice_id,
			dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = choice_top, bottom = prompt_top },
			blank_lines = 1,
			pos = { z = 1001 },
			highlight_move_enabled = true,
			highlight_pulse_enabled = true,
			highlight_jitter_enabled = false,
		})
		inst('p3.text.prompt', {
			id = text_prompt_id,
			dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = prompt_top, bottom = h },
			blank_lines = 1,
			pos = { z = 1002 },
		})
		inst('p3.text.transition', {
			id = text_transition_id,
			dimensions = { left = 0, right = w, top = (h / 2) - (line_height * 2), bottom = (h / 2) + (line_height * 2) },
			blank_lines = 1,
			pos = { z = 900 },
			text_color = p3_ink_color,
			normal_bg_color = p3_white_color,
		})
		inst('p3.text.results', {
			id = text_results_id,
			dimensions = { left = horizontal_margin, right = w - (w / 3), top = line_height * 2, bottom = h - (h / 3) },
			blank_lines = 1,
			pos = { z = 1003 },
		})

	clear_texts(text_ids_all)

	inst('p3.combat.monster', {
		id = combat_monster_id,
		pos = { x = 0, y = 0, z = 200 },
		imgid = 'monster_snoozer',
		visible = false,
	})
	inst('p3.combat.maya_a', {
		id = combat_maya_a_id,
		pos = { x = 0, y = 0, z = combat_maya_z },
		imgid = 'maya_a',
		visible = false,
	})
	inst('p3.combat.maya_b', {
		id = combat_maya_b_id,
		pos = { x = 0, y = 0, z = combat_maya_z },
		imgid = 'maya_b',
		visible = false,
	})
	inst('p3.combat.all_out', {
		id = combat_all_out_id,
		pos = { x = 0, y = 0, z = 800 },
		imgid = 'all_out',
		visible = false,
	})

	combat_director_instance = inst(combat_director_def_id, { id = combat_director_instance_id })
	inst(director_def_id, { id = director_instance_id })
end

init()
texture_residency.replace_background(story.title.bg)
new_game()
*input_control_register = 0x00000001
while true do
	wait_vblank()

	update_world()
	gx_clear_color(0xff000000)
	draw_world()
	texture_residency.submit_pending_background()

	*input_control_register = 0x00000001
end
