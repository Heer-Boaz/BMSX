local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
require('constants')

local selected_apu_source<const>: *word = 0x0800018c
local structure_hit_source<const> = rom_dir.audio('nemesis2_structure_hit').addr
local small_destroyed_source<const> = rom_dir.audio('nemesis2_foe_death').addr
local zak_destroyed_source<const> = rom_dir.audio('nemesis2_torendood').addr
local structure_destroyed_source<const> = rom_dir.audio('nemesis2_structure_explosion').addr
local projectile<const> = {
	damage = 1,
	pierces_small_fry = false,
}

__bmsx_host_test = {
	frames = 0,
	phase = 'damage',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
	director.state_machines:transition_to('/gameplay')
	for index = 1, #director.players do
		director.players[index].body_collider:set_enabled(false)
	end
	test.small_explosions = world:active_definition_view(ids_small_explosion_def)
	test.large_explosions = world:active_definition_view(ids_large_explosion_def)
	test.roodjes = world:active_definition_view(ids_roodje_def)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 80, 'Nemesis S enemy-feedback scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	if world.active_space_id ~= 'main' or stage == nil then
		return false
	end

	if test.phase == 'damage' then
		stage.scrolling = false
		stage.actor_spawn_index = stage.actor_spawn_count + 1

		local snowman<const> = world:spawn(ids_sneeuwpop_def, {
			stage = stage,
			pos = { x = 184, y = 112 },
		})
		local health<const> = snowman.health
		snowman:receive_player_projectile(projectile)
		assert(snowman.health == health - 1,
			'GroundFoe did not retain damage before emitting hit feedback')
		assert(*selected_apu_source == structure_hit_source,
			'GroundFoe nonfatal damage did not select the XNA structure-hit cue')

		local mijter<const> = world:spawn(ids_mijter_foe_def, {
			stage = stage,
			mijter_type = mijter_foe_type_red,
			pos = { x = 152, y = 80 },
		})
		mijter:receive_player_projectile(projectile)
		assert(*selected_apu_source == small_destroyed_source,
			'default Foe destruction did not select the XNA small-enemy cue')
		assert(test.small_explosions.objects[1].drop_definition_id == ids_roodje_def,
			'red MijterFoe did not retain its authored power-up drop')

		local formation<const> = { remaining = sint_pop_group_size }
		for index = 1, sint_pop_group_size do
			local sint_pop<const> = world:spawn(ids_sint_pop_def, {
				stage = stage,
				formation = formation,
				group_type = sint_pop_group_up,
				pos = { x = 96 + index * sint_pop_width, y = 48 },
			})
			sint_pop:receive_player_projectile(projectile)
			local explosion<const> = test.small_explosions.objects[index + 1]
			if index < sint_pop_group_size then
				assert(explosion.drop_definition_id == nil,
					'SintPop produced a drop before its formation was defeated')
			else
				assert(explosion.drop_definition_id == ids_roodje_def,
					'final SintPop did not retain the XNA formation drop')
			end
		end
		assert(formation.remaining == 0,
			'SintPop destruction did not consume its shared formation state')

		local zak<const> = world:spawn(ids_zak_foe_def, {
			stage = stage,
			pos = { x = 72, y = 112 },
		})
		projectile.damage = zak.health
		zak:receive_player_projectile(projectile)
		projectile.damage = 1
		assert(*selected_apu_source == zak_destroyed_source,
			'ZakFoe destruction did not select its authored XNA cue')
		assert(test.small_explosions.objects[sint_pop_group_size + 2].drop_definition_id
			== ids_roodje_def,
			'ZakFoe did not retain its authored power-up drop')

		snowman.health = 1
		snowman:receive_player_projectile(projectile)
		assert(*selected_apu_source == structure_destroyed_source,
			'GroundFoe fatal damage did not select the XNA structure-explosion cue')
		assert(#test.large_explosions.objects == 1,
			'GroundFoe fatal damage did not spawn one retained large explosion')
		assert(#test.small_explosions.objects == sint_pop_group_size + 2,
			'Foe destruction did not spawn the expected retained small explosions')
		test.phase = 'drops'
		return false
	end

	if #test.small_explosions.objects > 0 or #test.large_explosions.objects > 0 then
		return false
	end
	assert(#test.roodjes.objects == 3,
		'authored Foe and formation drops did not appear after their explosions')
	return true
end
