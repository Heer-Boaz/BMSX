local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local velocity<const> = require('cartlib/velocity')
local behaviour_tree<const> = require('cartlib/behaviour_tree')
local behaviour_tree_component<const> = require('cartlib/behaviour_tree/component')
local enemy_base<const> = require('enemies/enemy_base')

local staffspawn<const> = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	self:gfx('staffspawn')
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function staffspawn.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return 'RUNNING'
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return nil
end

enemy_base.extend(staffspawn, 'staffspawn')

function staffspawn.register()
	prefab.define({
		def_id = 'enemy.staffspawn',
		class = staffspawn,
		base = sprite_object,
		components = { behaviour_tree_component.factory(behaviour_tree.action_node.new('enemy_staffspawn', staffspawn.bt_tick)) },
		defaults = {
			trigger = nil,
			conditions = {},
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
