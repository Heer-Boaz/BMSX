local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
require('constants')

local new_boundary<const> = screen_boundary_component.factory({
	left = 0, top = room_hud_height, right = room_width, bottom = room_height,
	local_left = 0, local_top = 0, local_right = 20, local_bottom = 22,
})

local paperfoe<const> = {}
paperfoe.__index = paperfoe

function paperfoe:ctor()
	local velocity<const> = self:add_component(velocity_component.new(self, self))
	self.sprite_component.flip_h = velocity.speed_x_num < 0
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return nil
end

function paperfoe.register()
	prefab.define({
		def_id = 'enemy.paperfoe',
		class = paperfoe,
		base = enemy_base,
		spatial = { family = '2d', authority = 'root_origin' },
		components = { enemy_base.new_collider, new_boundary },
		defaults = {
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			order = 250,
			imgid = 'boekfoe_paper',
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			direction = 'right',
			enemy_kind = 'paperfoe',
		},
	})
end

return paperfoe
