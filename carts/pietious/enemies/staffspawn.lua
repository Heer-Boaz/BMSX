local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local staffspawn<const> = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	local velocity<const> = self:add_component(velocity_component.new(self, self))
	self.sprite_component.flip_h = velocity.speed_x_num < 0
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
		components = { enemy_base.new_collider, enemy_base.projectile_boundary },
		defaults = {
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			order = 250,
			imgid = 'staffspawn',
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			direction = 'right',
			enemy_kind = 'staffspawn',
		},
	})
end

return staffspawn
