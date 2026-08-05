local prefab<const> = require('cartlib/prefab')
local sprite_object<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local bt_component<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local boekfoe<const> = {}
boekfoe.__index = boekfoe

function boekfoe:ctor()
	self.boek_state = 'closed'
	self:gfx('boekfoe_closed')
	self.sprite_component.flip_h = self.direction == 'left'
end

function boekfoe.bt_tick(self, blackboard)
	local node<const> = blackboard.node_data
	if self.boek_state == 'closed' then
		local closed_ticks = node.boek_state_ticks or enemy_boek_wait_open_steps
		closed_ticks = closed_ticks - 1
		if closed_ticks > 0 then
			node.boek_state_ticks = closed_ticks
			return 'RUNNING'
		end
		self.boek_state = 'open'
		self:gfx('boekfoe_open')
		self.sprite_component.flip_h = self.direction == 'left'
		node.boek_state_ticks = enemy_boek_wait_close_steps
		node.boek_spawn_ticks = enemy_boek_spawn_paper_steps
		return 'RUNNING'
	end

	local open_ticks = node.boek_state_ticks or enemy_boek_wait_close_steps
	open_ticks = open_ticks - 1

	local spawn_ticks = node.boek_spawn_ticks or enemy_boek_spawn_paper_steps
	spawn_ticks = spawn_ticks - 1

	if spawn_ticks <= 0 then
		local y_speed_num<const> = math.random(-5, 4)
		world:get('c').events:emit('paperspawn')
		prefab.spawn('enemy.paperfoe', {
			direction = self.direction == 'left' and 'left' or 'right',
			speed_x_num = (self.direction == 'left' and -enemy_paper_speed_x or enemy_paper_speed_x) * 5,
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
		spawn_ticks = enemy_boek_spawn_paper_steps
	end

	if open_ticks <= 0 then
		self.boek_state = 'closed'
		self:gfx('boekfoe_closed')
		self.sprite_component.flip_h = self.direction == 'left'
		node.boek_state_ticks = enemy_boek_wait_open_steps
		node.boek_spawn_ticks = nil
		return 'RUNNING'
	end

	node.boek_state_ticks = open_ticks
	node.boek_spawn_ticks = spawn_ticks
	return 'RUNNING'
end

function boekfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_boek_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_boek_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(boekfoe, 'boekfoe')

function boekfoe.register()
	prefab.define({
		def_id = 'enemy.boekfoe',
		class = boekfoe,
		base = sprite_object,
		components = { bt_component.factory(behaviourtree.action_node.new('enemy_boekfoe', boekfoe.bt_tick)) },
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
			enemy_kind = 'boekfoe',
		},
	})
end

return boekfoe
