local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local chimney_wreck<const> = {}

local wreck_width<const> = 24

function chimney_wreck.spawn(weapon, hanging)
	local x<const>, y<const> = weapon:get_global_position()
	weapon.scene:spawn(ids_chimney_wreck_def, {
		position = { x = x + 4, y = y + (hanging and 0 or 8) },
		stage = weapon.stage,
		flip_v = hanging,
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
			imgid = assets_chimney_wreck,
			order = large_explosion_draw_z - 1,
			stage_scroll_width = wreck_width,
		},
	})
end

return chimney_wreck
