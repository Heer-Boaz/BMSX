local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local chimney_wreck<const> = {}

local roof_width<const> = 16
local roof_height<const> = 8
local quay_width<const> = 24
local quay_height<const> = 16

function chimney_wreck.spawn(weapon, hanging)
	local x<const>, y<const> = weapon:get_global_position()
	local width<const> = hanging and quay_width or roof_width
	local height<const> = hanging and quay_height or roof_height
	weapon.scene:spawn(ids_chimney_wreck_def, {
		position = {
			x = x + (weapon.body_width - width) // 2,
			y = y + (hanging and 0 or weapon.body_height - height),
		},
		stage = weapon.stage,
		flip_v = hanging,
		imgid = hanging and assets_chimney_wreck or assets_roof_chimney_wreck,
		stage_scroll_width = width,
	})
end

function chimney_wreck.register()
	fsm_library.register(ids_chimney_wreck_fsm, {
		initial = 'remains',
		states = { remains = { update = enemy.update_stage_follower } },
	})
	prefab.define({
		def_id = ids_chimney_wreck_def,
		class = sprite_object,
		components = {
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_chimney_wreck_fsm }),
		},
		defaults = {
			order = large_explosion_draw_z - 1,
		},
	})
end

return chimney_wreck
