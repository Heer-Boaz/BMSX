local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')
local room_module = require('room')

local marspeinenaardappel = {}
marspeinenaardappel.__index = marspeinenaardappel

function marspeinenaardappel:ctor()
	self:gfx('marspeinenaardappel')
end

function marspeinenaardappel.bt_tick(self, _blackboard)
	local speed_x = self.speed_x_num
	local speed_y = self.speed_y_num

	self.x = self.x + speed_x
	self.y = self.y + speed_y

	if speed_x < 0 then
		local test_x = self.x + speed_x
		if test_x <= 0 or room_module.is_solid_at_world(service('c').current_room, test_x, self.y) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	elseif speed_x > 0 then
		local test_x = self.x + self.sx + speed_x
		if test_x >= service('c').current_room.world_width or room_module.is_solid_at_world(service('c').current_room, test_x, self.y) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	end

	if speed_y < 0 then
		local test_y = self.y + speed_y
		if test_y <= service('c').current_room.world_top or room_module.is_solid_at_world(service('c').current_room, self.x, test_y) then
			self.speed_y_num = -speed_y
			self.y = self.y + (self.speed_y_num * 2)
		end
	elseif speed_y > 0 then
		local test_y = self.y + self.sy + speed_y
		if test_y >= service('c').current_room.world_height or room_module.is_solid_at_world(service('c').current_room, self.x, test_y) then
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

function marspeinenaardappel.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.marspein_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.marspein_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(marspeinenaardappel, 'marspeinenaardappel')

function marspeinenaardappel.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.marspeinenaardappel',
		class = marspeinenaardappel,
		type = 'sprite',
		bts = { 'enemy.bt.marspeinenaardappel' },
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
			despawn_on_room_switch = false,
			enemy_kind = 'marspeinenaardappel',
		},
	})
end

return marspeinenaardappel
