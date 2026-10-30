local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local nootfoe<const> = {}
nootfoe.__index = nootfoe

local noot_colors<const> = {
	0xffffffff,
	0xffff0000,
	0xff00ffff,
	0xff00ff00,
	0xffffbfcc,
	0xffffff00,
	0xffed82ed,
}

function nootfoe:ctor()
	self.sprite_component.color = noot_colors[math.random(1, #noot_colors)]
	self.castle.events:emit('muzieknootspawn')
end

function nootfoe.choose_drop_type(_self)
	return nil
end

function nootfoe.register()
	prefab.define({
		def_id = 'enemy.nootfoe',
		class = nootfoe,
		base = enemy_base,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 250, imgid = 'muzieknootfoe' }, boundary = { local_right = 8, local_bottom = 8 }, velocity = { speed_x_num = 0, speed_y_num = 0, speed_den = 1 } },
		components = { enemy_base.new_collider, velocity_component.new, enemy_base.projectile_boundary },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			direction = 'right',
			enemy_kind = 'nootfoe',
		},
	})
end

return nootfoe
