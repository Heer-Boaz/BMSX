local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local staffspawn = {}
staffspawn.__index = staffspawn

function staffspawn:ctor()
	self:gfx('staffspawn')
	self.sprite_component.flip.flip_h = self.speed_x_num < 0
end

function staffspawn.bt_tick(self, _blackboard)
	move_with_velocity(self)
	return behaviourtree.running
end

function staffspawn.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return staffspawn.bt_tick(target, blackboard)
			end,
		},
	})
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return nil
end

enemy_base.extend(staffspawn, 'staffspawn')

function staffspawn.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.staffspawn',
		class = staffspawn,
		type = 'sprite',
		bts = { 'enemy_staffspawn' },
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
