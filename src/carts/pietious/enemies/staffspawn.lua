local behaviourtree = require('behaviourtree')

local staffspawn = {}

function staffspawn.configure(self, def, _context)
	self.width = def.w or 16
	self.height = def.h or 16
	self.max_health = def.health or 1
	self.health = self.max_health
	self.damage = def.damage or 2
	self.dangerous = def.dangerous ~= false
	self.despawn_on_room_switch = true
	self.projectile_bound_right = 14
	self.projectile_bound_bottom = 14
	self:set_body_hit_area(2, 2, 14, 14)
end

function staffspawn.update_visual(self)
	return 'staffspawn', self.speed_x_num < 0, false
end

function staffspawn.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function staffspawn.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return staffspawn
