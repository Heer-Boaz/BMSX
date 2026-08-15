local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local velocity<const> = require('cartlib/velocity')
local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local bt_running<const> = behaviour_tree.result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local paperfoe<const> = {}
paperfoe.__index = paperfoe

function paperfoe:ctor()
	self:set_imgid('boekfoe_paper')
	self.sprite_component.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function paperfoe.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return bt_running
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return nil
end

enemy_base.extend(paperfoe, 'paperfoe')

function paperfoe.register()
	local root<const> = behaviour_tree.action_node.new('enemy_paperfoe', paperfoe.bt_tick)
	behaviour_tree_library.register(root)
	prefab.define({
		def_id = 'enemy.paperfoe',
		class = paperfoe,
		base = sprite_object,
		components = { enemy_base.new_collider, bt_component.factory(root.id) },
		defaults = {
			trigger = nil,
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'paperfoe',
		},
	})
end

return paperfoe
