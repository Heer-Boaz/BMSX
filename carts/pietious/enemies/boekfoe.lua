local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local enemy_base<const> = require('enemies/enemy_base')

local boekfoe<const> = {}
boekfoe.__index = boekfoe

function boekfoe:ctor()
	self:set_imgid('boekfoe_closed')
	self.sprite_component.flip_h = self.direction == 'left'
end

function boekfoe.open_cover(self)
	self:set_imgid('boekfoe_open')
	self.sprite_component.flip_h = self.direction == 'left'
	return bt_success
end

function boekfoe.spawn_paper(self)
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
	return bt_success
end

function boekfoe.close_cover(self)
	self:set_imgid('boekfoe_closed')
	self.sprite_component.flip_h = self.direction == 'left'
	return bt_success
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

local tasks<const> = {
	open_cover = {
		execute = boekfoe.open_cover,
	},
	spawn_paper = {
		execute = boekfoe.spawn_paper,
	},
	close_cover = {
		execute = boekfoe.close_cover,
	},
}

function boekfoe.register()
	local tree_id<const> = 'enemy_boekfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_boek_wait_open_steps - 1,
				},
				{
					type = 'task',
					task = tasks.open_cover,
				},
				{
					type = 'simple_parallel',
					finish_mode = 'abort_background',
					main_task = {
						type = 'wait',
						duration_ticks = enemy_boek_wait_close_steps,
					},
					background_tree = {
						type = 'loop',
						child = {
							type = 'sequence',
							children = {
								{
									type = 'wait',
									duration_ticks = enemy_boek_spawn_paper_steps - 1,
								},
								{
									type = 'task',
									task = tasks.spawn_paper,
								},
							},
						},
					},
				},
				{
					type = 'task',
					task = tasks.close_cover,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.boekfoe',
		class = boekfoe,
		base = enemy_base,
		components = { enemy_base.new_collider, bt_component.factory(tree_id) },
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
