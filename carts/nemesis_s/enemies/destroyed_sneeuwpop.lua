local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local destroyed_sneeuwpop<const> = {}
destroyed_sneeuwpop.__index = destroyed_sneeuwpop

function destroyed_sneeuwpop:ctor()
	self:get_component(collider_2d_component):set_shape_asset(
		assets.collision_shape_sneeuwpop_destroyed_body_addr
	)
	self.vulnerable = false
end

local define_fsm<const> = function()
	fsm_library.register(ids_destroyed_sneeuwpop_fsm, {
		initial = 'remains',
		states = {
			remains = {
				update = enemy.update_stage_follower,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_destroyed_sneeuwpop_def,
		class = destroyed_sneeuwpop,
		base = enemy,
		components = {
			enemy.new_collider,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_destroyed_sneeuwpop_fsm }),
		},
		defaults = {
			imgid = assets_sneeuwpop_destroyed,
			max_health = 0,
			small_fry = false,
			stage_scroll_width = sneeuwpop_width,
			z = sneeuwpop_draw_z,
		},
	})
end

function destroyed_sneeuwpop.register()
	define_fsm()
	register_definition()
end

return destroyed_sneeuwpop
