local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local staffspawn<const> = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	self:set_imgid('staffspawn')
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function staffspawn.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return bt_running
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return nil
end

function staffspawn.register()
	local tree_id<const> = 'enemy_staffspawn'
	behaviour_tree_library.register(tree_id, {
		type = 'action',
		action = staffspawn.bt_tick,
	})
	prefab.define({
		def_id = 'enemy.staffspawn',
		class = staffspawn,
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
			enemy_kind = 'staffspawn',
		},
	})
end

return staffspawn
