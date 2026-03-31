require('globals')
require('story')
local start_node<const> = 'title'
-- local start_node = 'combat_wekker'

local combat_module<const> = require('combat')
local dialogue_module<const> = require('dialogue')
local transition_module<const> = require('transition')
local dialogue_node_kinds<const> = {
	dialogue = true,
	dialogue_inline = true,
}

local director_def_id<const> = 'p3.director'
local director_fsm_id<const> = 'p3.director.fsm'
local combat_director_instance = nil

local director<const> = {}
director.__index = director

-- Example: optional hook for atlas load completion (return true to skip BIOS mapping).
local on_vdp_load_example<const> = function(job_id, slot, atlas_id, status)
	-- Example: handle "done"/"error" and optionally call vdp_map_slot(slot, atlas_id).
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
				$.emit('story.node.enter', 'world', { node_id = self.node_id, node_kind = node.kind, bg = node.bg, label = node.label, just_finished_combat = just_finished_combat, last_combat_monster_imgid = self.last_combat_monster_imgid })
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
					combat_director_instance:start_combat(self.node_id, { skip_fade_in = self.skip_combat_fade_in })
					$.emit('combat.start', 'world', { node_id = self.node_id, monster_imgid = node.monster_imgid, skip_fade_in = self.skip_combat_fade_in })
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
				id = transition_accent_id,
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
	mem[sys_vdp_dither] = 2
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	on_vdp_load(on_vdp_load_example) -- Example registration; remove if not needed.
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
	combat_module.define_fsm()
	build_director_fsm()
	combat_module.register_director()
	register_director()
end

function new_game()
	local w<const> = display_width()
	local h<const> = display_height()
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
	inst('p3.bg', {
		id = transition_overlay_id,
		pos = { x = 0, y = 0, z = 850 },
		imgid = 'whitepixel',
		visible = false,
	})
	inst('p3.bg', {
		id = transition_panel_ids[1],
		pos = { x = 0, y = 0, z = 860 },
		imgid = 'whitepixel',
		visible = false,
	})
	inst('p3.bg', {
		id = transition_panel_ids[2],
		pos = { x = 0, y = 0, z = 861 },
		imgid = 'whitepixel',
		visible = false,
	})
	inst('p3.bg', {
		id = transition_panel_ids[3],
		pos = { x = 0, y = 0, z = 862 },
		imgid = 'whitepixel',
		visible = false,
	})
	inst('p3.bg', {
		id = transition_accent_id,
		pos = { x = 0, y = 0, z = 870 },
		imgid = 'whitepixel',
		visible = false,
	})

	local horizontal_margin<const> = w / 10
	inst('p3.text.main', {
		id = text_main_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = main_top, bottom = choice_top },
		pos = { z = 1000 },
		layer = sys_vdp_layer_ui,
	})
	inst('p3.text.choice', {
		id = text_choice_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = choice_top, bottom = prompt_top },
		pos = { z = 1001 },
		highlight_move_enabled = true,
		highlight_pulse_enabled = true,
		highlight_jitter_enabled = false,
		layer = sys_vdp_layer_ui,
	})
	inst('p3.text.prompt', {
		id = text_prompt_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = prompt_top, bottom = h },
		pos = { z = 1002 },
		layer = sys_vdp_layer_ui,
	})
	inst('p3.text.transition', {
		id = text_transition_id,
		dimensions = { left = 0, right = w, top = (h / 2) - (line_height * 2), bottom = (h / 2) + (line_height * 2) },
		pos = { z = 900 },
		layer = sys_vdp_layer_ui,
	})
	inst('p3.text.results', {
		id = text_results_id,
		dimensions = { left = horizontal_margin, right = w - (w / 3), top = line_height * 2, bottom = h - (h / 3) },
		pos = { z = 1003 },
		layer = sys_vdp_layer_ui,
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
		pos = { x = 0, y = 0, z = 300 },
		imgid = 'maya_a',
		visible = false,
	})
	inst('p3.combat.maya_b', {
		id = combat_maya_b_id,
		pos = { x = 0, y = 0, z = 300 },
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

local test<const> = function()
	-- assert(false)
end

local cart_update<const> = function(_dt)
	-- assert(false)
	-- print(_dt)
	test()
end

local service_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
end

while true do
	wait_vblank()
	service_irqs()
	cart_update()
	update()
end
