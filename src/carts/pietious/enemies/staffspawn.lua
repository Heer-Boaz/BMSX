local behaviourtree = require('behaviourtree')

local staffspawn = {}

function staffspawn.configure(self, def)
	self.width = 16
	self.height = 16
	self.max_health = 1
	self.health = self.max_health
	self.damage = 2
	self.dangerous = def.dangerous ~= false
	self.despawn_on_room_switch = true
	self.sprite_component.imgid = 'staffspawn'
	self.sprite_component.flip.flip_h = self.speed_x_num < 0
end

function staffspawn.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
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
	return 'none'
end

return staffspawn
