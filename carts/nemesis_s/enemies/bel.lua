local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local bel<const> = {}
bel.__index = bel

local hit_area<const> = {
	left = 8,
	top = 0,
	right = 16,
	bottom = 24,
}
local players_view

function bel:ctor()
	self.collider = self:get_component(collider_2d_component)
	self.collider.local_area = hit_area
end

function bel:onspawn()
	self.player_count = #players_view.objects
	self.health = bel_health * self.player_count
end

function bel:center()
	local sprite<const> = self.sprite_component
	self:set_imgid(assets_bel_middle)
	sprite.flip_h = false
	sprite.offset_x = 0
	sprite.offset_y = 0
	self.collider.shape_offset_x = 0
	self.collider.shape_offset_y = 0
end

function bel:ring()
	local sprite<const> = self.sprite_component
	local spawn_count<const> = math.random(
		bel_note_spawn_count_min,
		bel_note_spawn_count_max
	) * self.player_count
	local spawn_x<const> = self.x + sprite.offset_x + bel_note_spawn_offset_x
	local spawn_y<const> = self.y + sprite.offset_y + bel_note_spawn_offset_y
	for _ = 1, spawn_count do
		local angle<const> = math.random() * math.pi
		world:spawn(ids_noot_def, {
			stage = self.stage,
			velocity_x = math.cos(angle + math.pi * 0.5) *
				(math.random() + 0.5) * noot_velocity_scale,
			velocity_y = math.sin(angle - math.pi * 0.5) * noot_velocity_scale,
			pos = { x = spawn_x, y = spawn_y },
		})
	end
	self.events:emit('enemy.bel.ring')
end

function bel:enter_waiting()
	self.vulnerable = false
	self:center()
end

function bel:enter_ringing()
	self.vulnerable = true
	self.ring_count = 0
	self.target_ring_count = math.random(bel_ring_count_min, bel_ring_count_max)
end

function bel:enter_left()
	local sprite<const> = self.sprite_component
	self:set_imgid(assets_bel_side)
	sprite.flip_h = false
	sprite.offset_x = -bel_side_offset_x
	sprite.offset_y = bel_side_offset_y
	self.collider.shape_offset_x = -bel_side_offset_x
	self.collider.shape_offset_y = bel_side_offset_y
	self.ring_count = self.ring_count + 1
	self:ring()
end

function bel:enter_right()
	local sprite<const> = self.sprite_component
	self:set_imgid(assets_bel_side)
	sprite.flip_h = true
	sprite.offset_x = bel_side_offset_x
	sprite.offset_y = bel_side_offset_y
	self.collider.shape_offset_x = bel_side_offset_x
	self.collider.shape_offset_y = bel_side_offset_y
	self.ring_count = self.ring_count + 1
	self:ring()
end

function bel:finish_left()
	self:center()
	if self.ring_count >= self.target_ring_count then
		return '/waiting'
	end
	return '/ringing/middle_to_right'
end

function bel:finish_right()
	self:center()
	if self.ring_count >= self.target_ring_count then
		return '/waiting'
	end
	return '/ringing/middle_to_left'
end

function bel:receive_player_projectile(projectile)
	if not self.vulnerable then
		self.events:emit('enemy.bel.armored_hit')
		return true
	end
	enemy.receive_player_projectile(self, projectile)
	if self.health > 0 then
		self.events:emit('enemy.bel.hit')
		world:spawn(ids_small_explosion_def, {
			stage = self.stage,
			pos = { x = projectile.x, y = projectile.y },
		})
	end
	return true
end

function bel:on_destroyed(projectile)
	self:center()
	world:spawn(ids_large_explosion_def, {
		stage = self.stage,
		pos = { x = self.x, y = self.y },
	})
	self.events:emit('enemy.bel.destroyed')
	self.stage:resume_scrolling()
	enemy.on_destroyed(self, projectile)
end

local duration_timeline<const> = function(duration_ms, on_finished)
	return {
		def = {
			continuous = true,
			duration_ms = duration_ms,
			playback_mode = 'once',
		},
		on_finished = on_finished,
	}
end

local define_fsm<const> = function()
	fsm_library.register(ids_bel_fsm, {
		initial = 'waiting',
		states = {
			waiting = {
				entering_state = bel.enter_waiting,
				timelines = {
					wait = duration_timeline(bel_wait_ms, '/ringing'),
				},
			},
			ringing = {
				initial = 'middle_to_left',
				entering_state = bel.enter_ringing,
				states = {
					middle_to_left = {
						timelines = {
							move = duration_timeline(bel_middle_ms, '/ringing/left'),
						},
					},
					left = {
						entering_state = bel.enter_left,
						timelines = {
							hold = duration_timeline(bel_side_ms, bel.finish_left),
						},
					},
					middle_to_right = {
						timelines = {
							move = duration_timeline(bel_middle_ms, '/ringing/right'),
						},
					},
					right = {
						entering_state = bel.enter_right,
						timelines = {
							hold = duration_timeline(bel_side_ms, bel.finish_right),
						},
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	players_view = world:active_definition_view(ids_player_def)
	prefab.define({
		def_id = ids_bel_def,
		class = bel,
		base = enemy,
		components = {
			enemy.new_collider,
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_bel_fsm }),
		},
		defaults = {
			imgid = assets_bel_middle,
			max_health = bel_health,
			small_fry = false,
			z = bel_draw_z,
		},
	})
end

function bel.register()
	define_fsm()
	register_definition()
end

return bel
