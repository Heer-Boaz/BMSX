local constants = require('constants')
local behaviourtree = require('behaviourtree')
local room_module = require('room')

local marspeinenaardappel = {}

function marspeinenaardappel.configure(self, def)
	self.width = 8
	self.height = 8
	self.max_health = 1
	self.health = self.max_health
	self.damage = 2
	self.sprite_component.imgid = 'marspeinenaardappel'
end

function marspeinenaardappel.bt_tick(self, _blackboard)
	local speed_x = self.speed_x_num
	local speed_y = self.speed_y_num

	self.x = self.x + speed_x
	self.y = self.y + speed_y

	if speed_x < 0 then
		local test_x = self.x + speed_x
		if test_x <= self.room_left or room_module.is_solid_at_world(self.room, test_x, self.y) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	elseif speed_x > 0 then
		local test_x = self.x + self.width + speed_x
		if test_x >= self.room_right or room_module.is_solid_at_world(self.room, test_x, self.y) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	end

	if speed_y < 0 then
		local test_y = self.y + speed_y
		if test_y <= self.room_top or room_module.is_solid_at_world(self.room, self.x, test_y) then
			self.speed_y_num = -speed_y
			self.y = self.y + (self.speed_y_num * 2)
		end
	elseif speed_y > 0 then
		local test_y = self.y + self.height + speed_y
		if test_y >= self.room_bottom or room_module.is_solid_at_world(self.room, self.x, test_y) then
			self.speed_y_num = -speed_y
			self.y = self.y + (self.speed_y_num * 2)
		end
	end

	return behaviourtree.running
end

function marspeinenaardappel.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return marspeinenaardappel.bt_tick(target, blackboard)
			end,
		},
	})
end

function marspeinenaardappel.choose_drop_type(_self, random_percent_hit)
	if random_percent_hit(constants.enemy.marspein_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.marspein_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

return marspeinenaardappel
