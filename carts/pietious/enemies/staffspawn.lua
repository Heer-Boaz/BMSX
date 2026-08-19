local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local staffspawn<const> = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	self:set_imgid('staffspawn')
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return nil
end

function staffspawn.register()
	prefab.define({
		def_id = 'enemy.staffspawn',
		class = staffspawn,
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
			enemy_kind = 'staffspawn',
		},
	})
end

return staffspawn
