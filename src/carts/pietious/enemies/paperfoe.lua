local behaviourtree = require('behaviourtree')

local paperfoe = {}

function paperfoe.configure(self, def)
	self.width = def.w or 20
	self.height = def.h or 22
	self.max_health = def.health or 1
	self.health = self.max_health
	self.damage = def.damage or 2
	self.despawn_on_room_switch = true
	self.projectile_bound_right = 18
	self.projectile_bound_bottom = 20
	self:set_body_hit_area(2, 2, 18, 20)
end

function paperfoe.sync_components(self)
	local imgid = 'boekfoe_paper'
	local flip_h = self.speed_x_num < 0
	local flip_v = false
	self:set_body_sprite(imgid, flip_h, flip_v)
end

function paperfoe.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function paperfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return paperfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return paperfoe
