local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
require('constants')

local enemy_bullet<const> = {}
enemy_bullet.__index = enemy_bullet

local new_enemy_bullet_collider<const> = collider_2d_component.factory_for_sprite({
	id_local = 0,
	layer = collision_enemy_projectile_layer,
	mask = collision_enemy_projectile_mask,
})

function enemy_bullet:update_flying()
	self.x = self.x + self.speed_x
	self.y = self.y + self.speed_y
	if self.x < enemy_bullet_size
	or self.x > playfield_width
	or self.y < enemy_bullet_size
	or self.y > playfield_height
	or self.stage:is_solid_pixel(self.x + 2, self.y + 2) then
		self:mark_for_disposal()
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_enemy_bullet_fsm, {
		initial = 'flying',
		states = {
			flying = {
				update = enemy_bullet.update_flying,
				on = {
					['overlap.begin'] = {
						emitter = false,
						go = sprite_object.mark_for_disposal,
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_enemy_bullet_def,
		class = enemy_bullet,
		base = sprite_object,
		components = {
			new_enemy_bullet_collider,
			fsm_component.factory({ ids_enemy_bullet_fsm }),
		},
		defaults = {
			imgid = assets_enemy_bullet,
			speed_x = 0,
			speed_y = 0,
			z = enemy_bullet_draw_z,
		},
	})
end

function enemy_bullet.register()
	define_fsm()
	register_definition()
end

return enemy_bullet
