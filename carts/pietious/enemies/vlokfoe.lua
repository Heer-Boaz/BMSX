local prefab<const> = require('cartlib/world/prefab')
local velocity_component<const> = require('cartlib/physics/velocity_component')
local enemy_base<const> = require('enemies/enemy_base')
local screen_boundary_component<const> = require('cartlib/physics/screen_boundary_component')
require('constants')

local new_boundary<const> = screen_boundary_component.factory({
	left = 0, top = room_hud_height, right = room_width, bottom = room_height,
	local_left = 0, local_top = 0, local_right = 9, local_bottom = 9,
})

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

-- disable-next-line single_line_method_pattern -- prefab lifecycle construction creates and attaches this object's velocity; this is not a forwarding API.
function vlokfoe:ctor()
	self:add_component(velocity_component.new(self, self))
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
		components = { enemy_base.new_collider, new_boundary },
		defaults = {
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			order = 250,
			imgid = 'vlok',
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			direction = 'right',
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe
