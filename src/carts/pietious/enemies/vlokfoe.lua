local behaviourtree = require('behaviourtree')

local vlokfoe = {}

function vlokfoe.configure(self, def)
	self.width = def.w or 9
	self.height = def.h or 9
	self.max_health = def.health or 1
	self.health = self.max_health
	self.damage = def.damage or 2
	self.despawn_on_room_switch = true
	self.projectile_bound_right = 6
	self.projectile_bound_bottom = 8
	self:set_body_hit_area(2, 0, 6, 8)
end

function vlokfoe.sync_components(self)
	local imgid = 'vlok'
	local flip_h = false
	local flip_v = false
	self:set_body_sprite(imgid, flip_h, flip_v)
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
