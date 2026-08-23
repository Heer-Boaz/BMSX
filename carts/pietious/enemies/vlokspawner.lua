local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local vlokspawner<const> = {}
vlokspawner.__index = vlokspawner

function vlokspawner:ctor()
	self.visible = false
end

function vlokspawner.spawn_vlok(self)
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
	return bt_success
end

vlokspawner.bind = enemy_base.bind_lifecycle

local tasks<const> = {
	spawn_vlok = {
		execute = vlokspawner.spawn_vlok,
	},
}

function vlokspawner.register()
	local tree_id<const> = 'enemy_vlokspawner'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_vlokspawner_spawn_steps - 1,
				},
				{
					type = 'task',
					task = tasks.spawn_vlok,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.vlokspawner',
		class = vlokspawner,
		base = sprite_object,
		components = { bt_component.factory(tree_id) },
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
