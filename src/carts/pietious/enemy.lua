local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')
local behaviourtree = require('behaviourtree')
local enemy_explosion_module = require('enemy_explosion.lua')

local enemy = {}
enemy.__index = enemy

local enemy_fsm_id = constants.ids.enemy_fsm
local enemy_bt_id = constants.ids.enemy_bt

local state_waiting = enemy_fsm_id .. ':/waiting'
local state_flying = enemy_fsm_id .. ':/flying'

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'
local death_effect_sequence = 0

local function random_between(min_value, max_value)
	return math.random(min_value, max_value)
end

local function random_percent_hit(chance_pct)
	return math.random(100) <= chance_pct
end

local function cross_hit_area_for_spin(spin_direction)
	if spin_direction == 'left' or spin_direction == 'right' then
		return { left = 2, top = 4, right = 22, bottom = 12 }
	end
	return { left = 4, top = 2, right = 12, bottom = 22 }
end

function enemy:get_player_object()
	local player = engine.object(self.player_id)
	if player == nil then
		error('pietious enemy missing player object id=' .. tostring(self.player_id))
	end
	return player
end

function enemy:is_collision_tile(world_x, world_y)
	local room = self.room
	local tx = math.floor((world_x - room.tile_origin_x) / room.tile_size) + 1
	local ty = math.floor((world_y - room.tile_origin_y) / room.tile_size) + 1
	if tx < 1 or tx > room.tile_columns then
		return true
	end
	if ty < 1 or ty > room.tile_rows then
		return true
	end
	return room.collision_map[ty][tx] ~= 0
end

function enemy:create_components()
	local body_collider = components.collider2dcomponent.new({
		parent = self,
		id_local = body_collider_component_id,
		generateoverlapevents = true,
		spaceevents = 'current',
	})
	body_collider:apply_collision_profile('enemy')
	self:add_component(body_collider)

	local body_sprite = components.spritecomponent.new({
		parent = self,
		id_local = body_sprite_component_id,
		imgid = 'meijter_up',
		offset = { x = 0, y = 0, z = 110 },
		collider_local_id = body_collider_component_id,
	})
	self:add_component(body_sprite)

	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function enemy:bind_overlap_events()
	self.events:on({
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})
end

function enemy:update_mijter_visual()
	local imgid = 'meijter_up'
	local flip_h = false
	local flip_v = false
	if self.sc:matches_state_path(state_waiting) then
		if self.direction == 'left' then
			imgid = 'meijter_r'
			flip_h = true
		elseif self.direction == 'right' then
			imgid = 'meijter_r'
		elseif self.direction == 'down' then
			imgid = 'meijter_up'
			flip_v = true
		end
	else
		local h = self.horizontal_dir_mod
		local v = self.vertical_dir_mod
		if v == -1 and h == 0 then
			imgid = 'meijter_up'
		elseif v == -1 and h == 1 then
			imgid = 'meijter_dr'
			flip_v = true
		elseif v == 0 and h == 1 then
			imgid = 'meijter_r'
		elseif v == 1 and h == 1 then
			imgid = 'meijter_dr'
		elseif v == 1 and h == 0 then
			imgid = 'meijter_up'
			flip_v = true
		elseif v == 1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
		elseif v == 0 and h == -1 then
			imgid = 'meijter_r'
			flip_h = true
		elseif v == -1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
			flip_v = true
		end
	end
	return imgid, flip_h, flip_v
end

function enemy:update_zakfoe_visual()
	local imgid = 'zakfoe_stand'
	if self.zak_state == 'jump' then
		imgid = 'zakfoe_jump'
	elseif self.zak_state == 'recovery' then
		imgid = 'zakfoe_recover'
	end
	return imgid, self.direction == 'left', false
end

function enemy:update_crossfoe_visual()
	local imgid = 'crossfoe'
	local flip_h = false
	local flip_v = false
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_v = true
	end
	return imgid, flip_h, flip_v
end

function enemy:update_visual_components()
	local body_sprite = self.body_sprite
	body_sprite.enabled = true

	local imgid = 'meijter_up'
	local flip_h = false
	local flip_v = false

	if self.kind == 'mijter' then
		imgid, flip_h, flip_v = self:update_mijter_visual()
	elseif self.kind == 'zakfoe' then
		imgid, flip_h, flip_v = self:update_zakfoe_visual()
	elseif self.kind == 'crossfoe' then
		imgid, flip_h, flip_v = self:update_crossfoe_visual()
	end

	body_sprite.imgid = imgid
	body_sprite.flip.flip_h = flip_h
	body_sprite.flip.flip_v = flip_v
end

function enemy:new_random_direction()
	local horizontal = 0
	local vertical = 0
	while horizontal == 0 and vertical == 0 do
		horizontal = math.random(-1, 1)
		vertical = math.random(-1, 1)
	end
	self.horizontal_dir_mod = horizontal
	self.vertical_dir_mod = vertical
end

function enemy:set_mijter_takeoff_heading()
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

function enemy:mijter_player_triggered_takeoff(player)
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

function enemy:start_mijter_flying(blackboard)
	self:set_mijter_takeoff_heading()
	blackboard.nodedata.mijter_takeoff_ticks = random_between(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	blackboard.nodedata.mijter_turn_ticks = random_between(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	self.sc:transition_to(state_flying)
	return behaviourtree.running
end

function enemy:bt_tick_mijter_waiting(blackboard)
	local player = self:get_player_object()
	if self:mijter_player_triggered_takeoff(player) then
		return self:start_mijter_flying(blackboard)
	end

	local takeoff_ticks = blackboard.nodedata.mijter_takeoff_ticks
	if takeoff_ticks == nil then
		takeoff_ticks = random_between(constants.enemy.mijter_wait_takeoff_min_steps, constants.enemy.mijter_wait_takeoff_max_steps)
	end
	takeoff_ticks = takeoff_ticks - 1
	if takeoff_ticks > 0 then
		blackboard.nodedata.mijter_takeoff_ticks = takeoff_ticks
		return behaviourtree.running
	end
	return self:start_mijter_flying(blackboard)
end

function enemy:bt_tick_mijter_flying(blackboard)
	local turn_ticks = blackboard.nodedata.mijter_turn_ticks
	if turn_ticks == nil then
		turn_ticks = random_between(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks <= 0 then
		self:new_random_direction()
		turn_ticks = random_between(constants.enemy.mijter_turn_min_steps, constants.enemy.mijter_turn_max_steps)
	end
	blackboard.nodedata.mijter_turn_ticks = turn_ticks

	if self.x <= self.room_left then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= self.room_right then
		self.horizontal_dir_mod = -1
	end
	if self.y <= self.room_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= self.room_bottom then
		self.vertical_dir_mod = -1
	end

	self.x = self.x + (constants.enemy.mijter_speed_px * self.horizontal_dir_mod)
	self.y = self.y + (constants.enemy.mijter_speed_px * self.vertical_dir_mod)
	return behaviourtree.running
end

function enemy:bt_tick_zakfoe(blackboard)
	local node = blackboard.nodedata
	local tile_size = self.room.tile_size

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks
		if prepare_ticks == nil then
			prepare_ticks = constants.enemy.zak_prepare_jump_steps
		end
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return behaviourtree.running
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = constants.enemy.zak_vertical_speed_start
		self.zak_ground_y = self.spawn_y
		self.zak_state = 'jump'
		node.zak_jump_ticks = constants.enemy.zak_jump_steps
		return behaviourtree.running
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks
		if jump_ticks == nil then
			jump_ticks = constants.enemy.zak_jump_steps
		end

		local direction_mod = self.direction == 'right' and 1 or -1
		self.x = self.x + (constants.enemy.zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + constants.enemy.zak_vertical_speed_step

		if self.direction == 'left' then
			if self.x < self.room_left
				or self:is_collision_tile(self.x + 2, self.y + 2)
				or not self:is_collision_tile(self.x + 2 - (tile_size / 2), self.y + 14 + tile_size)
			then
				self.direction = 'right'
			end
		else
			if self.x + 14 >= self.room_right
				or self:is_collision_tile(self.x + 14, self.y + 2)
				or not self:is_collision_tile(self.x + 14 + (tile_size / 2), self.y + 14 + tile_size)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return behaviourtree.running
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		node.zak_recovery_ticks = constants.enemy.zak_recovery_steps
		return behaviourtree.running
	end

	local recovery_ticks = node.zak_recovery_ticks
	if recovery_ticks == nil then
		recovery_ticks = constants.enemy.zak_recovery_steps
	end
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return behaviourtree.running
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	node.zak_prepare_ticks = constants.enemy.zak_prepare_jump_steps
	return behaviourtree.running
end

function enemy:bt_tick_crossfoe_waiting(blackboard)
	local player = self:get_player_object()
	local node = blackboard.nodedata
	local hit = cross_hit_area_for_spin(self.cross_spin_direction)
	local player_top = player.y
	local player_bottom = player.y + player.height
	local enemy_top = self.y + hit.top
	local enemy_bottom = self.y + hit.bottom
	local overlap_y = player_bottom >= enemy_top and player_top <= enemy_bottom

	if not overlap_y then
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		return behaviourtree.running
	end

	local wait_ticks = node.cross_wait_ticks
	if wait_ticks == nil then
		wait_ticks = constants.enemy.cross_wait_before_fly_steps
	end
	wait_ticks = wait_ticks - 1
	if wait_ticks > 0 then
		node.cross_wait_ticks = wait_ticks
		return behaviourtree.running
	end

	node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
	node.cross_turn_ticks = constants.enemy.cross_turn_steps
	if player.x < self.x then
		self.cross_state = 'flying_left'
	else
		self.cross_state = 'flying_right'
	end
	self.cross_spin_direction = 'left'
	self.sc:transition_to(state_flying)
	return behaviourtree.running
end

function enemy:bt_tick_crossfoe_flying(blackboard)
	local player = self:get_player_object()
	local node = blackboard.nodedata
	local direction_mod = self.cross_state == 'flying_left' and -1 or 1
	local hit = cross_hit_area_for_spin(self.cross_spin_direction)

	if (self.cross_state == 'flying_left' and self.x < (player.x - player.width))
		or (self.cross_state == 'flying_right' and self.x > (player.x + (player.width * 2)))
		or self:is_collision_tile(self.x + hit.left, self.y + hit.top)
	then
		self.cross_state = 'waiting'
		self.cross_spin_direction = 'down'
		self.x = self.x + (self.room.tile_size * -direction_mod)
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		node.cross_turn_ticks = constants.enemy.cross_turn_steps
		self.sc:transition_to(state_waiting)
		return behaviourtree.running
	end

	self.x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)

	local turn_ticks = node.cross_turn_ticks
	if turn_ticks == nil then
		turn_ticks = constants.enemy.cross_turn_steps
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks > 0 then
		node.cross_turn_ticks = turn_ticks
		return behaviourtree.running
	end

	turn_ticks = constants.enemy.cross_turn_steps
	if self.cross_spin_direction == 'down' then
		self.cross_spin_direction = 'left'
		self.x = self.x - 4
	elseif self.cross_spin_direction == 'left' then
		self.cross_spin_direction = 'up'
		self.x = self.x + 4
	elseif self.cross_spin_direction == 'up' then
		self.cross_spin_direction = 'right'
		self.x = self.x - 4
	else
		self.cross_spin_direction = 'down'
		self.x = self.x + 4
	end
	node.cross_turn_ticks = turn_ticks
	return behaviourtree.running
end

function enemy:configure_from_room_def(def, room, player_id)
	if def.kind ~= 'mijter' and def.kind ~= 'zakfoe' and def.kind ~= 'crossfoe' then
		error('pietious enemy invalid kind=' .. tostring(def.kind))
	end
	if def.direction ~= 'up' and def.direction ~= 'right' and def.direction ~= 'down' and def.direction ~= 'left' then
		error('pietious enemy invalid direction=' .. tostring(def.direction))
	end

	self.enemy_id = def.id
	self.room_id = room.room_id
	self.room = room
	self.space_id = room.space_id
	self.player_id = player_id
	self.kind = def.kind
	self.spawn_x = def.x
	self.spawn_y = def.y
	self.x = def.x
	self.y = def.y
	self.width = def.w or 16
	self.height = def.h or 16
	self.damage = def.damage or constants.damage.enemy_contact_damage
	self.max_health = def.health or constants.enemy.default_health
	self.health = self.max_health
	self.last_sword_hit_id = -1
	self.dangerous = true
	self.direction = def.direction
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.room_left = 0
	self.room_right = room.world_width
	self.room_top = room.world_top
	self.room_bottom = room.world_height
	self.current_vertical_speed = 0
	self.zak_state = 'prepare'
	self.zak_ground_y = self.spawn_y
	self.cross_state = 'waiting'
	self.cross_spin_direction = 'down'

	if self.kind == 'crossfoe' then
		self.width = def.w or 16
		self.height = def.h or 24
	end

	if self.btreecontexts[enemy_bt_id] then
		self:reset_tree(enemy_bt_id)
	end

	self.state_variant = 'waiting'
	self.body_collider.enabled = true
	self.visible = true
	self.sc:transition_to(state_waiting)
	self:update_visual_components()
end

function enemy:choose_drop_type()
	local health_chance = constants.enemy.mijter_drop_health_chance_pct
	local ammo_chance = constants.enemy.mijter_drop_ammo_chance_pct
	if self.kind == 'zakfoe' then
		health_chance = constants.enemy.zak_drop_health_chance_pct
		ammo_chance = constants.enemy.zak_drop_ammo_chance_pct
	elseif self.kind == 'crossfoe' then
		health_chance = constants.enemy.cross_drop_health_chance_pct
		ammo_chance = constants.enemy.cross_drop_ammo_chance_pct
	end
	if random_percent_hit(health_chance) then
		return 'life'
	end
	if random_percent_hit(ammo_chance) then
		return 'ammo'
	end
	return 'none'
end

function enemy:spawn_death_effect()
	death_effect_sequence = death_effect_sequence + 1
	local effect_id = string.format('pietious.enemy_explosion.%s.%d', self.enemy_id, death_effect_sequence)
	engine.spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		id = effect_id,
		space_id = self.space_id,
		room_id = self.room_id,
		player_id = self.player_id,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy:take_sword_hit(sword_id)
	if sword_id <= 0 then
		return false
	end
	if self.last_sword_hit_id == sword_id then
		return false
	end
	self.last_sword_hit_id = sword_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		self:mark_for_disposal()
	end
	return true
end

function enemy:on_overlap_stay(event)
	if event.other_id ~= self.player_id then
		return
	end
	local player = self:get_player_object()
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider == nil then
		error('pietious enemy missing collider on overlap event')
	end
	if other_collider.id_local == constants.ids.player_sword_collider_local then
		if player:is_slashing() then
			self:take_sword_hit(player.sword_id)
		end
		return
	end
	if other_collider.id_local == constants.ids.player_body_collider_local then
		player:take_hit(self.damage, self.x + math.floor(self.width / 2), self.y + math.floor(self.height / 2), self.kind)
	end
end

function enemy:tick()
	self:update_visual_components()
end

local function define_enemy_fsm()
	define_fsm(enemy_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:create_components()
					self:bind_overlap_events()
					return '/waiting'
				end,
			},
			waiting = {
				entering_state = function(self)
					self.state_name = 'waiting'
					self.state_variant = 'waiting'
					self:update_visual_components()
				end,
			},
			flying = {
				entering_state = function(self)
					self.state_name = 'flying'
					self.state_variant = 'flying'
					self:update_visual_components()
				end,
			},
		},
	})
end

local function define_enemy_behaviour_tree()
	behaviourtree.register_definition(enemy_bt_id, {
		root = {
			type = 'selector',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target.kind == 'mijter'
							end,
						},
						{
							type = 'selector',
							children = {
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_waiting)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_mijter_waiting(blackboard)
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
												return target.sc:matches_state_path(state_flying)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_mijter_flying(blackboard)
											end,
										},
									},
								},
							},
						},
					},
				},
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target.kind == 'zakfoe'
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return target:bt_tick_zakfoe(blackboard)
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
								return target.kind == 'crossfoe'
							end,
						},
						{
							type = 'selector',
							children = {
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_waiting)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_crossfoe_waiting(blackboard)
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
												return target.sc:matches_state_path(state_flying)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_crossfoe_flying(blackboard)
											end,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	})
end

local function register_enemy_definition()
	define_world_object({
		def_id = constants.ids.enemy_def,
		class = enemy,
		fsms = { enemy_fsm_id },
		bts = { enemy_bt_id },
		defaults = {
			space_id = constants.spaces.castle,
			enemy_id = '',
			room_id = '',
			room = nil,
			player_id = constants.ids.player_instance,
			kind = 'mijter',
			width = 16,
			height = 16,
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_sword_hit_id = -1,
			dangerous = true,
			direction = 'down',
			horizontal_dir_mod = 0,
			vertical_dir_mod = 0,
			room_left = 0,
			room_right = constants.room.width,
			room_top = constants.room.hud_height,
			room_bottom = constants.room.height,
			spawn_x = 0,
			spawn_y = 0,
			current_vertical_speed = 0,
			zak_state = 'prepare',
			zak_ground_y = 0,
			cross_state = 'waiting',
			cross_spin_direction = 'down',
			state_name = 'boot',
			state_variant = 'boot',
		},
	})
end

return {
	enemy = enemy,
	define_enemy_fsm = define_enemy_fsm,
	define_enemy_behaviour_tree = define_enemy_behaviour_tree,
	register_enemy_definition = register_enemy_definition,
	enemy_def_id = constants.ids.enemy_def,
	enemy_fsm_id = enemy_fsm_id,
	enemy_bt_id = enemy_bt_id,
}
