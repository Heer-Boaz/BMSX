local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local stafffoe = {}
stafffoe.__index = stafffoe

local function speed_components_from_angle(speed_num, angle_degrees)
	local radians = math.rad(angle_degrees)
	local speed_x_num = round_to_nearest(math.cos(radians) * speed_num)
	local speed_y_num = round_to_nearest(math.sin(radians) * speed_num)
	return speed_x_num, speed_y_num
end

function stafffoe.configure(self, def)
	self.width = 21
	self.height = 30
	self.max_health = 10
	self.health = self.max_health
	self.damage = 4
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self.sprite_component.imgid = 'stafffoe'
end

function stafffoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	if self.staff_state == 'default' then
		local wait_ticks = node.staff_wait_ticks
		if wait_ticks == nil then
			wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		end
		wait_ticks = wait_ticks - 1
		if wait_ticks > 0 then
			node.staff_wait_ticks = wait_ticks
			return behaviourtree.running
		end
		self.staff_state = 'spawning'
		self.staff_spawn_count = 0
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
		return behaviourtree.running
	end

	if self.staff_spawn_count >= constants.enemy.staff_spawn_burst_count then
		self.staff_state = 'default'
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		return behaviourtree.running
	end

	local spawn_wait = node.staff_wait_ticks
	if spawn_wait == nil then
		spawn_wait = constants.enemy.staff_wait_before_spawn_steps
	end
	spawn_wait = spawn_wait - 1
	if spawn_wait > 0 then
		node.staff_wait_ticks = spawn_wait
		return behaviourtree.running
	end

	local player = object(constants.ids.player_instance)
	local bullets_dangerous = not player:has_inventory_item('greenvase')
	local base_angle = math.random(0, 359)
	for i = 0, 3 do
		local angle = (base_angle + (i * 90)) % 360
		local speed_x_num, speed_y_num = speed_components_from_angle(constants.enemy.staff_bullet_speed_num, angle)
		self:spawn_child_enemy('staffspawn', self.x, self.y, {
			direction = speed_x_num < 0 and 'left' or 'right',
			speedx = speed_x_num,
			speedy = speed_y_num,
			speedden = constants.enemy.staff_bullet_speed_den,
			dangerous = bullets_dangerous,
		})
	end
	self.staff_spawn_count = self.staff_spawn_count + 1
	node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
	return behaviourtree.running
end

function stafffoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return stafffoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function stafffoe.choose_drop_type(_self, _random_percent_hit)
	return 'life'
end




local enemy_death_effect_sequence = 0

local function enemy_random_percent_hit(chance_pct)
	return math.random(100) <= chance_pct
end

local function enemy_consume_axis_accum(accum, speed_num, speed_den)
	accum = accum + speed_num
	local delta = 0
	while accum >= speed_den do
		delta = delta + 1
		accum = accum - speed_den
	end
	while accum <= -speed_den do
		delta = delta - 1
		accum = accum + speed_den
	end
	return delta, accum
end


function stafffoe:configure_from_room_def(def, room)
	self.enemy_id = def.id
	self.room_number = room.room_number
	self.room = room
	self.space_id = room.space_id
	self.kind = def.kind
	self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
	self.spawn_x = def.x
	self.spawn_y = def.y
	self.x = def.x
	self.y = def.y
	self.width = 16
	self.height = 16
	self.damage = constants.damage.enemy_contact_damage
	self.max_health = constants.enemy.default_health
	self.health = self.max_health
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.direction = def.direction or 'right'
	self.room_left = 0
	self.room_right = room.world_width
	self.room_top = room.world_top
	self.room_bottom = room.world_height
	self.despawn_on_room_switch = false

	self:set_velocity(def.speedx or 0, def.speedy or 0, def.speedden or 1)

	stafffoe.configure(self, def)
	self:set_active_behaviour_tree(self.kind)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function stafffoe:bind_overlap_events()
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
			if self.despawn_on_room_switch and event.from == self.room_number then
				self:mark_for_disposal()
			end
		end,
	})
end

function stafffoe:spawn_child_enemy(kind, x, y, options)
	options = options or {}
	local child = spawn_sprite('pietious.enemy.def.' .. kind, {
		space_id = self.space_id,
		pos = { x = x, y = y, z = 140 },
	})
	child:configure_from_room_def({
		id = child.id,
		kind = kind,
		x = x,
		y = y,
		direction = options.direction,
		speedx = options.speedx,
		speedy = options.speedy,
		speedden = options.speedden,
		health = options.health,
		damage = options.damage,
		dangerous = options.dangerous,
	}, self.room)
	return child
end

function stafffoe:projectile_is_out_of_bounds()
	local bound_right = self.projectile_bound_right
	if bound_right <= 0 then
		bound_right = self.width
	end
	local bound_bottom = self.projectile_bound_bottom
	if bound_bottom <= 0 then
		bound_bottom = self.height
	end

	if self.x + bound_right < self.room_left then
		return true
	end
	if self.x > self.room_right then
		return true
	end
	if self.y + bound_bottom < self.room_top then
		return true
	end
	if self.y > self.room_bottom then
		return true
	end
	return false
end

function stafffoe:set_active_behaviour_tree(kind)
	local bt_id = string.format('%s.%s', constants.ids.enemy_bt, kind)
	if self.btreecontexts[bt_id] == nil then
		self:add_btree(bt_id)
	end
	for id, context in pairs(self.btreecontexts) do
		context.running = id == bt_id
	end
	self:reset_tree(bt_id)
	self.active_bt_id = bt_id
end

function stafffoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function stafffoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function stafffoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	local effect_id = string.format('pietious.enemy_explosion.%s.%d', self.enemy_id, enemy_death_effect_sequence)
	spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		id = effect_id,
		space_id = self.space_id,
		room_number = self.room_number,
		loot_type = self:choose_drop_type(enemy_random_percent_hit),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function stafffoe:take_weapon_hit(weapon_kind, hit_id)
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
			room_number = self.room_number,
			enemy_id = self.enemy_id,
			kind = self.kind,
			trigger = self.trigger,
		})
		self:mark_for_disposal()
	end
	return true
end

function stafffoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local == constants.ids.player_sword_collider_local then
		if player:has_tag('g.sw') then
			self:take_weapon_hit('sword', player.sword_id)
		end
		return
	end
	if other_collider.id_local == constants.ids.player_body_collider_local and self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.width / 2), self.y + math.modf(self.height / 2), self.kind)
	end
end

function stafffoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.stafffoe',
		class = stafffoe,
		fsms = { constants.ids.enemy_fsm },
		defaults = {
			space_id = constants.spaces.castle,
			enemy_id = '',
			room_number = 0,
			room = nil,
			kind = '',
			trigger = '',
			conditions = {},
			width = 16,
			height = 16,
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			room_left = 0,
			room_right = constants.room.width,
			room_top = constants.room.hud_height,
			room_bottom = constants.room.height,
			spawn_x = 0,
			spawn_y = 0,
			despawn_on_room_switch = false,
			active_bt_id = '',
		},
	})
end

stafffoe.enemy_def_id = 'pietious.enemy.def.stafffoe'


return stafffoe
