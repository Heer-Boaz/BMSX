local behaviourtree = require('behaviourtree')

local nootfoe = {}

function nootfoe.configure(self, def, context)
	self.width = def.w or 8
	self.height = def.h or 8
	self.max_health = def.health or 1
	self.health = self.max_health
	self.damage = def.damage or 2
	self.despawn_on_room_switch = true
	self.projectile_bound_right = 6
	self.projectile_bound_bottom = 8
	self.noot_color = context.noot_colors[context.random_between(1, #context.noot_colors)]
	self:set_body_hit_area(2, 0, 6, 8)
end

function nootfoe.update_visual(self)
	return 'muzieknootfoe', false, false, self.noot_color
end

function nootfoe.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function nootfoe.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return nootfoe
