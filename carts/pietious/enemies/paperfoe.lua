local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local paperfoe<const> = {}
paperfoe.__index = paperfoe

function paperfoe:ctor()
	self:set_imgid('boekfoe_paper')
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return nil
end

function paperfoe.register()
	prefab.define({
		def_id = 'enemy.paperfoe',
		class = paperfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, velocity_component.new },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'paperfoe',
		},
	})
end

return paperfoe
