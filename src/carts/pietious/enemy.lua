local constants = require('constants')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local enemy = {}
enemy.__index = enemy

local function random_percent_hit(chance_pct)
	return math.random(100) <= chance_pct
end

local function build_spawned_enemy_id(kind)
	spawned_enemy_sequence = spawned_enemy_sequence + 1
	return string.format('enemy_spawn_%s_%06d', kind, spawned_enemy_sequence)
end

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

local function set_sprite_state(self, definition)
	local sprite = self.sprite_component
	if sprite == nil then
		return
	end
	sprite.imgid = definition.imgid
	sprite.flip.flip_h = definition.flip_h
	sprite.flip.flip_v = definition.flip_v
	sprite.colorize = definition.colorize
end

local function copy_colorize(value)
	if value == nil then
		return { r = 1, g = 1, b = 1, a = 1 }
	end
	return { r = value.r, g = value.g, b = value.b, a = value.a }
end

local function apply_body_config(self)
	local collider = self.collider
	if collider ~= nil then
		collider.generateoverlapevents = true
		collider.spaceevents = 'current'
		collider:apply_collision_profile('enemy')
		collider:set_shape_offset(0, 0)
		local hit_area = self._pending_body_hit_area
		if hit_area ~= nil then
			collider:set_local_area(hit_area)
		end
	end

	local sprite = self.sprite_component
	if sprite ~= nil then
		sprite.offset.z = 110
		if self._pending_body_sprite ~= nil then
			set_sprite_state(self, self._pending_body_sprite)
		end
	end
end

local function get_kind_module(kind)
	if kind == 'boekfoe' then
		return require('enemies/boekfoe')
	end
	if kind == 'cloud' then
		return require('enemies/cloud')
	end
	if kind == 'crossfoe' then
		return require('enemies/crossfoe')
	end
	if kind == 'marspeinenaardappel' then
		return require('enemies/marspeinenaardappel')
	end
	if kind == 'mijterfoe' then
		return require('enemies/mijterfoe')
	end
	if kind == 'muziekfoe' then
		return require('enemies/muziekfoe')
	end
	if kind == 'nootfoe' then
		return require('enemies/nootfoe')
	end
	if kind == 'paperfoe' then
		return require('enemies/paperfoe')
	end
	if kind == 'stafffoe' then
		return require('enemies/stafffoe')
	end
	if kind == 'staffspawn' then
		return require('enemies/staffspawn')
	end
	if kind == 'vlokfoe' then
		return require('enemies/vlokfoe')
	end
	if kind == 'vlokspawner' then
		return require('enemies/vlokspawner')
	end
	if kind == 'zakfoe' then
		return require('enemies/zakfoe')
	end
	error('pietious enemy invalid kind=' .. tostring(kind))
end

local enemy_bt_ids = {}

local death_effect_sequence = 0
local spawned_enemy_sequence = 0

function enemy:create_components()
	apply_body_config(self)
end

function enemy:set_body_hit_area(left, top, right, bottom)
	self._pending_body_hit_area = {
		left = left,
		top = top,
		right = right,
		bottom = bottom,
	}
	local collider = self.collider
	if collider == nil then
		return
	end
	collider:set_local_area(self._pending_body_hit_area)
end

function enemy:set_body_sprite(imgid, flip_h, flip_v, colorize)
	local definition = {
		imgid = imgid,
		flip_h = flip_h == true,
		flip_v = flip_v == true,
		colorize = copy_colorize(colorize),
	}
	self._pending_body_sprite = definition
	local sprite = self.sprite_component
	if sprite == nil then
		return
	end
	set_sprite_state(self, definition)
end

function enemy:set_body_enabled(enabled)
	local sprite = self.sprite_component
	if sprite ~= nil then
		sprite.enabled = enabled
	end
	local collider = self.collider
	if collider ~= nil then
		collider.enabled = enabled
	end
end

function enemy:hide_body_components()
	self:set_body_enabled(false)
end

function enemy:bind_overlap_events()
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

function enemy:spawn_child_enemy(kind, x, y, options)
	local id = build_spawned_enemy_id(kind)
	local child = spawn_sprite(constants.ids.enemy_def, {
		id = id,
		space_id = self.space_id,
		pos = { x = x, y = y, z = 140 },
	})
	child:configure_from_room_def({
		id = id,
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
		spawned = true,
	}, self.room)
	return child
end

function enemy:projectile_is_out_of_bounds()
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

function enemy:set_active_behaviour_tree(kind)
	local bt_id = enemy_bt_ids[kind]
	if self.btreecontexts[bt_id] == nil then
		self:add_btree(bt_id)
	end
	for id, context in pairs(self.btreecontexts) do
		context.running = id == bt_id
	end
	self:reset_tree(bt_id)
	self.active_bt_id = bt_id
end

function enemy:configure_from_room_def(def, room)
	self._pending_body_hit_area = nil
	self._pending_body_sprite = nil
	self.enemy_id = def.id
	self.room_number = room.room_number
	self.room = room
	self.space_id = room.space_id
	self.kind = def.kind
	self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
	self.spawned = def.spawned == true
	self.spawn_x = def.x
	self.spawn_y = def.y
	self.x = def.x
	self.y = def.y
	self.width = def.w or 16
	self.height = def.h or 16
	self.damage = def.damage or constants.damage.enemy_contact_damage
	self.max_health = def.health or constants.enemy.default_health
	self.health = self.max_health
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.can_be_hit = true
	self.direction = def.direction or 'right'
	self.room_left = 0
	self.room_right = room.world_width
	self.room_top = room.world_top
	self.room_bottom = room.world_height
	self.despawn_on_room_switch = false
	self.projectile_bound_right = 0
	self.projectile_bound_bottom = 0

	self:set_velocity(def.speedx or 0, def.speedy or 0, def.speedden or 1)

	local kind_module = get_kind_module(self.kind)
	kind_module.configure(self, def)
	self:set_active_behaviour_tree(self.kind)
	if kind_module.on_configured ~= nil then
		kind_module.on_configured(self)
	end
	self:dispatch_state_event('reset_to_waiting')
	apply_body_config(self)
end

function enemy:choose_drop_type()
	local kind_module = get_kind_module(self.kind)
	return kind_module.choose_drop_type(self, random_percent_hit)
end

function enemy:spawn_death_effect()
	death_effect_sequence = death_effect_sequence + 1
	local effect_id = string.format('pietious.enemy_explosion.%s.%d', self.enemy_id, death_effect_sequence)
	spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		id = effect_id,
		space_id = self.space_id,
		room_number = self.room_number,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy:take_weapon_hit(weapon_kind, hit_id)
	if not self.can_be_hit then
		return false
	end
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

function enemy:on_overlap(event)
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

local function define_enemy_fsm()
	define_fsm(constants.ids.enemy_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self:create_components()
					self:bind_overlap_events()
					return '/waiting'
				end,
			},
			waiting = {
				tags = { 'e.w' },
				on = {
					['takeoff'] = '/flying',
					['reset_to_waiting'] = '/waiting',
				},
				entering_state = function(self)
					self.state_name = 'waiting'
				end,
			},
			flying = {
				tags = { 'e.f' },
				on = {
					['land'] = '/waiting',
					['reset_to_waiting'] = '/waiting',
				},
				entering_state = function(self)
					self.state_name = 'flying'
				end,
					},
		},
	})
end

local function define_enemy_behaviour_tree()
	local list = {
		'boekfoe',
		'cloud',
		'crossfoe',
		'marspeinenaardappel',
		'mijterfoe',
		'muziekfoe',
		'nootfoe',
		'paperfoe',
		'stafffoe',
		'staffspawn',
		'vlokfoe',
		'vlokspawner',
		'zakfoe',
	}

	for i = 1, #list do
		local kind = list[i]
		local module = get_kind_module(kind)
		local bt_id = string.format('%s.%s', constants.ids.enemy_bt, kind)
		module.register_behaviour_tree(bt_id)
		enemy_bt_ids[kind] = bt_id
	end
end

local function register_enemy_definition()
	define_prefab({
		def_id = constants.ids.enemy_def,
		class = enemy,
		fsms = { constants.ids.enemy_fsm },
		defaults = {
			space_id = constants.spaces.castle,
			enemy_id = '',
			room_number = 0,
			room = nil,
			kind = '',
			trigger = '',
			conditions = {},
			spawned = false,
			width = 16,
			height = 16,
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			dangerous = true,
			can_be_hit = true,
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
			projectile_bound_right = 0,
			projectile_bound_bottom = 0,
			active_bt_id = '',
			state_name = 'boot',
		},
	})
end

function enemy:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function enemy:move_with_velocity()
	local dx, next_accum_x = consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

return {
	enemy = enemy,
	define_enemy_fsm = define_enemy_fsm,
	define_enemy_behaviour_tree = define_enemy_behaviour_tree,
	register_enemy_definition = register_enemy_definition,
	enemy_def_id = constants.ids.enemy_def,
	enemy_fsm_id = constants.ids.enemy_fsm,
	enemy_bt_ids = enemy_bt_ids,
}
