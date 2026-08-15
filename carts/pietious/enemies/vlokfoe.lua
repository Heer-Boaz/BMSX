local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local bt_running<const> = behaviour_tree.result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
	self:set_imgid('vlok')
	enemy_base.setup_projectile_boundary(self)
end

function vlokfoe.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return bt_running
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

function vlokfoe.register()
	local root<const> = behaviour_tree.action_node.new('enemy_vlokfoe', vlokfoe.bt_tick)
	behaviour_tree_library.register(root)
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(root.id) },
		defaults = {
			trigger = nil,
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
