require('globals.lua')
require('story.lua')

local start_node = 'title'
-- local start_node = 'combat_wekker'

local combat_module = require('combat.lua')
local dialogue_module = require('dialogue.lua')
local transition_module = require('transition.lua')

local director_def_id = 'p3.director'
local director_fsm_id = 'p3.director.fsm'
local combat_director_instance = nil

-- { planning = 0, opdekin = 0, rust = 0, makeup = 0 }

local director = {}
director.__index = director

function director:apply_effects(effects)
	for i = 1, #effects do
		local effect = effects[i]
		self.stats[effect.stat] = self.stats[effect.stat] + effect.add
	end
end

dialogue_module.register_methods(director)

local function build_director_fsm()
	local states = {
		boot = {
			entering_state = function(self)
				self.stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 }
				self.inline_pages = {}
				self.inline_next = ''
				self.just_finished_combat = false
				self.last_combat_monster_imgid = nil
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
				local node = story[self.node_id]
				local just_finished_combat = self.just_finished_combat
				$.emit('story.node.enter', 'world', { node_id = self.node_id, node_kind = node.kind, bg = node.bg, label = node.label, just_finished_combat = just_finished_combat, last_combat_monster_imgid = self.last_combat_monster_imgid })
				self.just_finished_combat = false
				if node.kind == 'transition' then
					return '/transition'
				end
				if node.kind == 'dialogue' or node.kind == 'dialogue_inline' then
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
local function register_director()
	define_world_object({
		def_id = director_def_id,
		class = director,
		fsms = { director_fsm_id },
		defaults = {
			node_id = start_node,
			page_index = 1,
			choice_index = 1,
			stats = { planning = 0, opdekin = 0, rust = 0, makeup = 0 },
			inline_pages = {},
			inline_next = '',
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
end

function init()
	combat_module.define_fsm()
	build_director_fsm()
	combat_module.register_director()
	register_director()
end

function new_game()
	local w = display_width()
	local h = display_height()
	local line_height = 16
	local prompt_lines = 1
	local choice_lines = 4
	local main_lines = 4
	local prompt_top = h - (line_height * prompt_lines)
	local choice_top = h - (line_height * (prompt_lines + choice_lines))
	local main_top = h - (line_height * (prompt_lines + choice_lines + main_lines))

	spawn_sprite('p3.bg.def', {
		id = bg_id,
		pos = { x = 0, y = 0, z = 0 },
		imgid = 'none',
		visible = false,
	})
	spawn_sprite('p3.bg.def', {
		id = transition_overlay_id,
		pos = { x = 0, y = 0, z = 850 },
		imgid = 'whitepixel',
		visible = false,
	})
	spawn_sprite('p3.bg.def', {
		id = transition_panel_ids[1],
		pos = { x = 0, y = 0, z = 860 },
		imgid = 'whitepixel',
		visible = false,
	})
	spawn_sprite('p3.bg.def', {
		id = transition_panel_ids[2],
		pos = { x = 0, y = 0, z = 861 },
		imgid = 'whitepixel',
		visible = false,
	})
	spawn_sprite('p3.bg.def', {
		id = transition_panel_ids[3],
		pos = { x = 0, y = 0, z = 862 },
		imgid = 'whitepixel',
		visible = false,
	})
	spawn_sprite('p3.bg.def', {
		id = transition_accent_id,
		pos = { x = 0, y = 0, z = 870 },
		imgid = 'whitepixel',
		visible = false,
	})

	local horizontal_margin = w / 10
	spawn_textobject('p3.text.main.def', {
		id = text_main_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = main_top, bottom = choice_top },
		pos = { z = 1000 },
	})
	spawn_textobject('p3.text.choice.def', {
		id = text_choice_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = choice_top, bottom = prompt_top },
		pos = { z = 1001 },
	})
	spawn_textobject('p3.text.prompt.def', {
		id = text_prompt_id,
		dimensions = { left = horizontal_margin, right = w - horizontal_margin, top = prompt_top, bottom = h },
		pos = { z = 1002 },
	})
	spawn_textobject('p3.text.transition.def', {
		id = text_transition_id,
		dimensions = { left = 0, right = w, top = (h / 2) - (line_height * 2), bottom = (h / 2) + (line_height * 2) },
		pos = { z = 900 },
	})
	spawn_textobject('p3.text.results.def', {
		id = text_results_id,
		dimensions = { left = horizontal_margin, right = w - (w / 3), top = line_height * 2, bottom = h - (h / 3) },
		pos = { z = 1003 },
	})

	clear_texts(text_ids_all)

	spawn_sprite('p3.combat.monster.def', {
		id = combat_monster_id,
		pos = { x = 0, y = 0, z = 200 },
		imgid = 'monster_snoozer',
		visible = false,
	})
	spawn_sprite('p3.combat.maya_a.def', {
		id = combat_maya_a_id,
		pos = { x = 0, y = 0, z = 300 },
		imgid = 'maya_a',
		visible = false,
	})
	spawn_sprite('p3.combat.maya_b.def', {
		id = combat_maya_b_id,
		pos = { x = 0, y = 0, z = 300 },
		imgid = 'maya_b',
		visible = false,
	})
	spawn_sprite('p3.combat.all_out.def', {
		id = combat_all_out_id,
		pos = { x = 0, y = 0, z = 800 },
		imgid = 'all_out',
		visible = false,
	})

	combat_director_instance = spawn_object(combat_director_def_id, { id = combat_director_instance_id })
	spawn_object(director_def_id, { id = director_instance_id })
end

local function test()
	-- print "bla"
	-- assert(false)
end

function update(_dt)
	-- assert(false)
	-- print(a.b + 3)
	test()
end

function draw()
end
