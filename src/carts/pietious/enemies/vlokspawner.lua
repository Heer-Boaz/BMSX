local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local vlokspawner = {}
vlokspawner.__index = vlokspawner

function vlokspawner:ctor()
	self.visible = false
	self.collider.enabled = false
end

function vlokspawner.bt_tick(self, blackboard)
	local spawn_ticks = blackboard.nodedata.vlok_spawn_ticks
	if spawn_ticks == nil then
		spawn_ticks = constants.enemy.vlokspawner_spawn_steps
	end
	spawn_ticks = spawn_ticks - 1
	if spawn_ticks > 0 then
		blackboard.nodedata.vlok_spawn_ticks = spawn_ticks
		return behaviourtree.running
	end

	local room = service('c').current_room
	local spawn_x = math.random(2, 29) * room.tile_size
	local spawn_y = room.world_top
	local random_x = math.random(-5, 4)
	inst('enemy.def.vlokfoe', {
		space_id = room.space_id,
		despawn_on_room_switch = true,
		direction = random_x < 0 and 'left' or 'right',
		speed_x_num = random_x * 2,
		speed_y_num = 5,
		speed_den = 10,
		speed_accum_x = 0,
		speed_accum_y = 0,
		pos = {
			x = spawn_x,
			y = spawn_y,
			z = 140,
		},
	})
	blackboard.nodedata.vlok_spawn_ticks = constants.enemy.vlokspawner_spawn_steps
	return behaviourtree.running
end

function vlokspawner.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return vlokspawner.bt_tick(target, blackboard)
			end,
		},
	})
end

function vlokspawner.choose_drop_type(_self)
	return nil
end

enemy_base.extend(vlokspawner, 'vlokspawner')

function vlokspawner.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.vlokspawner',
		class = vlokspawner,
		type = 'sprite',
		bts = { 'enemy.bt.vlokspawner' },
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
			despawn_on_room_switch = false,
			enemy_kind = 'vlokspawner',
		},
	})
end

return vlokspawner
