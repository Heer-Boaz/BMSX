local prefab<const> = require('cartlib/world/prefab')
local spriteobject<const> = require('cartlib/sprite')
local velocity<const> = require('cartlib/velocity')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local bt_running<const> = behaviourtree.result.running
local behaviourtreelibrary<const> = require('cartlib/behaviourtree/library')
local btcomponent<const> = require('cartlib/behaviourtree/btcomponent')
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

enemy_base.extend(vlokfoe, 'vlokfoe')

function vlokfoe.register()
	local root<const> = behaviourtree.action_node.new('enemy_vlokfoe', vlokfoe.bt_tick)
	behaviourtreelibrary.register(root)
	prefab.define({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		base = spriteobject,
		components = { btcomponent.factory(root.id) },
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
