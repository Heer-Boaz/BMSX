local registry<const> = require('cartlib/registry')

local world<const> = require('cartlib/world/world')

local scene_library<const> = require('cartlib/world/scene_library')

local combat_scene<const> = require('scenes/combat')

local dialogue_scene<const> = require('scenes/dialogue')

return {
	kind = 'integration',
	tests = {
		scene_lifecycle = function(t)
			t:wait_until('game fixture', function() return registry:get('p3.director') ~= nil end, 120)
			local combat<const> = registry:get('p3.combat.director')
			local monster<const> = combat.monster
			local director<const> = registry:get('p3.director')
			local session<const> = director.session
			session.stats.planning = 7
			session.node_id = 'combat_wekker'
			combat:start_combat('combat_wekker', true)
			combat.state_machines:transition_to('/combat_round')
			assert(monster.x == monster.home_x - monster.sx / 2, 'combat ignores its authored anchor')
			combat:start_combat('combat_wekker', true)
			combat.state_machines:transition_to('/combat_round')
			assert(monster.x == monster.home_x - monster.sx / 2, 'combat reentry accumulates offsets')
			director.state_machines:transition_to('/boot')
			assert(director.session == session and session.stats.planning == 7
			and session.node_id == 'combat_wekker', 'controller reentry reset story progress')
			world:clear()
			assert(registry:get('p3.combat.monster') == nil, 'clear retains old scene members')
			local edited<const> = scene_library.instantiate(combat_scene.id, {
				monster = { pos = { x = 216, y = 68, z = 205 } },
			})
			assert(edited.members.monster ~= monster, 'scene admission reused a disposed object')
			assert(edited.members.monster.home_x == 216 and edited.members.monster.home_y == 68 and edited.members.monster.home_z == 205,
			'combat did not retain the authored instance placement')
			local dialogue<const> = scene_library.instantiate(dialogue_scene.id, {
				main = { pos = { x = 40, y = 104, z = 1000 } },
			})
			dialogue.members.main:set_text('Scene placement', { typed = false })
			assert(dialogue.members.main.dimensions.left == 40 and dialogue.members.main.dimensions.top == 104,
			'text layout discarded the scene transform')
			assert(dialogue.members.main.text_component.offset_y == 0, 'text placement applied twice')
			edited:dispose()
			dialogue:dispose()
			assert(registry:get('p3.combat.monster') == nil and registry:get('p3.text.main') == nil,
			'scene disposal did not release identities')
			local fresh<const> = scene_library.instantiate(combat_scene.id)
			assert(fresh.members.monster.home_x == 208 and fresh.members.monster.home_y == 60,
			'runtime bindings mutated the authored definition')
			new_game()
			assert(registry:get('p3.director').session ~= session
			and registry:get('p3.director').session.stats.planning == 0
			and session.stats.planning == 7, 'New Game did not create independent story progress')
		end,
	},
}
