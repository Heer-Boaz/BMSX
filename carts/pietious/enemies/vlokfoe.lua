local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
	self:set_imgid('vlok')
	enemy_base.setup_projectile_boundary(self)
end

function vlokfoe.bt_tick(self, _execution)
	velocity.move_with_velocity(self)
	return bt_running
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

function vlokfoe.register()
	local tree_id<const> = 'enemy_vlokfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'task',
			tick = vlokfoe.bt_tick,
		},
	})
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe
