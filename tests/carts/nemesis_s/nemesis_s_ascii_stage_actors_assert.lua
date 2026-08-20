local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
require('constants')

local expected_actor_counts<const> = {
	[ids_schoorsteen_foe_def] = 16,
	[ids_rook_generator_def] = 8,
	[ids_zak_foe_def] = 31,
	[ids_sneeuwpop_def] = 4,
}

local expected_first_spawns<const> = {
	[ids_schoorsteen_foe_def] = { column = 241, x = 245, y = 88 },
	[ids_rook_generator_def] = { column = 202, x = 240, y = 96 },
	[ids_zak_foe_def] = { column = 147, x = 248, y = 152 },
	[ids_sneeuwpop_def] = { column = 299, x = 248, y = 112 },
}

__bmsx_host_test = {
	frames = 0,
	phase = 'stage',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
end

local assert_ascii_actor_tape<const> = function(stage)
	local counts<const> = {
		[ids_schoorsteen_foe_def] = 0,
		[ids_rook_generator_def] = 0,
		[ids_zak_foe_def] = 0,
		[ids_sneeuwpop_def] = 0,
	}
	local first_spawns<const> = {}
	local spawns<const> = stage.actor_spawns
	for index = 1, stage.actor_spawn_count do
		local spawn<const> = spawns[index]
		local definition_id<const> = spawn.definition_id
		if counts[definition_id] ~= nil then
			counts[definition_id] = counts[definition_id] + 1
			if first_spawns[definition_id] == nil then
				first_spawns[definition_id] = spawn
			end
		end
	end

	for definition_id, expected_count in pairs(expected_actor_counts) do
		assert(counts[definition_id] == expected_count,
			'ASCII stage marker count changed for ' .. definition_id)
		local spawn<const> = first_spawns[definition_id]
		local expected<const> = expected_first_spawns[definition_id]
		assert(spawn.column == expected.column,
			'ASCII stage marker column changed for ' .. definition_id)
		assert(spawn.options.stage == stage,
			'ASCII stage actor lost its stage owner')
		assert(spawn.options.pos.x == expected.x and spawn.options.pos.y == expected.y,
			'ASCII stage marker position changed for ' .. definition_id)
	end
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 30, 'Nemesis S ASCII stage actor scenario timed out')

	local stage<const> = registry:get(ids_stage_instance)
	local player<const> = registry:get('nemesis_s.player.1')
	if world.active_space_id ~= 'main' or stage == nil or player == nil then
		return false
	end

	if test.phase == 'stage' then
		assert_ascii_actor_tape(stage)

		stage.actor_spawn_index = stage.actor_spawn_count + 1
		local snowman<const> = world:spawn(ids_sneeuwpop_def, {
			stage = stage,
			pos = { x = 100, y = 32 },
		})
		local collider<const> = snowman:get_component(collider_2d_component)
		assert(collider.shape_ref ~= nil,
			'the snowman did not bind its authored tile collision shape')
		stage:advance_tape()
		assert(snowman.x == 92,
			'the retained stage follower did not consume one ASCII tile step')

		stage.scrolling = false
		for row_index = 1, stage.tile_rows do
			local row<const> = stage.solid_tape[row_index]
			for column = 1, 40 do
				row[column] = 0
			end
		end
		snowman.x = 44
		snowman.y = 32
		player.x = 41
		player.y = 25
		player:spawn_bullet(1)
		test.snowman = snowman
		test.initial_health = snowman.health
		test.phase = 'collision'
		return false
	end

	assert(test.snowman.health == test.initial_health - 1,
		'the fixed projectile lane did not hit the authored tile collision shape')
	assert(not player.primary_projectiles[1].collider.enabled,
		'the bullet slot remained active after a large-enemy collision')
	return true
end
