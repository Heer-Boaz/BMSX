local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local mijterfoe = {}
mijterfoe.__index = mijterfoe

function mijterfoe:onspawn(pos)
	getmetatable(self).onspawn(self, pos)
	self:bind_overlap_events()
end

local function new_random_direction(self)
	local horizontal = 0
	local vertical = 0
	while horizontal == 0 and vertical == 0 do
		horizontal = math.random(-1, 1)
		vertical = math.random(-1, 1)
	end
	self.horizontal_dir_mod = horizontal
	self.vertical_dir_mod = vertical
end

local function set_takeoff_heading(self)
	if self.direction == 'up' then
		self.horizontal_dir_mod = 0
		self.vertical_dir_mod = -1
	elseif self.direction == 'right' then
		self.horizontal_dir_mod = 1
		self.vertical_dir_mod = 0
	elseif self.direction == 'down' then
		self.horizontal_dir_mod = 0
		self.vertical_dir_mod = 1
	else
		self.horizontal_dir_mod = -1
		self.vertical_dir_mod = 0
	end
end

local function player_triggered_takeoff(self, player)
	local player_left = player.x
	local player_top = player.y
	local player_right = player.x + player.width
	local player_bottom = player.y + player.height
	local enemy_left = self.x + 2
	local enemy_top = self.y + 2
	local enemy_right = self.x + 14
	local enemy_bottom = self.y + 14
	local overlap_x = player_right >= enemy_left and player_left <= enemy_right
	local overlap_y = player_bottom >= enemy_top and player_top <= enemy_bottom

	if self.direction == 'up' then
		return overlap_x and player_top < enemy_top
	end
	if self.direction == 'right' then
		return overlap_y and player_left > enemy_right
	end
	if self.direction == 'down' then
		return overlap_x and player_top > enemy_bottom
	end
	return overlap_y and player_right < enemy_left
end

local function start_flying(self, blackboard)
	set_takeoff_heading(self)
	self:change_sprite_on_direction()
	blackboard.nodedata.mijter_takeoff_ticks = math.random(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	blackboard.nodedata.mijter_turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	self:dispatch_state_event('takeoff')
	return behaviourtree.running
end

function mijterfoe.configure(self, _def)
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.mijter_entry_lock_ticks = constants.enemy.mijter_room_entry_lock_steps
	self:change_sprite_on_direction()
end

function mijterfoe.change_sprite_on_direction(self)
	local imgid
	local flip_h
	local flip_v
	local h = self.horizontal_dir_mod
	local v = self.vertical_dir_mod
	if v == -1 and h == 0 then
		imgid = 'meijter_up'
		flip_h = false
		flip_v = false
	elseif v == -1 and h == 1 then
		imgid = 'meijter_dr'
		flip_h = false
		flip_v = true
	elseif v == 0 and h == 1 then
		imgid = 'meijter_r'
		flip_h = false
		flip_v = false
	elseif v == 1 and h == 1 then
		imgid = 'meijter_dr'
		flip_h = false
		flip_v = false
	elseif v == 1 and h == 0 then
		imgid = 'meijter_up'
		flip_h = false
		flip_v = true
	elseif v == 1 and h == -1 then
		imgid = 'meijter_dr'
		flip_h = true
		flip_v = false
	elseif v == 0 and h == -1 then
		imgid = 'meijter_r'
		flip_h = true
		flip_v = false
	else
		imgid = 'meijter_dr'
		flip_h = true
		flip_v = true
	end
	self:gfx(imgid)
	self.sprite_component.flip.flip_h = flip_h
	self.sprite_component.flip.flip_v = flip_v
end

function mijterfoe.bt_tick_waiting(self, blackboard)
	local entry_lock = blackboard.nodedata.mijter_entry_lock_ticks
	if entry_lock == nil then
		entry_lock = self.mijter_entry_lock_ticks
	end
	if entry_lock > 0 then
		blackboard.nodedata.mijter_entry_lock_ticks = entry_lock - 1
		return behaviourtree.running
	end
	blackboard.nodedata.mijter_entry_lock_ticks = 0

	local player = object(constants.ids.player_instance)
	if player_triggered_takeoff(self, player) then
		return start_flying(self, blackboard)
	end

	local takeoff_ticks = blackboard.nodedata.mijter_takeoff_ticks
	if takeoff_ticks == nil then
		takeoff_ticks = math.random(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	end
	takeoff_ticks = takeoff_ticks - 1
	if takeoff_ticks > 0 then
		blackboard.nodedata.mijter_takeoff_ticks = takeoff_ticks
		return behaviourtree.running
	end
	return start_flying(self, blackboard)
end

function mijterfoe.bt_tick_flying(self, blackboard)
	local turn_ticks = blackboard.nodedata.mijter_turn_ticks
	if turn_ticks == nil then
		turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks <= 0 then
		new_random_direction(self)
		turn_ticks = math.random(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
		self:change_sprite_on_direction()
	end
	blackboard.nodedata.mijter_turn_ticks = turn_ticks

	if self.x <= 0 then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= service(constants.ids.castle_service_instance).current_room.world_width then
		self.horizontal_dir_mod = -1
	end
	if self.y <= service(constants.ids.castle_service_instance).current_room.world_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= service(constants.ids.castle_service_instance).current_room.world_height then
		self.vertical_dir_mod = -1
	end

	self:change_sprite_on_direction()
	self.x = self.x + (constants.enemy.mijter_speed_px * self.horizontal_dir_mod)
	self.y = self.y + (constants.enemy.mijter_speed_px * self.vertical_dir_mod)
	return behaviourtree.running
end

function mijterfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'selector',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target:has_tag('e.w')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return mijterfoe.bt_tick_waiting(target, blackboard)
							end,
						},
					},
				},
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target:has_tag('e.f')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return mijterfoe.bt_tick_flying(target, blackboard)
							end,
						},
					},
				},
			},
		},
	})
end

function mijterfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.mijter_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.mijter_drop_ammo_chance_pct then
		return 'ammo'
	end
	return 'none'
end

local enemy_death_effect_sequence = 0


function mijterfoe:configure_from_room_def(def, room)
		self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
		self.damage = 2
	self.max_health = 1
	self.health = self.max_health
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.direction = def.direction or 'right'
	self.despawn_on_room_switch = false

	self:set_velocity(def.speedx or 0, def.speedy or 0, def.speedden or 1)

	mijterfoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function mijterfoe:bind_overlap_events()
	self.events:on({
		event_name = 'overlap',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			if self.despawn_on_room_switch then
				self:mark_for_disposal()
			end
		end,
	})
end
function mijterfoe:projectile_is_out_of_bounds()
	local bound_right = self.projectile_bound_right
	if bound_right <= 0 then
		bound_right = self.sx
	end
	local bound_bottom = self.projectile_bound_bottom
	if bound_bottom <= 0 then
		bound_bottom = self.sy
	end

	if self.x + bound_right < 0 then
		return true
	end
	if self.x > service(constants.ids.castle_service_instance).current_room.world_width then
		return true
	end
	if self.y + bound_bottom < service(constants.ids.castle_service_instance).current_room.world_top then
		return true
	end
	if self.y > service(constants.ids.castle_service_instance).current_room.world_height then
		return true
	end
	return false
end

function mijterfoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function mijterfoe:move_with_velocity()
	local dx, next_accum_x = consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function mijterfoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	inst(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		space_id = room_space,
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function mijterfoe:take_weapon_hit(weapon_kind, hit_id)
	if self.last_weapon_kind == weapon_kind and self.last_weapon_hit_id == hit_id then
		return false
	end
	self.last_weapon_kind = weapon_kind
	self.last_weapon_hit_id = hit_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
			eventemitter.eventemitter.instance:emit(constants.events.enemy_defeated, self.id, {
				room_number = service(constants.ids.castle_service_instance).current_room.room_number,
				kind = 'mijterfoe',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function mijterfoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
		return
	end
	if self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'mijterfoe')
	end
end

function mijterfoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.mijterfoe',
		class = mijterfoe,
		type = 'sprite',
		fsms = { constants.ids.enemy_fsm },
		defaults = {
			trigger = '',
			conditions = {},
			damage = 2,
			max_health = 1,
			health = 1,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
		},
	})
end

return mijterfoe
