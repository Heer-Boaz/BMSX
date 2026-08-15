local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
require('constants')
local behaviour_tree<const> = require('cartlib/behaviour_tree/bt')
local bt_running<const> = behaviour_tree.result.running
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local boekfoe<const> = {}
boekfoe.__index = boekfoe

function boekfoe:ctor()
	self.boek_state = 'closed'
	self:set_imgid('boekfoe_closed')
	self.sprite_component.flip_h = self.direction == 'left'
end

function boekfoe.bt_tick(self, blackboard)
	local node<const> = blackboard.node_data
	if self.boek_state == 'closed' then
		local closed_ticks = node.boek_state_ticks or enemy_boek_wait_open_steps
		closed_ticks = closed_ticks - 1
		if closed_ticks > 0 then
			node.boek_state_ticks = closed_ticks
			return bt_running
		end
		self.boek_state = 'open'
		self:set_imgid('boekfoe_open')
		self.sprite_component.flip_h = self.direction == 'left'
		node.boek_state_ticks = enemy_boek_wait_close_steps
		node.boek_spawn_ticks = enemy_boek_spawn_paper_steps
		return bt_running
	end

	local open_ticks = node.boek_state_ticks or enemy_boek_wait_close_steps
	open_ticks = open_ticks - 1

	local spawn_ticks = node.boek_spawn_ticks or enemy_boek_spawn_paper_steps
	spawn_ticks = spawn_ticks - 1

	if spawn_ticks <= 0 then
		local y_speed_num<const> = math.random(-5, 4)
		self.castle.events:emit('paperspawn')
		world:spawn('enemy.paperfoe', {
			castle = self.castle,
			room = self.room,
			player = self.player,
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
		self:set_imgid('boekfoe_closed')
		self.sprite_component.flip_h = self.direction == 'left'
		node.boek_state_ticks = enemy_boek_wait_open_steps
		node.boek_spawn_ticks = nil
		return bt_running
	end

	node.boek_state_ticks = open_ticks
	node.boek_spawn_ticks = spawn_ticks
	return bt_running
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

function boekfoe.register()
	local root<const> = behaviour_tree.action_node.new('enemy_boekfoe', boekfoe.bt_tick)
	behaviour_tree_library.register(root)
	prefab.define({
		def_id = 'enemy.boekfoe',
		class = boekfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(root.id) },
		defaults = {
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
