local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local scene_library<const> = require('cartlib/world/scene_library')
local combat_scene<const> = require('scenes/combat')
local presentation<const> = require('presentation')

return {
	kind = 'integration',
	tests = {
		scene_lifecycle = function(t)
			t:wait_until('game fixture', function() return registry:get('p3.director') ~= nil end, 120)
			local combat<const> = registry:get('p3.combat.director')
			local monster<const> = combat.monster
			local old_owner<const> = monster.owner
			local director<const> = registry:get('p3.director')
			local session<const> = director.session
			session.stats.planning = 7
			session.node_id = 'combat_wekker'
			combat:start_combat('combat_wekker', true)
			combat.state_machines:transition_to('/combat_round')
			assert(combat.combat_monster_base_x == monster.attachment_ox - monster.source_width / 2,
				'combat ignores the authored visual anchor')
			combat:start_combat('combat_wekker', true)
			combat.state_machines:transition_to('/combat_round')
			assert(combat.combat_monster_base_x == monster.attachment_ox - monster.source_width / 2,
				'combat reentry accumulated an animated offset into its baseline')
			assert(monster.spatial == old_owner.spatial and monster.attachment_ox == 208 and monster.attachment_oy == 60,
				'combat mutated its retained spatial binding or immutable attachment')
			director.state_machines:transition_to('/boot')
			assert(director.session == session and session.stats.planning == 7
				and session.node_id == 'combat_wekker', 'controller reentry reset story progress')
			world:clear()
			assert(registry:get('p3.combat.monster') == nil, 'clear retains old scene members')

			-- Authored placement belongs to spatial and named component input, not
			-- options spread over a WorldObject. Text keeps a local layout rectangle.
			scene_library.register('p3.test.placement', { objects = {
				{ member_id = 'monster', definition_id = presentation.sprite,
					options = { id = 'p3.test.monster' },
					spatial = { local_transform = { 1, 0, 0, 1, 8, 8 } },
					initial = { base_sprite = { imgid = 'monster_snoozer', order = 205,
						attachment_affine = { 1, 0, 0, 1, 208, 60 } } } },
				{ member_id = 'main', definition_id = presentation.text,
					options = { id = 'p3.test.text' },
					spatial = { local_transform = { 1, 0, 0, 1, 8, 8 } },
					initial = { text = { attachment_affine = { 1, 0, 0, 1, 32, 96 },
						layout_rect = { left = 0, right = 256, top = 0, bottom = 64 } } } },
			} })
			local edited<const> = scene_library.instantiate('p3.test.placement')
			local edited_monster<const> = edited.members.monster.sprite_component
			assert(edited_monster.owner ~= old_owner and edited_monster.spatial == edited.members.monster.spatial,
				'scene admission reused the retired object or rebound its visual spatial identity')
			edited_monster:resolve_pose()
			assert(edited_monster.wox == 216 and edited_monster.woy == 68 and edited_monster.order == 205,
				'visual composition discarded authored object placement or visual order')
			local text<const> = edited.members.main
			text:set_text('Scene placement', { typed = false })
			text.text_component:resolve_pose()
			assert(text.text_component.wox == 40 and text.text_component.woy == 104
				and text.text_component.layout_rect.left == 0 and text.text_component.layout_rect.top == 0,
				'text layout absorbed or duplicated its object transform')
			edited:dispose()
			assert(registry:get('p3.test.monster') == nil and registry:get('p3.test.text') == nil,
				'scene disposal did not release identities')
			local fresh<const> = scene_library.instantiate(combat_scene.id)
			assert(fresh.members.monster.sprite_component.attachment_ox == 208
				and fresh.members.monster.sprite_component.attachment_oy == 60,
				'runtime placement mutated the authored definition')
			new_game()
			assert(registry:get('p3.director').session ~= session
				and registry:get('p3.director').session.stats.planning == 0
				and session.stats.planning == 7, 'New Game did not create independent story progress')
		end,
	},
}
