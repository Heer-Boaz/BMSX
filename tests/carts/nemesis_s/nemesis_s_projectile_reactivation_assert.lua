local fixture<const> = require('tests/carts/nemesis_s/fixture')
local test<const> = {}
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

return {
	kind = 'integration',
	tests = {
		projectile_reactivation = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t)

			do
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
				test.target = registry:get('nemesis_s.director').gameplay:spawn(target_definition_id, {
					pos = { x = 48, y = 70 },
				})
				test.projectile = player.primary_projectiles[1]
				player:spawn_laser(player, 1)
				t:wait_ticks(1)
			end
			do
				t:wait_until('projectile_reactivation observation 1', function() return not (test.target.hit_count == 0) end, 120)
				assert(test.target.hit_count == 1
				and test.projectile.type == 0
				and not test.projectile.collider.enabled,
				'the first laser contact did not consume its retained projectile slot')
				player:spawn_laser(player, 1)
				assert(player.primary_projectiles[1] == test.projectile
				and test.projectile.collider.enabled,
				'the second laser did not reactivate the same retained projectile slot')
				t:wait_ticks(1)
			end
			t:wait_until('projectile_reactivation observation 2', function() return not (test.target.hit_count < 2) end, 120)
			assert(test.target.hit_count == 2 and test.projectile.type == 0,
			'the reactivated laser slot did not begin a new enemy contact lifecycle')
		end,
	},
}
