local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local velocity<const> = require('cartlib/velocity')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local bel<const> = {}
bel.__index = bel

local players_view

function bel:ctor()
	self.collider = self:get_component(collider_2d_component)
end

function bel:onspawn()
	self.player_count = #players_view.objects
	self.health = bel_health * self.player_count
end

function bel:center()
	local sprite<const> = self.sprite_component
	self.sprite_component:set_imgid(assets_bel_middle)
	sprite.flip_h = false
	sprite:set_attachment_origin(0, 0)
	self.collider:set_local_origin(0, 0)
	self.collider:set_shape_asset(assets.collision_shape_bel_middle_body_addr)
end

function bel:ring()
	local pose<const> = self.spatial
	local sprite<const> = self.sprite_component
	local spawn_count<const> = math.random(
		bel_note_spawn_count_min,
		bel_note_spawn_count_max
	) * self.player_count
	local spawn_x<const> = pose.ox + sprite.attachment_ox + bel_note_spawn_offset_x
	local spawn_y<const> = pose.oy + sprite.attachment_oy + bel_note_spawn_offset_y
	for _ = 1, spawn_count do
		local angle<const> = math.random() * math.pi
		local velocity_x<const> = velocity.pixels_per_second_to_velocity_q8(
			math.cos(angle + math.pi * 0.5) * (math.random() + 0.5) * noot_velocity_scale_px_per_second)
		local velocity_y<const> = velocity.pixels_per_second_to_velocity_q8(
			math.sin(angle - math.pi * 0.5) * noot_velocity_scale_px_per_second)
		self.scene:spawn(ids_noot_def, { stage = self.stage },
			{ local_transform = { 1, 0, 0, 1, spawn_x, spawn_y } },
			{ fixed_velocity = { velocity_x = velocity_x, velocity_y = velocity_y } })
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
	self.sprite_component:set_imgid(assets_bel_side)
	sprite.flip_h = false
	sprite:set_attachment_origin(-bel_side_offset_x, bel_side_offset_y)
	self.collider:set_local_origin(-bel_side_offset_x, bel_side_offset_y)
	self.collider:set_shape_asset(assets.collision_shape_bel_side_body_addr)
	self.ring_count = self.ring_count + 1
	self:ring()
end

function bel:enter_right()
	local sprite<const> = self.sprite_component
	self.sprite_component:set_imgid(assets_bel_side)
	sprite.flip_h = true
	sprite:set_attachment_origin(bel_side_offset_x, bel_side_offset_y)
	self.collider:set_local_origin(bel_side_offset_x, bel_side_offset_y)
	self.collider:set_shape_asset(assets.collision_shape_bel_side_body_addr)
	self.collider:set_shape_flip(true, false)
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

function bel:receive_player_projectile(projectile, _collider_local_id, hit_point)
	if not self.vulnerable then
		self.events:emit('enemy.bel.armored_hit')
		return true
	end
	enemy.receive_player_projectile(self, projectile)
	if self.health > 0 then
		self.events:emit('enemy.bel.hit')
		self.scene:spawn(ids_small_explosion_def, {
			stage = self.stage,
		}, { local_transform = { 1, 0, 0, 1, hit_point.x, hit_point.y } })
	end
	return true
end

function bel:on_destroyed(projectile)
	local pose<const> = self.spatial
	self:center()
	self.scene:spawn(ids_large_explosion_def, {
		stage = self.stage,
	}, { local_transform = { 1, 0, 0, 1, pose.ox, pose.oy } })
	self.events:emit('enemy.bel.destroyed')
	self.stage:resume_scrolling()
	enemy.on_destroyed(self, projectile)
end

local duration_timeline<const> = function(duration_ms, on_finished)
	return {
		def = {
			phase = 'physical',
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
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { imgid = assets_bel_middle, order = bel_draw_z } },
		components = {
			enemy.collider_factory(assets.collision_shape_bel_middle_body_addr),
			stage_scroll_follower_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_bel_fsm }),
		},
		defaults = {
			max_health = bel_health,
			small_fry = false,
		},
	})
end

function bel.register()
	define_fsm()
	register_definition()
end

return bel
