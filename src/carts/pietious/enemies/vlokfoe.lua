local behaviourtree = require('behaviourtree')

local vlokfoe = {}

function vlokfoe.configure(self, def)
	self.width = 9
	self.height = 9
	self.max_health = 1
	self.health = self.max_health
	self.damage = 2
	self.despawn_on_room_switch = true
	self.sprite_component.imgid = 'vlok'
end

function vlokfoe.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function vlokfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return vlokfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function vlokfoe.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return vlokfoe
