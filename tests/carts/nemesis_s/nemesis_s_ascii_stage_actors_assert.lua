local fixture<const> = require('tests/carts/nemesis_s/fixture')
local test<const> = {}
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')

local registry<const> = require('cartlib/registry')

local world<const> = require('cartlib/world/world')

require('constants')

-- Stadsburg retains native actor symbols while replacing the original town's
-- placement. These are the authored counts and first admission anchors.
local expected_actor_counts<const> = {
	[ids_schoorsteen_foe_def] = 4,
	[ids_rook_generator_def] = 2,
	[ids_zak_foe_def] = 6,
	[ids_sneeuwpop_def] = 0,
	[ids_bel_def] = 0,
	[ids_kerk_def] = 0,
	[ids_havengeschut_def] = 8,
	[ids_kadekanon_def] = 3,
	['nemesis_s.enemy.molen'] = 1,
}

local expected_first_spawns<const> = {
	[ids_schoorsteen_foe_def] = { column = 394, x = 244, y = 104 },
	[ids_rook_generator_def] = { column = 424, x = 236, y = 96 },
	[ids_zak_foe_def] = { column = 183, x = 248, y = 104 },
	[ids_havengeschut_def] = { column = 172, x = 248, y = 104 },
	[ids_kadekanon_def] = { column = 488, x = 244, y = 24 },
	['nemesis_s.enemy.molen'] = { column = 814, x = 248, y = 24 },
}

local assert_authored_actor_tape<const> = function(stage)
	local counts<const> = {}
	for definition_id in pairs(expected_actor_counts) do counts[definition_id] = 0 end
	local first_spawns<const> = {}
	local spawns<const> = stage.actor_spawns
	local previous_column = -1
	for index = 1, stage.actor_spawn_count do
		local spawn<const> = spawns[index]
		assert(spawn.column >= previous_column,
		'A later actor admission blocks an earlier roof weapon')
		previous_column = spawn.column
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
		'Authored stage placement count changed for ' .. definition_id)
		if expected_count ~= 0 then
			local spawn<const> = first_spawns[definition_id]
			local expected<const> = expected_first_spawns[definition_id]
			assert(spawn.column == expected.column,
			'Authored stage placement column changed for ' .. definition_id)
			assert(spawn.options.stage == stage,
			'Authored stage actor lost its stage owner')
			assert(spawn.options.position.x == expected.x and spawn.options.position.y == expected.y,
			'Authored stage placement position changed for ' .. definition_id)
		end
	end
end

return {
	kind = 'integration',
	tests = {
		ascii_stage_actors = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t)

			do
				assert_authored_actor_tape(stage)
				stage.actor_spawn_index = stage.actor_spawn_count + 1
				local snowman<const> = registry:get('nemesis_s.director').gameplay:spawn(ids_sneeuwpop_def, {
					stage = stage,
					position = { x = 100, y = 32 },
				})
				local collider<const> = snowman:get_component(collider_2d_component)
				assert(collider.shape_ref ~= nil,
				'the snowman did not bind its authored tile collision shape')
				stage:advance_tape()
				assert(snowman.ox == 92,
				'the retained stage follower did not consume one ASCII tile step')
				stage.scrolling = false
				for row_index = 1, stage.tile_rows do
					local row<const> = stage.solid_tape[row_index]
					for column = 1, #row do
						row[column] = 0
					end
				end
				snowman:set_global_position(44, 32)
				player:set_global_position(41, 25)
				player:spawn_bullet(1, player.ox, player.oy, player.primary_projectiles[1])
				test.snowman = snowman
				test.initial_health = snowman.health
				test.gameplay_time_ms = world.gameplay_time_ms
				t:wait_ticks(1)
			end
			t:wait_until('ascii_stage_actors observation 1', function() return not (world.gameplay_time_ms == test.gameplay_time_ms) end, 120)
			t:wait_until('ascii_stage_actors observation 2', function() return not (test.snowman.health == test.initial_health
				and player.primary_projectiles[1].collider.enabled) end, 120)
			assert(test.snowman.health == test.initial_health - 1,
			'the fixed projectile lane did not hit the authored tile collision shape')
			assert(not player.primary_projectiles[1].collider.enabled,
			'the bullet slot remained active after a large-enemy collision')
		end,
	},
}
