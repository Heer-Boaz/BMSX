local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local bt_running<const> = behaviour_tree.result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local nootfoe<const> = {}
nootfoe.__index = nootfoe

local noot_colors<const> = {
	0xffffffff,
	0xffff0000,
	0xff00ffff,
	0xff00ff00,
	0xffffbfcc,
	0xffffff00,
	0xffed82ed,
}

function nootfoe:ctor()
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self:set_imgid('muzieknootfoe')
	self.sprite_component.color = self.noot_color
	self.castle.events:emit('muzieknootspawn')
	enemy_base.setup_projectile_boundary(self)
end

function nootfoe.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return bt_running
end

function nootfoe.choose_drop_type(_self)
	return nil
end

function nootfoe.register()
	local root<const> = behaviour_tree.action_node.new('enemy_nootfoe', nootfoe.bt_tick)
	behaviour_tree_library.register(root)
	prefab.define({
		def_id = 'enemy.nootfoe',
		class = nootfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(root.id) },
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
			enemy_kind = 'nootfoe',
		},
	})
end

return nootfoe
