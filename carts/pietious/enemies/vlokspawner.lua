local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local bt_running<const> = behaviour_tree.result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokspawner<const> = {}
vlokspawner.__index = vlokspawner

function vlokspawner:ctor()
	self.visible = false
end

function vlokspawner.bt_tick(self, blackboard)
	local spawn_ticks = blackboard.node_data.vlok_spawn_ticks or enemy_vlokspawner_spawn_steps
	spawn_ticks = spawn_ticks - 1
	if spawn_ticks > 0 then
		blackboard.node_data.vlok_spawn_ticks = spawn_ticks
		return bt_running
	end

	local room<const> = self.room
	local random_x<const> = math.random(-5, 4)
	world:spawn('enemy.vlokfoe', {
		castle = self.castle,
		room = room,
		player = self.player,
		direction = random_x < 0 and 'left' or 'right',
		speed_x_num = random_x * 2,
		speed_y_num = 5,
		speed_den = 10,
		speed_accum_x = 0,
		speed_accum_y = 0,
		pos = {
			x = math.random(2, 29) * room.tile_size,
			y = room.world_top,
			z = 140,
		},
	})
	blackboard.node_data.vlok_spawn_ticks = enemy_vlokspawner_spawn_steps
	return bt_running
end

vlokspawner.bind = enemy_base.bind_lifecycle

function vlokspawner.register()
	local root<const> = behaviour_tree.action_node.new('enemy_vlokspawner', vlokspawner.bt_tick)
	behaviour_tree_library.register(root)
	prefab.define({
		def_id = 'enemy.vlokspawner',
		class = vlokspawner,
		base = sprite_object,
		components = { bt_component.factory(root.id) },
		defaults = {
			damage = 0,
			max_health = 0,
			health = 0,dangerous = false,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'vlokspawner',
		},
	})
end

return vlokspawner
