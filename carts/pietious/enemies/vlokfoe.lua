local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local velocity<const> = require('velocity')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local vlokfoe<const> = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
	self:gfx('vlok')
	enemy_base.setup_projectile_boundary(self)
end

function vlokfoe.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return 'RUNNING'
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

enemy_base.extend(vlokfoe, 'vlokfoe')

function vlokfoe.register()
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = sprite_object,
		components = { bt_component.factory(behaviourtree.action_node.new('enemy_vlokfoe', vlokfoe.bt_tick)) },
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
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe
