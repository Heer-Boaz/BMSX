local fixture<const> = require('tests/carts/nemesis_s/fixture')
local test<const> = {}
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')

local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')

local registry<const> = require('cartlib/registry')

local world<const> = require('cartlib/world/world')

require('constants')

local notes_view<const> = world:active_definition_view(ids_noot_def)

local explosions_view<const> = world:active_definition_view(ids_large_explosion_def)

local hit_explosions_view<const> = world:active_definition_view(ids_small_explosion_def)

return {
	kind = 'integration',
	tests = {
		bel_encounter = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t)

			do
				stage.actor_spawn_index = stage.actor_spawn_count + 1
				stage.scrolling = false
				stage.state_machines:transition_to('/running/stopped')
				local kerk<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_kerk_def, {
					stage = stage,
				}, { local_transform = { 1, 0, 0, 1, 192, 16 } })
				local bell<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_bel_def, {
					stage = stage,
				}, { local_transform = { 1, 0, 0, 1, 199, 96 } })
				local kerk_collider<const> = kerk:get_component(collider_2d_component)
				assert(kerk_collider.local_top == 109 and kerk_collider.local_bottom == 152,
				'the church lost its authored lower-body collision area')
				assert(bell.health == bel_health and not bell.vulnerable,
				'the one-player bell did not start armored with XNA health')
				bell.state_machines:transition_to('/ringing/left')
				assert(bell.vulnerable and bell.sprite_component.attachment_ox == -bel_side_offset_x,
				'the left ringing phase did not move visual and collision ownership together')
				local notes<const> = notes_view.objects
				assert(#notes >= bel_note_spawn_count_min and #notes <= bel_note_spawn_count_max,
				'the first bell extremum did not emit the XNA note burst')
				for index = 1, #notes do
					local note<const> = notes[index]
					local motion<const> = note:get_component(fixed_point_velocity_component)
					assert(motion.velocity_x <= 0,
					'a bell note lost its retained leftward XNA launch vector')
				end
				local bottom_note<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_noot_def, {
					stage = stage,
				}, { local_transform = { 1, 0, 0, 1, 128, playfield_height + 1 } })
				test.bottom_note_id = bottom_note.id
				for index = #notes, 1, -1 do
					notes[index]:mark_for_disposal()
				end
				local hit_point<const> = { x = bell.spatial.ox + 12, y = bell.spatial.oy + 12 }
				bell:receive_player_projectile({
					damage = bel_health - 1,
				}, bell.collider.id_local, hit_point)
				assert(bell.health == 1 and not stage.scrolling,
				'a non-fatal bell hit resumed the stage')
				local hit_explosions<const> = hit_explosions_view.objects
				assert(#hit_explosions == 1
				and hit_explosions[1].spatial.ox == hit_point.x
				and hit_explosions[1].spatial.oy == hit_point.y,
				'the bell hit feedback did not use the retained collision contact')
				registry:get('nemesis_s.director').gameplay:spawn(ids_small_explosion_def, {
					stage = stage,
					drop_definition_id = ids_roodje_def,
				}, { local_transform = { 1, 0, 0, 1, player.spatial.ox, player.spatial.oy } })
				test.player = player
				test.bell = bell
				test.bell_id = bell.id
				t:wait_ticks(1)
			end
			do
				t:wait_until('bel_encounter observation 1', function() return not (test.player.player_state.current_powerup_slot == 0) end, 120)
				assert(test.player.player_state.current_powerup_slot == 1,
				'the red pickup did not advance the player powerup selection')
				assert(test.player.body_collider.enabled,
				'the pickup overlap incorrectly killed the player')
				assert(registry:get(test.bottom_note_id) == nil,
				'the bell note remained live below the playfield rectangle')
				test.bell.state_machines:transition_to('/ringing/left')
				test.player.spatial:set_world_origin(40, 94)
				test.player:spawn_laser(1, test.player.spatial.ox, test.player.spatial.oy, test.player.spatial, 1)
				t:wait_ticks(1)
			end
			t:wait_until('bel_encounter observation 2', function() return not (registry:get(test.bell_id) ~= nil) end, 120)
			assert(test.player.primary_projectiles[1].type == 0,
			'the bell collision did not consume the retained laser record')
			assert(stage.scrolling,
			'a laser collision with the bell did not resume stage-owned scrolling')
			local scrolling_path<const> = stage.state_machines:bind_state_path('/running/scrolling')
			assert(stage.state_machines:matches_state(scrolling_path),
			'the resume command left the stage FSM in its stopped state')
			assert(#explosions_view.objects == 1,
			'the bell death did not create its large XNA explosion')
		end,
	},
}
