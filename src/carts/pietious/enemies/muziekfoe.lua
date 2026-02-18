local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')
local room_module = require('room')

local muziekfoe = {}
muziekfoe.__index = muziekfoe

local function get_delta_from_source_to_target_scaled(source_x, source_y, target_x, target_y, speed_scale)
	local dx = target_x - source_x
	local dy = target_y - source_y
	if dx == 0 then
		return 0, dy > 0 and speed_scale or -speed_scale
	end
	if dy == 0 then
		return dx > 0 and speed_scale or -speed_scale, 0
	end
	local abs_dx = math.abs(dx)
	local abs_dy = math.abs(dy)
	if abs_dx > abs_dy then
		return dx > 0 and speed_scale or -speed_scale, div_toward_zero(dy * speed_scale, abs_dx)
	end
	return div_toward_zero(dx * speed_scale, abs_dy), dy > 0 and speed_scale or -speed_scale
end

function muziekfoe:ctor()
	self:gfx('muziekfoe')
end

function muziekfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local room = service('c').current_room
	local dir_modifier = self.direction == 'left' and -1 or 1
	local move_accum = node.muziek_move_accum
	if move_accum == nil then
		move_accum = 0
	end
	move_accum = move_accum + constants.enemy.muziek_horizontal_speed_num
	while move_accum >= constants.enemy.muziek_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.muziek_horizontal_speed_den
	end
	node.muziek_move_accum = move_accum

	if self.direction == 'left' then
		if self.x < 0 or room_module.is_solid_at_world(service('c').current_room, self.x, self.y) then
			self.direction = 'right'
		end
	else
		if self.x + 24 >= service('c').current_room.world_width or room_module.is_solid_at_world(service('c').current_room, self.x + 24, self.y + 16) then
			self.direction = 'left'
		end
	end

	local noot_ticks = node.muziek_noot_ticks
	if noot_ticks == nil then
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	noot_ticks = noot_ticks - 1
	if noot_ticks <= 0 then
		local player = object('pietolon')
		local source_x = self.x + 12
		local source_y = self.y + 8
		local target_x = player.x
		local target_y = player.y + player.height
		local delta_scale = 8
		local delta_x, delta_y = get_delta_from_source_to_target_scaled(source_x, source_y, target_x, target_y, delta_scale)
		local delta_divisor = math.random(1, 2)
		inst('enemy.nootfoe', {
			space_id = room.space_id,
			despawn_on_room_switch = true,
			direction = delta_x < 0 and 'left' or 'right',
			speed_x_num = delta_x,
			speed_y_num = delta_y,
			speed_den = delta_scale * delta_divisor,
			speed_accum_x = 0,
			speed_accum_y = 0,
			pos = {
				x = self.x + 12,
				y = self.y,
				z = 140,
			},
		})
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	node.muziek_noot_ticks = noot_ticks
	return behaviourtree.running
end

function muziekfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return muziekfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function muziekfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.muziek_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.muziek_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(muziekfoe, 'muziekfoe')

function muziekfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.muziekfoe',
		class = muziekfoe,
		type = 'sprite',
		bts = { 'enemy.bt.muziekfoe' },
		defaults = {
			conditions = {},
			damage = 4,
			max_health = 3,
			health = 3,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
			enemy_kind = 'muziekfoe',
		},
	})
end

return muziekfoe
