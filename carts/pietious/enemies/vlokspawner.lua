local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local behaviourtree_library<const> = require('cartlib/behaviourtree/library')
local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local vlokspawner<const> = {}
vlokspawner.__index = vlokspawner

function vlokspawner:ctor()
	self.visible = false
	self.collider:set_enabled(false)
end

function vlokspawner.bt_tick(self, blackboard)
	local spawn_ticks = blackboard.node_data.vlok_spawn_ticks or enemy_vlokspawner_spawn_steps
	spawn_ticks = spawn_ticks - 1
	if spawn_ticks > 0 then
		blackboard.node_data.vlok_spawn_ticks = spawn_ticks
		return 'RUNNING'
	end

	local room<const> = world:get('room')
	local random_x<const> = math.random(-5, 4)
	prefab.spawn('enemy.vlokfoe', {
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
	return 'RUNNING'
end

function vlokspawner.choose_drop_type(_self)
	return nil
end

enemy_base.extend(vlokspawner, 'vlokspawner')

function vlokspawner.register()
	local root<const> = behaviourtree.action_node.new('enemy_vlokspawner', vlokspawner.bt_tick)
	behaviourtree_library.register(root)
	prefab.define({
		def_id = 'enemy.vlokspawner',
		class = vlokspawner,
		base = spriteobject,
		components = { bt_component.factory(root.id) },
		defaults = {
			conditions = {},
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
