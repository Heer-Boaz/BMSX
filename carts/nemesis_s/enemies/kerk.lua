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
	self:get_component(collider_2d_component).local_area = hit_area
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
		components = {
			enemy.new_collider,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_kerk_fsm }),
		},
		defaults = {
			imgid = assets_kerk,
			max_health = 0,
			small_fry = false,
			stage_scroll_width = kerk_width,
			z = kerk_draw_z,
		},
	})
end

function kerk.register()
	define_fsm()
	register_definition()
end

return kerk
