local constants<const> = require('constants')
local behaviourtree<const> = require('behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

local crossfoe<const> = {}
crossfoe.__index = crossfoe

local apply_spin_visual<const> = function(self)
	local imgid
	local flip_h
	local flip_v
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
		flip_h = false
		flip_v = false
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
		flip_v = false
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_h = false
		flip_v = true
	else
		imgid = 'crossfoe'
		flip_h = false
		flip_v = false
	end
	self:gfx(imgid)
	self.sprite_component.flip.flip_h = flip_h
	self.sprite_component.flip.flip_v = flip_v
end

function crossfoe:ctor()
	self.cross_state = 'waiting'
	self.cross_spin_direction = 'down'
	apply_spin_visual(self)
end

function crossfoe.bt_tick_waiting(self, blackboard)
	local player<const> = oget('pietolon')
	local node<const> = blackboard.nodedata
	apply_spin_visual(self)
	local wait_ticks = node.cross_wait_ticks or constants.enemy.cross_wait_before_fly_steps
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
	apply_spin_visual(self)
	oget('c').events:emit('cross')
	return behaviourtree.running
end

function crossfoe.bt_tick_flying(self, blackboard)
	local player<const> = oget('pietolon')
	local node<const> = blackboard.nodedata
	apply_spin_visual(self)
	local direction_mod<const> = self.cross_state == 'flying_left' and -1 or 1
	local next_x<const> = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)
	local next_left<const> = next_x
	local next_right<const> = next_x + self.sx

	if (self.cross_state == 'flying_left' and self.x < (player.x - player.width))
		or (self.cross_state == 'flying_right' and self.x > (player.x + (player.width * 2)))
		or next_left < 0
		or next_right > oget('room').world_width
	then
		self.cross_state = 'waiting'
		self.cross_spin_direction = 'down'
		self.x = self.x - (constants.enemy.cross_horizontal_speed_px * direction_mod)
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		node.cross_turn_ticks = constants.enemy.cross_turn_steps
		oget('c').events:emit('crossland')
		return behaviourtree.running
	end

	self.x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)

	local turn_ticks = node.cross_turn_ticks or constants.enemy.cross_turn_steps
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
	apply_spin_visual(self)
	node.cross_turn_ticks = turn_ticks
	return behaviourtree.running
end

function crossfoe.bt_tick(self, blackboard)
	if self.cross_state == 'waiting' then
		return crossfoe.bt_tick_waiting(self, blackboard)
	end
	return crossfoe.bt_tick_flying(self, blackboard)
end

function crossfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return crossfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function crossfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.cross_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.cross_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(crossfoe, 'crossfoe')

function crossfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.crossfoe',
		class = crossfoe,
		type = 'sprite',
		bts = { 'enemy_crossfoe' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 4,
			max_health = 3,
			health = 3,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'crossfoe',
		},
	})
end

return crossfoe
