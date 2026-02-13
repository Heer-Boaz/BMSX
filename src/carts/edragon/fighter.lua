local constants = require('constants')

local fighter = {}
fighter.__index = fighter

local role_player = constants.role.player
local role_enemy = constants.role.enemy
local state = constants.state

local function sign(value)
	if value < 0 then
		return -1
	end
	return 1
end

local state_timing = {}
for state_name, duration in pairs(constants.state_timings or {}) do
	state_timing[state[state_name]] = duration
end

local attack_profiles = {}
for attack_name, profile in pairs(constants.attack_profiles or {}) do
	attack_profiles[state[attack_name]] = profile
end

local hit_state_chain = constants.hit_state_chain or {}

local function state_duration(state_id)
	return state_timing[state_id] or 0
end

function fighter:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function()
		self:draw()
	end
end

function fighter:set_state(next_state)
	self.state = next_state
	self.state_timer = state_duration(next_state)
end

function fighter:reset_runtime()
	if self.role == role_enemy then
		self.width = constants.enemy.width
		self.height = constants.enemy.height
		self.max_health = constants.enemy.max_health
		self.health = constants.enemy.max_health
	else
		self.width = constants.player.width
		self.height = constants.player.height
		self.max_health = constants.player.max_health
		self.health = constants.player.max_health
	end

	self.x = self.spawn_x
	self.y = self.spawn_y
	self.vx = 0
	self.vy = 0
	self.facing = 1
	self.grounded = true
	self.state = state.idle
	self.state_timer = state_duration(state.idle)
	self.left_held = false
	self.right_held = false
	self.jump_pressed = false
	self.jump_held = false
	self.attack_a_pressed = false
	self.attack_b_pressed = false
	self.attack_pressed = false
	self.attack_timer = 0
	self.attack_cooldown = 0
	self.attack_hit_frame = 0
	self.attack_hit_registered = false
	self.attack_return_state = state.idle
	self.hurt_timer = 0
	self.hit_freeze = 0
	self.invuln_timer = 0
	self.step = 0
end

function fighter:ctor()
	self:bind_visual()
	self:reset_runtime()
end

function fighter:sample_player_input()
	local was_jump_held = self.jump_held
	local was_attack_a = self.attack_a_pressed
	local was_attack_b = self.attack_b_pressed
	self.left_held = action_triggered(constants.controls.left)
	self.right_held = action_triggered(constants.controls.right)
	self.jump_held = action_triggered(constants.controls.jump)
	self.jump_pressed = self.jump_held and not was_jump_held
	self.attack_a_pressed = action_triggered(constants.controls.punch)
	self.attack_b_pressed = action_triggered(constants.controls.kick)
	self.attack_a_pressed = self.attack_a_pressed and not was_attack_a
	self.attack_b_pressed = self.attack_b_pressed and not was_attack_b
	self.attack_pressed = self.attack_a_pressed or self.attack_b_pressed
end

function fighter:sample_enemy_input()
	local enemy_target = object(self.target_id)
	self.left_held = enemy_target.x < self.x
	self.right_held = enemy_target.x > self.x
	local wants_attack = self.step % constants.enemy.think_every == 0 and (math.abs(enemy_target.x - self.x) <= constants.attack.range_x * 2)
	self.attack_a_pressed = wants_attack
	self.attack_b_pressed = self.attack_a_pressed
	self.attack_pressed = self.attack_a_pressed
	self.jump_held = false
	self.jump_pressed = false
end

function fighter:sample_input()
	if self.role == role_player then
		self:sample_player_input()
		return
	end
	self:sample_enemy_input()
end

function fighter:get_ground_movement_direction()
	if self.left_held and not self.right_held then
		return -1
	end
	if self.right_held and not self.left_held then
		return 1
	end
	return 0
end

function fighter:apply_facing(direction)
	if direction == 0 then
		return
	end
	self.facing = direction
end

function fighter:get_ground_return_state()
	return self:get_ground_movement_direction() ~= 0 and state.walk or state.idle
end

function fighter:get_air_return_state()
	local walk_dir = self:get_ground_movement_direction()
	if walk_dir == 0 then
		return state.jump_up
	end
	return state.jump_forward_player
end

function fighter:begin_jump()
	local dir = self:get_ground_movement_direction()
	local jump_state = dir == 0 and state.jump_up or state.jump_forward_player
	if dir ~= 0 then
		self:apply_facing(dir)
	end
	self:set_state(jump_state)
	self.vy = constants.physics.jump_speed
	if jump_state == state.jump_forward_player then
		self.vx = self.facing * (constants.physics.walk_speed * 1.2)
	else
		self.vx = 0
	end
	self.grounded = false
	self.attack_return_state = jump_state
	self.attack_timer = 0
	self.attack_hit_registered = false
end

function fighter:build_attack_state()
	if self:get_air_return_state() ~= state.jump_up then
		self.attack_return_state = state.jump_forward_player
	else
		self.attack_return_state = state.jump_up
	end

	if self.grounded then
		if self.attack_a_pressed and self.attack_b_pressed then
			return state.uppercut_normal
		end
		if self.attack_a_pressed then
			return state.punch_normal
		end
		return state.kick
	end

	if self.attack_a_pressed and self.attack_b_pressed then
		return state.cyclone_kick
	end
	if self.attack_a_pressed then
		return state.jump_kick
	end
	return state.uppercut_sudden
end

function fighter:begin_attack()
	if self.attack_cooldown > 0 then
		return false
	end

	if not (self.attack_a_pressed or self.attack_b_pressed) then
		return false
	end

	local attack_state = self:build_attack_state()
	local profile = attack_profiles[attack_state] or {
		duration = constants.attack.duration,
		hit_window = constants.attack.hit_window,
		cooldown = constants.attack.cooldown,
		pushback = constants.physics.pushback_speed,
	}

	self:set_state(attack_state)
	self.attack_timer = profile.duration
	self.attack_hit_frame = profile.hit_window
	self.attack_hit_registered = false
	self.attack_cooldown = 0
	self.attack_profile = profile
	self.attack_return_state = self:get_air_return_state()
	return true
end

function fighter:finish_attack()
	self.attack_cooldown = (self.attack_profile and self.attack_profile.cooldown) or constants.attack.cooldown
	self.attack_timer = 0
	self.attack_hit_frame = 0
	self.attack_hit_registered = false
	self.attack_profile = nil
	if self.grounded then
		self:set_state(self:get_ground_return_state())
	else
		self:set_state(self.attack_return_state)
	end
end

function fighter:perform_attack()
	if self.attack_timer <= 0 then
		return
	end

	if self.attack_timer > 0 and self.attack_timer == self.attack_hit_frame and not self.attack_hit_registered then
		self:check_attack_connect()
		self.attack_hit_registered = true
	end

	self.attack_timer = self.attack_timer - 1
	if self.attack_timer <= 0 then
		self:finish_attack()
	end
end

function fighter:check_attack_connect()
	local target = object(self.target_id)
	local profile = self.attack_profile
	local range = constants.attack.range_x + (profile and profile.range_bonus or 0)
	local hit_min_x = self.x
	local hit_max_x = self.x + self.width
	if self.facing == 1 then
		hit_min_x = self.x + self.width
		hit_max_x = hit_min_x + range
	else
		hit_min_x = self.x - range
		hit_max_x = self.x
	end

	local target_min_x = target.x
	local target_max_x = target.x + target.width
	if target_min_x <= hit_max_x and target_max_x >= hit_min_x then
		if math.abs(target.y - self.y) <= 10 then
			target:receive_hit(self)
		end
	end
end

function fighter:resolve_hit_state_for(instigator)
	if self.health <= 0 then
		return state.death_normal
	end

	if self.state >= state.knockback_a and self.state <= state.fall_from_gear then
		return hit_state_chain[self.state] or (self.grounded and state.lie_on_ground or state.fall_from_gear)
	end

	if self.grounded == false then
		if self.state >= state.hit_light and self.state <= state.hit_very_heavy then
			return state.knockback_a
		end
		return state.knockback_a
	end

	if self.state >= state.hit_light and self.state <= state.hit_very_heavy then
		return hit_state_chain[self.state] or state.hit_light
	end
	return state.hit_light
end

function fighter:receive_hit(instigator)
	if self.invuln_timer > 0 then
		return
	end

	if self.health == 0 then
		return
	end

	self.health = self.health - constants.attack.damage
	self.hurt_timer = constants.attack.hurt_time
	self.invuln_timer = constants.attack.hit_freeze + constants.attack.hurt_time
	self.hit_freeze = constants.attack.hit_freeze
	self.vx = constants.physics.pushback_speed * -sign(instigator.facing)
	self.vy = -2

	if self.health <= 0 then
		self.health = 0
		self:set_state(state.death_normal)
		self.invuln_timer = 60
		return
	end

	self:set_state(self:resolve_hit_state_for(instigator))
end

function fighter:apply_horizontal()
	local dir = self:get_ground_movement_direction()
	if self.state == state.idle then
		self.vx = 0
		return
	end
	if self.state == state.walk or self.state == state.run then
		if dir == 0 then
			self.vx = 0
			self.state = state.idle
		else
			self.vx = dir * constants.physics.walk_speed
			self:apply_facing(dir)
		end
		return
	end
	if self.state == state.jump_forward_player then
		if dir == 0 then
			self.vx = 0
		else
			self.vx = dir * (constants.physics.walk_speed * 1.2)
			self:apply_facing(dir)
		end
	end
end

function fighter:apply_vertical()
	if self.state == state.land_after_jump or self.state == state.fall_after_action then
		self.vx = self.vx * 0.9
	end

	if self.grounded then
		self.vy = 0
		return
	end

	if self.state ~= state.defeat then
		self.vy = self.vy + constants.physics.gravity
		if self.vy > constants.physics.max_fall then
			self.vy = constants.physics.max_fall
		end
		self.y = self.y + self.vy
	end

	local floor = constants.physics.floor_y - self.height
	if self.y >= floor then
		self.y = floor
		if self.vy > 0 then
			self.vy = 0
		end
		self.grounded = true
	end
end

function fighter:clamp_to_arena()
	local max_x = constants.machine.width - self.width
	if self.x < 0 then
		self.x = 0
	end
	if self.x > max_x then
		self.x = max_x
	end
end

function fighter:progress_timers()
	if self.state_timer > 0 then
		self.state_timer = self.state_timer - 1
	end
	if self.hit_freeze > 0 then
		self.hit_freeze = self.hit_freeze - 1
	end
	if self.hurt_timer > 0 then
		self.hurt_timer = self.hurt_timer - 1
	end
	if self.invuln_timer > 0 then
		self.invuln_timer = self.invuln_timer - 1
	end
	if self.attack_cooldown > 0 then
		self.attack_cooldown = self.attack_cooldown - 1
	end
end

function fighter:move()
	self.x = self.x + self.vx
	self:apply_vertical()
	self:clamp_to_arena()
end

function fighter:handle_hit_chain_state()
	if self.state_timer > 0 then
		return
	end
	local next_state = hit_state_chain[self.state]
	if next_state then
		if next_state == state.lie_on_ground and self.grounded == false then
			self:set_state(state.fall_from_gear)
			return
		end
		self:set_state(next_state)
		return
	end
	self:set_state(self.grounded and self:get_ground_return_state() or self:get_air_return_state())
end

local state_handlers = {}

state_handlers[state.idle] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		if self:begin_attack() then
			return
		end
	end

	if self.jump_pressed then
		self:begin_jump()
		return
	end

	if self:get_ground_movement_direction() == 0 then
		self.vx = 0
		return
	end
	self.state = state.walk
	self:apply_facing(self:get_ground_movement_direction())
end

state_handlers[state.walk] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		if self:begin_attack() then
			return
		end
	end
	if self.jump_pressed then
		self:begin_jump()
		return
	end
	local dir = self:get_ground_movement_direction()
	if dir == 0 then
		self.state = state.idle
		self.vx = 0
		return
	end
	self:apply_facing(dir)
	self.vx = dir * constants.physics.walk_speed
end

state_handlers[state.run] = state_handlers[state.walk]

state_handlers[state.jump_up] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		self:begin_attack()
		return
	end
	if self.grounded then
		self:set_state(state.land_after_jump)
		return
	end
	local dir = self:get_ground_movement_direction()
	if dir ~= 0 then
		self:apply_facing(dir)
		self.vx = dir * (constants.physics.walk_speed * 0.55)
	end
end

state_handlers[state.jump_forward_player] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		self:begin_attack()
		return
	end
	if self.grounded then
		self:set_state(state.land_after_jump)
		return
	end
	local dir = self:get_ground_movement_direction()
	if dir ~= 0 then
		self:apply_facing(dir)
		self.vx = dir * (constants.physics.walk_speed * 1.2)
	end
end

state_handlers[state.land_after_jump] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		self:begin_attack()
		return
	end
	if self.state_timer <= 0 then
		self:set_state(self:get_ground_return_state())
	end
end

state_handlers[state.fall_after_action] = function(self)
	if self.attack_cooldown == 0 and self.attack_pressed then
		self:begin_attack()
		return
	end
	if self.state_timer <= 0 and self.grounded then
		self:set_state(self:get_ground_return_state())
	end
end

state_handlers[state.death_normal] = function(self)
	self.vx = 0
	self.vy = 0
end

state_handlers[state.hit_light] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.hit_mid] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.hit_heavy] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.hit_very_heavy] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.collapsed] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.knockback_a] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.knockback_b] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.knockback_c] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.knockback_d] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.knockback_e] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.uppercut_air] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.high_jump_kick_knockdown] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.sudden_uppercut_knockdown] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.cyclone_kick_knockdown] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.fall_from_gear] = function(self)
	self:handle_hit_chain_state()
end
state_handlers[state.lie_on_ground] = function(self)
	if self.state_timer <= 0 then
		self:set_state(self:get_ground_return_state())
	end
end

state_handlers[state.punch_normal] = function(self)
	self:perform_attack()
end
state_handlers[state.kick] = state_handlers[state.punch_normal]
state_handlers[state.ninja_knife] = state_handlers[state.punch_normal]
state_handlers[state.uppercut_normal] = state_handlers[state.punch_normal]
state_handlers[state.jump_kick] = state_handlers[state.punch_normal]
state_handlers[state.uppercut_sudden] = state_handlers[state.punch_normal]
state_handlers[state.high_jump_kick] = state_handlers[state.punch_normal]
state_handlers[state.cyclone_kick] = state_handlers[state.punch_normal]
state_handlers[state.cut_up] = state_handlers[state.punch_normal]

function fighter:run_state_logic()
	local handler = state_handlers[self.state]
	if handler then
		handler(self)
	end

	if self.state == state.hit_light and self.grounded then
		self:handle_hit_chain_state()
	end

	if self.state == state.death_normal and self.health <= 0 then
		self.vx = 0
		self.vy = 0
	end
end

function fighter:apply_state_airborne_transition()
	if self.grounded and self.state == state.jump_up then
		self:set_state(state.land_after_jump)
		return
	end
	if self.grounded and self.state == state.jump_forward_player then
		self:set_state(state.land_after_jump)
		return
	end
	if not self.grounded and self.state == state.land_after_jump then
		self:set_state(self:get_air_return_state())
	end
end

function fighter:draw_hit_freeze()
	if self.hit_freeze > 0 then
		put_rectfillcolor(math.floor(self.x), math.floor(self.y - 4), math.floor(self.x + self.width), math.floor(self.y - 2), constants.z.hud, constants.palette.hurt)
	end
end

function fighter:draw_fighter()
	if self.health == 0 then
		return
	end
	if self.invuln_timer > 0 and (self.invuln_timer % 4) > 1 then
		return
	end

	local color = self.role == role_player and constants.palette.player or constants.palette.enemy
	if self.state == state.hit_light or self.state == state.hit_mid or self.state == state.hit_heavy or self.state == state.hit_very_heavy or self.state == state.collapsed or self.state == state.knockback_a or self.state == state.knockback_b or self.state == state.knockback_c or self.state == state.knockback_d or self.state == state.knockback_e or self.state == state.uppercut_air or self.state == state.high_jump_kick_knockdown or self.state == state.sudden_uppercut_knockdown or self.state == state.cyclone_kick_knockdown or self.state == state.fall_from_gear then
		color = constants.palette.hurt
	end

	local x1 = math.floor(self.x)
	local y1 = math.floor(self.y)
	local x2 = math.floor(self.x + self.width)
	local y2 = math.floor(self.y + self.height)
	put_rectfillcolor(x1, y1, x2, y2, constants.z.fighter, color)

	if self.state == state.punch_normal or self.state == state.kick or self.state == state.jump_kick or self.state == state.uppercut_normal or self.state == state.cyclone_kick or self.state == state.uppercut_sudden then
		local range = constants.attack.range_x
		if self.facing == 1 then
			put_rectfillcolor(x2, y1 + 6, x2 + range, y1 + 10, constants.z.fighter + 1, constants.palette.metal)
		else
			put_rectfillcolor(x1 - range, y1 + 6, x1, y1 + 10, constants.z.fighter + 1, constants.palette.metal)
		end
	end
end

function fighter:draw()
	self:draw_fighter()
	if self.health > 0 then
		self:draw_hit_freeze()
	end
end

function fighter:tick()
	self.step = self.step + 1
	if self.state == state.defeat then
		return
	end

	if self.hit_freeze > 0 then
		self:progress_timers()
		return
	end

	self:sample_input()
	self:run_state_logic()
	self:apply_horizontal()
	self:move()
	self:clamp_to_arena()
	self:apply_state_airborne_transition()
	self:progress_timers()
end

local function define_fighter_fsm()
	define_fsm(constants.ids.fighter_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_fighter_definition()
	define_prefab({
		def_id = constants.ids.fighter_def,
		class = fighter,
		fsms = { constants.ids.fighter_fsm },
		components = { 'customvisualcomponent' },
		defaults = {
			role = role_player,
			target_id = constants.ids.enemy_instance,
			facing = 1,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,
			width = constants.player.width,
			height = constants.player.height,
			x = constants.player.start_x,
			y = constants.player.start_y,
			state = state.idle,
			health = constants.player.max_health,
			max_health = constants.player.max_health,
			left_held = false,
			right_held = false,
			jump_held = false,
			attack_a_pressed = false,
			attack_b_pressed = false,
			attack_pressed = false,
			attack_timer = 0,
			attack_cooldown = 0,
			attack_hit_frame = 0,
			attack_hit_registered = false,
			attack_return_state = state.idle,
			state_timer = state_timing[state.idle] or 0,
			grounded = true,
			step = 0,
			vx = 0,
			vy = 0,
			hurt_timer = 0,
			hit_freeze = 0,
			invuln_timer = 0,
			attack_profile = nil,
		},
	})
end

return {
	fighter = fighter,
	define_fighter_fsm = define_fighter_fsm,
	register_fighter_definition = register_fighter_definition,
	fighter_def_id = constants.ids.fighter_def,
	player_instance_id = constants.ids.player_instance,
	enemy_instance_id = constants.ids.enemy_instance,
	player_role = role_player,
	enemy_role = role_enemy,
}
