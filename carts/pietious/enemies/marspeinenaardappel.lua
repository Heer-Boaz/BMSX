local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local behaviourtree_library<const> = require('cartlib/behaviourtree/library')
local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local marspeinenaardappel<const> = {}
marspeinenaardappel.__index = marspeinenaardappel

-- disable-next-line single_line_method_pattern -- constructor owns the local enemy sprite id at the class boundary.
function marspeinenaardappel:ctor()
	self:set_imgid('marspeinenaardappel')
end

function marspeinenaardappel.bt_tick(self, _blackboard)
	local speed_x<const> = self.speed_x_num
	local speed_y<const> = self.speed_y_num
	local rm<const> = world:get('room')

	self.x = self.x + speed_x
	self.y = self.y + speed_y

	if speed_x < 0 then
		local test_x<const> = self.x + speed_x
		if test_x <= 0 or rm:has_collision_flags_at_world(test_x, self.y, collision_flags_solid_mask) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	elseif speed_x > 0 then
		local test_x<const> = self.x + self.sx + speed_x
		if test_x >= rm.world_width or rm:has_collision_flags_at_world(test_x, self.y, collision_flags_solid_mask) then
			self.speed_x_num = -speed_x
			self.x = self.x + (self.speed_x_num * 2)
		end
	end

	if speed_y < 0 then
		local test_y<const> = self.y + speed_y
		if test_y <= rm.world_top or rm:has_collision_flags_at_world(self.x, test_y, collision_flags_solid_mask) then
			self.speed_y_num = -speed_y
			self.y = self.y + (self.speed_y_num * 2)
		end
	elseif speed_y > 0 then
		local test_y<const> = self.y + self.sy + speed_y
		if test_y >= rm.world_height or rm:has_collision_flags_at_world(self.x, test_y, collision_flags_solid_mask) then
			self.speed_y_num = -speed_y
			self.y = self.y + (self.speed_y_num * 2)
		end
	end

	return 'RUNNING'
end

function marspeinenaardappel.choose_drop_type(_self)
	if math.random(100) <= enemy_marspein_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_marspein_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(marspeinenaardappel, 'marspeinenaardappel')

function marspeinenaardappel.register()
	local root<const> = behaviourtree.action_node.new('enemy_marspeinenaardappel', marspeinenaardappel.bt_tick)
	behaviourtree_library.register(root)
	prefab.define({
		def_id = 'enemy.marspeinenaardappel',
		class = marspeinenaardappel,
		base = sprite_object,
		components = { bt_component.factory(root.id) },
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
			enemy_kind = 'marspeinenaardappel',
		},
	})
end

return marspeinenaardappel
