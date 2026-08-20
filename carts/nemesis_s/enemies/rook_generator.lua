local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local rook_generator<const> = {}
rook_generator.__index = rook_generator

local frame_duration_ms<const> = clock.frame_milliseconds()
local players_view

function rook_generator:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	collider:set_shape_asset(
		assets.collision_shape_rook_generator_body_addr
	)
end

function rook_generator:onspawn()
	local player_count<const> = #players_view.objects
	if player_count == 2 then
		self.health = rook_generator_health * 2
	end
	self.rook_target_count = rook_generator_spawn_count * player_count
end

function rook_generator:enter_idle()
	self.vulnerable = false
	self:set_imgid(assets_rook_generator_closed)
	self.phase_elapsed_ms = 0
end

function rook_generator:update_idle()
	if self:dispose_if_left_of_stage(rook_generator_width) then
		return
	end
	local elapsed<const> = self.phase_elapsed_ms + frame_duration_ms
	if elapsed < self.wait_before_generation_ms then
		self.phase_elapsed_ms = elapsed
		return
	end
	self.wait_before_generation_ms = math.random(
		rook_generator_min_wait_ms,
		rook_generator_max_wait_ms
	)
	return '/generating'
end

function rook_generator:enter_generating()
	self.vulnerable = true
	self:set_imgid(assets_rook_generator_open)
	self.phase_elapsed_ms = 0
	self.rook_spawn_count = 0
end

function rook_generator:update_generating()
	if self:dispose_if_left_of_stage(rook_generator_width) or self.x <= -8 then
		return
	end
	local elapsed<const> = self.phase_elapsed_ms + frame_duration_ms
	if elapsed < rook_generator_spawn_interval_ms then
		self.phase_elapsed_ms = elapsed
		return
	end
	self.phase_elapsed_ms = elapsed - rook_generator_spawn_interval_ms
	world:spawn(ids_rook_def, {
		pos = {
			x = self.x + rook_spawn_offset_x,
			y = self.y + rook_spawn_offset_y,
		},
	})
	self.events:emit('enemy.spawned')
	local spawn_count<const> = self.rook_spawn_count + 1
	self.rook_spawn_count = spawn_count
	if spawn_count >= self.rook_target_count then
		return '/idle'
	end
end

local define_fsm<const> = function()
	fsm_library.register(ids_rook_generator_fsm, {
		initial = 'idle',
		states = {
			idle = {
				entering_state = rook_generator.enter_idle,
				update = rook_generator.update_idle,
			},
			generating = {
				entering_state = rook_generator.enter_generating,
				update = rook_generator.update_generating,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_rook_generator_def,
		class = rook_generator,
		base = enemy,
		components = {
			enemy.new_collider,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_rook_generator_fsm }),
		},
		defaults = {
			imgid = assets_rook_generator_closed,
			max_health = rook_generator_health,
			small_fry = false,
			wait_before_generation_ms = rook_generator_initial_wait_ms,
			phase_elapsed_ms = 0,
			rook_spawn_count = 0,
			rook_target_count = rook_generator_spawn_count,
			z = rook_generator_draw_z,
		},
	})
end

function rook_generator.register()
	players_view = world:active_definition_view(ids_player_def)
	define_fsm()
	register_definition()
end

return rook_generator
