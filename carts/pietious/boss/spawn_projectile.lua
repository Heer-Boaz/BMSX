local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local collision_storage<const> = require('collision_storage')
local prefab<const> = require('cartlib/world/prefab')
local enemy_base<const> = require('enemies/enemy_base')
require('constants')

local spawn_projectile<const> = {}
spawn_projectile.__index = spawn_projectile

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

local new_collider<const> = collider_2d_component.factory({
	geometry_pool = collision_storage.area,
	local_area = projectile_hit_area,
	layer = collision_enemy_layer,
	mask = collision_enemy_mask,
})

function spawn_projectile:ctor()
	self.sprite_component:set_imgid(projectile_images[math.random(1, #projectile_images)])
	self.sprite_component.flip_h = self:get_component(velocity_component).speed_x_num < 0
end

function spawn_projectile.choose_drop_type(_self)
	return nil
end

function spawn_projectile.register()
	prefab.define({
		def_id = 'enemy.daemon_spawn',
		class = spawn_projectile,
		base = enemy_base,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 250 }, velocity = { speed_den = 10 } },
		components = { new_collider, velocity_component.new, enemy_base.projectile_boundary },
		defaults = {
			damage = 1,
			max_health = 1,
			health = 1,
			dangerous = true,
			direction = 'right',
			enemy_kind = 'daemon_spawn',
		},
	})
end

return spawn_projectile
