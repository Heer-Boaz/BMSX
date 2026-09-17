module<entry>
local gx_display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_320x240()
local input<const> = require('cartlib/input/input')
input.add_player(1)
input.push_context(1, '2025', { confirm = { 'KeyX' } }, { confirm = { 'a' } })
local world<const> = require('cartlib/world/world')
world:configure(require('world_module'))
require('pietsona_font').register_fonts()
require('globals')
local atlas<const> = require('cartlib/gx/atlas')
local image<const> = require('cartlib/gx/image')
local story<const> = require('story')
local combat_module<const> = require('combat')
local director_module<const> = require('director')
local presentation<const> = require('presentation')
local scene_library<const> = require('cartlib/world/scene_library')
local dialogue_scene<const> = require('scenes/dialogue')
local combat_scene<const> = require('scenes/combat')
local transition_scene<const> = require('scenes/transition')

local function init<init>()
	presentation.register()
	combat_module.define_fsm()
	combat_module.register_director()
	director_module.register()
	dialogue_scene.register()
	combat_scene.register()
	transition_scene.register()
end

function new_game()
	world:clear()
	local dialogue<const> = scene_library.instantiate(dialogue_scene.id)
	local combat<const> = scene_library.instantiate(combat_scene.id)
	local transition<const> = scene_library.instantiate(transition_scene.id)
	local background<const> = dialogue.background
	local text_main<const> = dialogue.main
	local text_choice<const> = dialogue.choice
	local text_prompt<const> = dialogue.prompt
	local text_transition<const> = transition.caption
	local text_results<const> = combat.results
	local monster<const> = combat.monster
	local maya_a<const> = combat.maya_a
	local maya_b<const> = combat.maya_b
	local all_out<const> = combat.all_out
	local all_out_portrait<const> = combat.portrait
	local texts<const> = { text_main, text_choice, text_prompt, text_transition, text_results }
	local story_texts<const> = { text_main, text_choice, text_prompt, text_transition }
	local choice_prompt_texts<const> = { text_choice, text_prompt }
	local transition_result_texts<const> = { text_transition, text_results }
	local combat_visuals<const> = { monster, maya_a, maya_b, all_out, all_out_portrait }
	local transition_visual<const> = {
		overlay = transition.overlay,
		panels = { transition.upper, transition.middle, transition.lower },
		accent = transition.accent,
	}
	local combat_results_visual<const> = combat.cover
	local combat_director_instance<const> = world:spawn(combat_module.director_definition_id, {
		id = combat_module.director_definition_id,
		background = background,
		text_main = text_main,
		text_choice = text_choice,
		text_prompt = text_prompt,
		text_transition = text_transition,
		text_results = text_results,
		texts = texts,
		story_texts = story_texts,
		choice_prompt_texts = choice_prompt_texts,
		transition_result_texts = transition_result_texts,
		monster = monster,
		maya_a = maya_a,
		maya_b = maya_b,
		all_out = all_out,
		all_out_portrait = all_out_portrait,
		combat_visuals = combat_visuals,
		transition_visual = transition_visual,
		combat_results_visual = combat_results_visual,
	})
	world:spawn(director_module.definition_id, {
		id = director_module.definition_id,
		combat_director = combat_director_instance,
		background = background,
		text_main = text_main,
		text_choice = text_choice,
		text_prompt = text_prompt,
		text_transition = text_transition,
		text_results = text_results,
		texts = texts,
		combat_visuals = combat_visuals,
		transition_visual = transition_visual,
		combat_results_visual = combat_results_visual,
	})
end

init()
atlas.load('font')
atlas.load(image.atlas_id(story.title.bg))
new_game()
-- Pietsona intentionally advances one gameplay tick across two display frames.
while true do
	vblank.wait()

	world:update()
	vblank.wait()
	world:render()
end
