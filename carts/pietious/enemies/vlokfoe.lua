local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

function vlokfoe.register()
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = enemy_base,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 250, imgid = 'vlok' }, boundary = { local_right = 9, local_bottom = 9 }, velocity = { speed_x_num = 0, speed_y_num = 0, speed_den = 1 } },
		components = { enemy_base.new_collider, velocity_component.new, enemy_base.projectile_boundary },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			direction = 'right',
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe
