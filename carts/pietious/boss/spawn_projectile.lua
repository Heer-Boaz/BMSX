local bt_result<const> = require('cartlib/behaviour_tree/result')
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local enemy_base<const> = require('enemies/enemy_base')
require('constants')

local spawn_projectile<const> = {}
spawn_projectile.__index = spawn_projectile

local tree_id<const> = 'enemy_world1_daemon_spawn'
local bt_running<const> = bt_result.running
local projectile_images<const> = {
	'world1_daemon_spawn_cadeau',
	'world1_daemon_spawn_letter',
	'world1_daemon_spawn_kruidnoten',
}
local projectile_hit_area<const> = {
	left = 2,
	top = 2,
	right = 14,
	bottom = 14,
}

local new_collider<const> = function(opts)
	local collider<const> = collider_2d_component.new(opts)
	collider.local_area = projectile_hit_area
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	return collider
end

function spawn_projectile:ctor()
	self:set_imgid(projectile_images[math.random(1, #projectile_images)])
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function spawn_projectile.update(self)
	velocity.move_with_velocity(self)
	return bt_running
end

function spawn_projectile.choose_drop_type(_self)
	return nil
end

function spawn_projectile.register()
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'task',
			tick = spawn_projectile.update,
		},
	})
	prefab.define({
		def_id = 'enemy.daemon_spawn',
		class = spawn_projectile,
		base = enemy_base,
		components = { new_collider, bt_component.factory(tree_id) },
		defaults = {
			damage = 1,
			max_health = 1,
			health = 1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 10,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'daemon_spawn',
		},
	})
end

return spawn_projectile
