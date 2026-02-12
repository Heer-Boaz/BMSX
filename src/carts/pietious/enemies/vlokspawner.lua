local constants = require('constants')
local behaviourtree = require('behaviourtree')

local vlokspawner = {}

function vlokspawner.configure(self, _def)
	self.width = 0
	self.height = 0
	self.damage = 0
	self.dangerous = false
	self.can_be_hit = false
	self.max_health = 1
	self.health = 1
	self:set_body_hit_area(0, 0, 0, 0)
end

function vlokspawner.sync_components(self)
	self.body_sprite.enabled = false
	self.body_collider.enabled = false
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

	local spawn_x = math.random(2, 29) * self.room.tile_size
	local spawn_y = self.room_top
	local random_x = math.random(-5, 4)
	self:spawn_child_enemy('vlokfoe', spawn_x, spawn_y, {
		direction = random_x < 0 and 'left' or 'right',
		speedx = random_x * 2,
		speedy = 5,
		speedden = 10,
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

function vlokspawner.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return vlokspawner
