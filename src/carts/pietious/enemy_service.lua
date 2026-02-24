local constants = require('constants')
local progression = require('progression')
local world_instance = require('world').instance

local enemy_service = {}

local function resolve_enemy_instance(self, id)
	local instance = self.enemies_by_id[id]
	if instance ~= nil then
		return instance
	end
	instance = object(id)
	if instance ~= nil then
		self.enemies_by_id[id] = instance
	end
	return instance
end

function enemy_service:sync_enemy_instance(enemy_def, force_reset_from_room_template)
	local id = enemy_def.id
	local instance = object(id)
	if instance == nil then
		instance = inst('enemy.' .. enemy_def.kind, {
			id = id,
			pos = { x = enemy_def.x, y = enemy_def.y, z = 140 },
			trigger = enemy_def.trigger,
			conditions = enemy_def.conditions,
			damage = enemy_def.damage,
			health = enemy_def.health,
			max_health = enemy_def.health,
			direction = enemy_def.direction,
			speed_x_num = enemy_def.speedx,
			speed_y_num = enemy_def.speedy,
			width_tiles = enemy_def.width_tiles,
			height_tiles = enemy_def.height_tiles,
			tiletype = enemy_def.tiletype,
		})
	else
		local should_reset = force_reset_from_room_template or (not instance.active)
		instance:set_space('main')
		instance.trigger = enemy_def.trigger
		instance.conditions = enemy_def.conditions
		instance.damage = enemy_def.damage
		instance.width_tiles = enemy_def.width_tiles
		instance.height_tiles = enemy_def.height_tiles
		instance.tiletype = enemy_def.tiletype
		if enemy_def.width_tiles ~= nil then
			instance.sx = enemy_def.width_tiles * constants.room.tile_size
		end
		if enemy_def.height_tiles ~= nil then
			instance.sy = enemy_def.height_tiles * constants.room.tile_size
		end
		if enemy_def.health ~= nil then
			instance.max_health = enemy_def.health
			if should_reset then
				instance.health = enemy_def.health
			end
		end
		if should_reset and enemy_def.direction ~= nil then
			instance.direction = enemy_def.direction
		end
		if should_reset and enemy_def.speedx ~= nil then
			instance.speed_x_num = enemy_def.speedx
			instance.speed_accum_x = 0
		end
		if should_reset and enemy_def.speedy ~= nil then
			instance.speed_y_num = enemy_def.speedy
			instance.speed_accum_y = 0
		end
		if should_reset then
			instance.x = enemy_def.x
			instance.y = enemy_def.y
		end
	end

	self.enemies_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
	return instance
end

function enemy_service:deactivate_enemy_by_id(id)
	if self.enemies_by_id[id] == nil then
		self.enemies_by_id[id] = object(id)
		if self.enemies_by_id[id] == nil then
			return
		end
	end
	self.enemies_by_id[id].visible = false
	if self.enemies_by_id[id].active then
		self.enemies_by_id[id]:deactivate()
	end
end

function enemy_service:deactivate_stale_active_enemies(next_active_ids)
	local previous_active_ids = self.active_enemy_ids
	for id in pairs(previous_active_ids) do
		if not next_active_ids[id] then
			self:deactivate_enemy_by_id(id)
		end
	end
end

function enemy_service:clear_enemy_state()
	clear_map(self.enemies_by_id)
	clear_map(self.active_enemy_ids)
	clear_map(self.active_enemy_ids_scratch)
	self.enemies_hidden_for_shrine = false
end

function enemy_service:despawn_active_enemies()
	self:for_each_active_enemy_instance(function(instance)
		world_instance:despawn(instance)
	end)
	self:clear_enemy_state()
end

function enemy_service:commit_active_enemy_ids(next_active_ids)
	local previous_active_ids = self.active_enemy_ids
	self.active_enemy_ids = next_active_ids
	self.active_enemy_ids_scratch = previous_active_ids
	clear_map(previous_active_ids)
end

function enemy_service:for_each_active_enemy_instance(visitor)
	for id in pairs(self.active_enemy_ids) do
		local instance = resolve_enemy_instance(self, id)
		if instance ~= nil then
			visitor(instance, id)
		end
	end
end

function enemy_service:hide_active_enemies_for_shrine_transition()
	self.enemies_hidden_for_shrine = true
	self:for_each_active_enemy_instance(function(instance)
		instance:set_space('transition')
	end)
end

function enemy_service:restore_active_enemies_after_shrine_transition()
	if not self.enemies_hidden_for_shrine then
		return
	end
	self.enemies_hidden_for_shrine = false
	self:for_each_active_enemy_instance(function(instance)
		instance:set_space('main')
	end)
end

function enemy_service:refresh_current_room_enemies(force_reset_from_room_template)
	local castle = service('c')
	local room = castle.current_room
	local enemy_defs = room.enemies
	local next_active_ids = self.active_enemy_ids_scratch
	local previous_active_ids = self.active_enemy_ids
	clear_map(next_active_ids)

	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		local enemy_id = enemy_def.id
		if not progression.matches(castle, enemy_def.conditions) then
			goto continue
		end
		if not force_reset_from_room_template and previous_active_ids[enemy_id] then
			local live_instance = object(enemy_id)
			if live_instance ~= nil then
				self.enemies_by_id[enemy_id] = live_instance
				next_active_ids[enemy_id] = true
				goto continue
			end
		end
		self:sync_enemy_instance(enemy_def, force_reset_from_room_template)
		next_active_ids[enemy_id] = true
		::continue::
	end

	self:deactivate_stale_active_enemies(next_active_ids)
	self:commit_active_enemy_ids(next_active_ids)
end

function enemy_service:bind_enemy_events()
	self.events:on({
		event = 'enemy.defeated',
		subscriber = self,
		handler = function(event)
			local enemy_id = event.enemy_id
			self.enemies_by_id[enemy_id] = nil
			self.active_enemy_ids[enemy_id] = nil
			self.active_enemy_ids_scratch[enemy_id] = nil

			local enemy_instance = object(enemy_id)
			if enemy_instance ~= nil then
				enemy_instance.visible = false
				if enemy_instance.active then
					enemy_instance:deactivate()
				end
			end

			if event.trigger then
				self.events:emit('room.condition_set', {
					room_number = event.room_number,
					condition = event.trigger,
				})
			end
		end,
	})
end

function enemy_service:ctor()
	self.enemies_by_id = {}
	self.active_enemy_ids = {}
	self.active_enemy_ids_scratch = {}
	self.enemies_hidden_for_shrine = false
	self:bind_enemy_events()
end

local function define_enemy_service_fsm()
	define_fsm('enemy_service', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_enemy_service_definition()
	define_service({
		def_id = 'enemy',
		class = enemy_service,
		fsms = { 'enemy_service' },
		auto_activate = true,
		defaults = {
			id = 'en',
			enemies_by_id = {},
			active_enemy_ids = {},
			active_enemy_ids_scratch = {},
			enemies_hidden_for_shrine = false,
		},
	})
end

return {
	define_enemy_service_fsm = define_enemy_service_fsm,
	register_enemy_service_definition = register_enemy_service_definition,
}
