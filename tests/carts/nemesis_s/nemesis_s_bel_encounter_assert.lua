local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local notes_view<const> = world:active_definition_view(ids_noot_def)
local explosions_view<const> = world:active_definition_view(ids_large_explosion_def)

__bmsx_host_test = {
	frames = 0,
	phase = 'spawn',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 120, 'Nemesis S Bel encounter scenario timed out')

	local stage<const> = registry:get(ids_stage_instance)
	local player<const> = registry:get('nemesis_s.player.1')
	if stage == nil or player == nil or world.active_space_id ~= 'main' then
		return false
	end

	if test.phase == 'spawn' then
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		stage.scrolling = false
		stage.state_machines:transition_to('/running/stopped')
		local kerk<const> = world:spawn(ids_kerk_def, {
			stage = stage,
			pos = { x = 192, y = 16 },
		})
		local bell<const> = world:spawn(ids_bel_def, {
			stage = stage,
			pos = { x = 199, y = 96 },
		})
		local kerk_collider<const> = kerk:get_component(collider_2d_component)
		assert(kerk_collider.local_area.top == 109 and kerk_collider.local_area.bottom == 152,
			'the church lost its authored lower-body collision area')
		assert(bell.health == bel_health and not bell.vulnerable,
			'the one-player bell did not start armored with XNA health')

		bell.state_machines:transition_to('/ringing/left')
		assert(bell.vulnerable and bell.sprite_component.offset_x == -bel_side_offset_x,
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
		local bottom_note<const> = world:spawn(ids_noot_def, {
			stage = stage,
			velocity_x = 0,
			velocity_y = 0,
			pos = { x = 128, y = playfield_height + 1 },
		})
		test.bottom_note_id = bottom_note.id
		for index = #notes, 1, -1 do
			notes[index]:mark_for_disposal()
		end

		bell:receive_player_projectile({
			damage = bel_health - 1,
			x = bell.x,
			y = bell.y,
		})
		assert(bell.health == 1 and not stage.scrolling,
			'a non-fatal bell hit resumed the stage')
		world:spawn(ids_small_explosion_def, {
			stage = stage,
			drop_definition_id = ids_roodje_def,
			pos = { x = player.x, y = player.y },
		})
		test.player = player
		test.bell = bell
		test.phase = 'pickup'
		return false
	end

	if test.player.player_state.current_powerup_slot == 0 then
		return false
	end
	assert(test.player.player_state.current_powerup_slot == 1,
		'the red pickup did not advance the player powerup selection')
	assert(test.player.body_collider.enabled,
		'the pickup overlap incorrectly killed the player')
	assert(registry:get(test.bottom_note_id) == nil,
		'the bell note remained live below the playfield rectangle')
	test.bell:receive_player_projectile({
		damage = 1,
		x = test.bell.x,
		y = test.bell.y,
	})
	assert(stage.scrolling,
		'destroying the bell did not resume stage-owned scrolling')
	local scrolling_path<const> = stage.state_machines:bind_state_path('/running/scrolling')
	assert(stage.state_machines:matches_state(scrolling_path),
		'the resume command left the stage FSM in its stopped state')
	assert(#explosions_view.objects == 1,
		'the bell death did not create its large XNA explosion')
	return true
end
