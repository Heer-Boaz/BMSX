local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local boekfoe = {}
boekfoe.__index = boekfoe

function boekfoe:ctor()
	self.boek_state = 'closed'
	self:gfx('boekfoe_closed')
	self.sprite_component.flip.flip_h = self.direction == 'left'
end

function boekfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local room = service('c').current_room

	if self.boek_state == 'closed' then
		local closed_ticks = node.boek_state_ticks
		if closed_ticks == nil then
			closed_ticks = constants.enemy.boek_wait_open_steps
		end
		closed_ticks = closed_ticks - 1
		if closed_ticks > 0 then
			node.boek_state_ticks = closed_ticks
			return behaviourtree.running
		end
		self.boek_state = 'open'
		self:gfx('boekfoe_open')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		node.boek_state_ticks = constants.enemy.boek_wait_close_steps
		node.boek_spawn_ticks = constants.enemy.boek_spawn_paper_steps
		return behaviourtree.running
	end

	local open_ticks = node.boek_state_ticks
	if open_ticks == nil then
		open_ticks = constants.enemy.boek_wait_close_steps
	end
	open_ticks = open_ticks - 1

	local spawn_ticks = node.boek_spawn_ticks
	if spawn_ticks == nil then
		spawn_ticks = constants.enemy.boek_spawn_paper_steps
	end
	spawn_ticks = spawn_ticks - 1

	if spawn_ticks <= 0 then
		local y_speed_num = math.random(-5, 4)
		service('c').events:emit('paperspawn')
		inst('enemy.paperfoe', {
			despawn_on_room_switch = true,
			direction = self.direction == 'left' and 'left' or 'right',
			speed_x_num = (self.direction == 'left' and -constants.enemy.paper_speed_x or constants.enemy.paper_speed_x) * 5,
			speed_y_num = y_speed_num,
			speed_den = 5,
			speed_accum_x = 0,
			speed_accum_y = 0,
			pos = {
				x = self.x,
				y = self.y,
				z = 140,
			},
		})
		spawn_ticks = constants.enemy.boek_spawn_paper_steps
	end

	if open_ticks <= 0 then
		self.boek_state = 'closed'
		self:gfx('boekfoe_closed')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		node.boek_state_ticks = constants.enemy.boek_wait_open_steps
		node.boek_spawn_ticks = nil
		return behaviourtree.running
	end

	node.boek_state_ticks = open_ticks
	node.boek_spawn_ticks = spawn_ticks
	return behaviourtree.running
end

function boekfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return boekfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function boekfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.boek_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.boek_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(boekfoe, 'boekfoe')

function boekfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.boekfoe',
		class = boekfoe,
		type = 'sprite',
		bts = { 'enemy_boekfoe' },
		defaults = {
			conditions = {},
			damage = 4,
			max_health = 6,
			health = 6,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
			enemy_kind = 'boekfoe',
		},
	})
end

return boekfoe
