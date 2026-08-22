local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
require('constants')

local target_definition_id<const> = 'test.projectile_reactivation_target'
local target<const> = {}
target.__index = target

function target:receive_player_projectile(_projectile)
	self.hit_count = self.hit_count + 1
	return true
end

prefab.define({
	def_id = target_definition_id,
	class = target,
	base = enemy,
	components = {
		collider_2d_component.factory({
			layer = collision_enemy_layer,
			mask = collision_enemy_mask,
			local_area = { left = 0, top = 0, right = 8, bottom = 8 },
		}),
	},
	defaults = {
		hit_count = 0,
		max_health = 1,
		small_fry = false,
	},
})

__bmsx_host_test = {
	frames = 0,
	phase = 'boot',
}

function __bmsx_host_test.ready()
	return registry:get(ids_director_instance) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = registry:get(ids_director_instance)
	director.state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	if world.active_space_id == 'game_start' then
		local director<const> = registry:get(ids_director_instance)
		if director.status_bar ~= nil then
			director.state_machines:transition_to('/gameplay')
		end
		return false
	end

	local test<const> = __bmsx_host_test
	test.frames = test.frames + 1
	assert(test.frames < 80,
		'Nemesis S projectile-reactivation scenario timed out phase=' .. test.phase)

	local stage<const> = registry:get(ids_stage_instance)
	local player<const> = registry:get('nemesis_s.player.1')
	if stage == nil or player == nil or world.active_space_id ~= 'main' then
		return false
	end

	if test.phase == 'boot' then
		stage.actor_spawn_index = stage.actor_spawn_count + 1
		stage.scrolling = false
		for row_index = 1, stage.tile_rows do
			local row<const> = stage.solid_tape[row_index]
			for column = 1, 40 do
				row[column] = 0
			end
		end

		player.x = 32
		player.y = 64
		test.target = world:spawn(target_definition_id, {
			pos = { x = 48, y = 70 },
		})
		test.projectile = player.primary_projectiles[1]
		player:spawn_laser(player, 1)
		test.phase = 'first_contact'
		return false
	end

	if test.phase == 'first_contact' then
		if test.target.hit_count == 0 then
			return false
		end
		assert(test.target.hit_count == 1
			and test.projectile.type == 0
			and not test.projectile.collider.enabled,
			'the first laser contact did not consume its retained projectile slot')
		player:spawn_laser(player, 1)
		assert(player.primary_projectiles[1] == test.projectile
			and test.projectile.collider.enabled,
			'the second laser did not reactivate the same retained projectile slot')
		test.phase = 'reactivated_contact'
		return false
	end

	if test.target.hit_count < 2 then
		return false
	end
	assert(test.target.hit_count == 2 and test.projectile.type == 0,
		'the reactivated laser slot did not begin a new enemy contact lifecycle')
	return true
end
