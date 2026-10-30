local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local kerk<const> = {}
kerk.__index = kerk

local hit_area<const> = {
	left = 0,
	top = 109,
	right = 40,
	bottom = 152,
}

function kerk:ctor()
	self.vulnerable = false
end

local define_fsm<const> = function()
	fsm_library.register(ids_kerk_fsm, {
		initial = 'active',
		update = enemy.update_stage_follower,
		states = {
			active = {},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_kerk_def,
		class = kerk,
		base = enemy,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { imgid = assets_kerk, order = kerk_draw_z } },
		components = {
			collider_2d_component.factory({
				geometry_pool = collision_storage.area, local_area = hit_area,
				layer = collision_enemy_layer, mask = collision_enemy_mask,
			}),
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_kerk_fsm }),
		},
		defaults = {
			max_health = 0,
			small_fry = false,
			stage_scroll_width = kerk_width,
		},
	})
end

function kerk.register()
	define_fsm()
	register_definition()
end

return kerk
