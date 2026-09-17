local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local story<const> = require('story')
local combat_module<const> = require('combat')
local dialogue_module<const> = require('dialogue')
local transition_module<const> = require('transition')
local combat_director_definition_id<const> = combat_module.director_definition_id
local start_node<const> = 'title'
require('globals')

local dialogue_node_kinds<const> = {
	dialogue = true,
	dialogue_inline = true,
}

local director_def_id<const> = 'p3.director'
local story_director_fsm_id<const> = 'p3.director.fsm'

local director<const> = {}
director.__index = director

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
				clear_texts(self.texts)
				return '/run_node'
			end,
		},
		run_node = {
			entering_state = function(self)
				local node<const> = story[self.node_id]
				local just_finished_combat<const> = self.just_finished_combat
				self.events:emit('story.node.enter', { node_id = self.node_id, node_kind = node.kind, bg = node.bg, label = node.label, just_finished_combat = just_finished_combat, last_combat_monster_imgid = self.last_combat_monster_imgid })
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
					self.combat_director:start_combat(self.node_id, self.skip_combat_fade_in)
					self.events:emit('combat.start', { node_id = self.node_id, monster_imgid = node.monster_imgid, skip_fade_in = self.skip_combat_fade_in })
					self.skip_combat_fade_in = false
					return '/combat_wait'
				end
			end,
		},
		combat_wait = {
			on = {
				['combat.end'] = {
					emitter = combat_director_definition_id,
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

	fsm_library.register(story_director_fsm_id, {
		initial = 'boot',
		states = states,
	})
end
local register_director<const> = function()
	prefab.define({
		def_id = director_def_id,
		class = director,
		components = {
			timeline_component.new,
			fsm_component.factory({ story_director_fsm_id }),
		},
		defaults = {
			player_index = 1,
			node_id = start_node,
			page_index = 1,
			choice_index = 1,
			inline_next = nil,
			transition_center_x = 0,
			transition_target_bg = story.title.bg,
			transition_style = 'dialogue',
			transition_palette = p3_transition_palette_dialogue,
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

return { definition_id = director_def_id, register = function()
	build_director_fsm()
	register_director()
end }
