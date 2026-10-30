local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local staffspawn<const> = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	self.sprite_component.flip_h = self:get_component(velocity_component).speed_x_num < 0
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return nil
end

function staffspawn.register()
	prefab.define({
		def_id = 'enemy.staffspawn',
		class = staffspawn,
		base = enemy_base,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 250, imgid = 'staffspawn' }, velocity = { speed_x_num = 0, speed_y_num = 0, speed_den = 1 } },
		components = { enemy_base.new_collider, velocity_component.new, enemy_base.projectile_boundary },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			direction = 'right',
			enemy_kind = 'staffspawn',
		},
	})
end

return staffspawn
