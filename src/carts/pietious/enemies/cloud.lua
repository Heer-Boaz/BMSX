local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local cloud = {}
cloud.__index = cloud

local full_circle_milliradians = 6283

local function consume_axis_accum(accum, speed_num, speed_den)
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

function cloud.configure(self, def)
	self.width = 32
	self.height = 24
	self.max_health = 15
	self.health = self.max_health
	self.damage = 2
	self.cloud_anim_frame = 1
	self.sprite_component.imgid = 'cloud_1'
end

function cloud.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	if self.cloud_anim_frame == 2 then
		self.sprite_component.imgid = 'cloud_2'
	else
		self.sprite_component.imgid = 'cloud_1'
	end

	local anim_ticks = node.cloud_anim_ticks
	if anim_ticks == nil then
		anim_ticks = constants.enemy.cloud_anim_switch_steps
	end
	anim_ticks = anim_ticks - 1
	if anim_ticks <= 0 then
		if self.cloud_anim_frame == 1 then
			self.cloud_anim_frame = 2
		else
			self.cloud_anim_frame = 1
		end
		anim_ticks = constants.enemy.cloud_anim_switch_steps
	end
	node.cloud_anim_ticks = anim_ticks

	local dir_modifier = self.direction == 'left' and -1 or 1
	local move_accum = node.cloud_move_accum
	if move_accum == nil then
		move_accum = 0
	end
	move_accum = move_accum + constants.enemy.cloud_horizontal_speed_num
	while move_accum >= constants.enemy.cloud_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.cloud_horizontal_speed_den
	end
	node.cloud_move_accum = move_accum

	local wave_accum = node.cloud_wave_accum
	if wave_accum == nil then
		wave_accum = 0
	end
	local wave_phase = node.cloud_wave_phase_millirad
	if wave_phase == nil then
		wave_phase = 0
	end
	local wave_speed_num = round_to_nearest(math.sin(wave_phase / constants.enemy.cloud_wave_phase_denominator) * constants.enemy.cloud_wave_speed_num)
	local wave_dy, next_wave_accum = consume_axis_accum(wave_accum, wave_speed_num, constants.enemy.cloud_wave_speed_den)
	self.y = self.y + wave_dy
	wave_phase = wave_phase + constants.enemy.cloud_wave_phase_step_millirad
	if wave_phase >= full_circle_milliradians then
		wave_phase = wave_phase - full_circle_milliradians
	end
	node.cloud_wave_accum = next_wave_accum
	node.cloud_wave_phase_millirad = wave_phase

	if self.direction == 'left' then
		if self.x < self.room_left then
			self.direction = 'right'
		end
	else
		if self.x + 22 >= self.room_right then
			self.direction = 'left'
		end
	end

	local vlok_ticks = node.cloud_vlok_ticks
	if vlok_ticks == nil then
		vlok_ticks = constants.enemy.cloud_spawn_vlok_steps
	end
	vlok_ticks = vlok_ticks - 1
	if vlok_ticks <= 0 then
		for i = 1, 3 do
			local random_x = 0
			local random_y = 0
			while math.abs(random_x + random_y) < 2 do
				random_x = math.random(-5, 4)
				random_y = math.random(-5, 4)
			end
			self:spawn_child_enemy('vlokfoe', self.x + 16, self.y + 12, {
				direction = random_x < 0 and 'left' or 'right',
				speedx = random_x,
				speedy = random_y,
				speedden = 5,
			})
		end
		vlok_ticks = constants.enemy.cloud_spawn_vlok_steps
	end
	node.cloud_vlok_ticks = vlok_ticks
	return behaviourtree.running
end

function cloud.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return cloud.bt_tick(target, blackboard)
			end,
		},
	})
end

function cloud.choose_drop_type(_self, _random_percent_hit)
	return 'none'
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

local enemy_def_id = string.format('%s.%s', constants.ids.enemy_def, 'cloud')

function cloud:configure_from_room_def(def, room)
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

	cloud.configure(self, def)
	self:set_active_behaviour_tree(self.kind)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function cloud:bind_overlap_events()
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

function cloud:spawn_child_enemy(kind, x, y, options)
	options = options or {}
	local child = spawn_sprite(string.format('%s.%s', constants.ids.enemy_def, kind), {
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

function cloud:projectile_is_out_of_bounds()
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

function cloud:set_active_behaviour_tree(kind)
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

function cloud:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function cloud:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function cloud:spawn_death_effect()
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

function cloud:take_weapon_hit(weapon_kind, hit_id)
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

function cloud:on_overlap(event)
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

function cloud.register_enemy_definition()
	define_prefab({
		def_id = enemy_def_id,
		class = cloud,
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
			state_name = 'boot',
			registrypersistent = false,
		},
	})
end

cloud.enemy_def_id = enemy_def_id


return cloud
