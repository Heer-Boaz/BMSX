local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
	self:set_imgid('vlok')
	enemy_base.setup_projectile_boundary(self)
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

function vlokfoe.register()
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, velocity_component.new },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe
