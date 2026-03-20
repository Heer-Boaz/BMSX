-- player.lua
-- player character FSM, physics, and presentation.
--
-- ARCHITECTURE OVERVIEW
--
-- 1. FLAT STATES + CONCURRENT SWORD REGION.
--    The player FSM is flat by design — all movement/damage states live at the
--    same level (quiet, walking_right, jumping, hit_fall, freeze, …).  Walking
--    and jumping are separate states, not substates of a "moving" compound,
--    because each has distinct collision/input rules and shares no common
--    entering_state/exiting_state logic.
--
--    The sword is an orthogonal concern: you can swing your sword in any
--    movement state.  A concurrent region (`states.sword`) with two states
--    (inactive / active) runs in parallel with the main movement state.
--    This avoids doubling the state count with "quiet_with_sword" etc.
--
-- 2. TAG DERIVATIONS — REPLACING BOOLEAN CHECKS.
--    Instead of `if state == 'quiet' or state == 'walking_right' or …`, the
--    FSM uses tag derivations.  Each state declares its own tag (e.g.
--    `v.q` for quiet).  Tag derivation rules at the FSM root combine these
--    into group tags (e.g. `g.mw` = movement_walk, `g.st` = stairs).
--
--    Operators:
--      SIMPLE ARRAY (any-of):  [tag1, tag2, tag3] — derived tag is true when
--        ANY listed source tag is active.
--      { all = [...] }:  derived tag is true when ALL listed tags are active.
--      { any = [...], all = [...] }:  all + at least one of any.
--      { none = [...] }:  derived tag is true when NONE of the listed tags
--        are active (NOT operator).
--
--    Derivations can chain: a derivation can reference another derived tag.
--    The runtime resolves them in a fixed-point loop.
--
--    VISUAL SWORD TAGS use compound derivations to express "sword is active
--    AND player is in a specific movement context":
--      vis.js (jump_sword)   = { all = { g.sw }, any = { v.j, v.sj, v.cf, v.uf } }
--      vis.gs (ground_sword) = { all = { g.sw, v.q } }
--      vis.ss (stairs_sword) = { all = { g.sw, v.qst } }
--    These are used by apply_presentation_state() to pick the correct sprite.
--
-- 3. STATE_TAGS TABLE — SHORT STRING IDS.
--    Tag strings are intentionally short (v.q, g.mw, vis.js) to minimize
--    per-frame string comparison cost and memory.  The state_tags table maps
--    human-readable names to these short IDs so code remains readable.
--    Categories: variant (per-state), group (derived unions), visual
--    (compound derived tags for sprite selection).
--
-- 4. FREEZE / UNFREEZE VIA SEAL_DISSOLUTION.
--    When the director emits 'seal_dissolution', the player's root FSM `on`
--    handler transitions to /freeze (which cancels any active sword).
--    On 'seal_flash_done', freeze does `pop_and_transition()` to restore
--    the previous state from the FSM history stack.  This pattern is shared
--    with pepernoot_projectile.
--
-- 5. wrap_state_update() — COMMON FRAME LOGIC.
--    Every state's update handler is wrapped by wrap_state_update(), which
--    runs common-frame housekeeping (collision state, room switches, hit
--    overlap, presentation, invulnerability) after the state-specific logic.
--    input_event_handlers are also attached to every state via the loop.
--
-- 6. NO bind() — EVENTS VIA FSM `on` BLOCK.
--    The player does not have a bind() function.  All event subscriptions are
--    declared in the FSM definition's root `on` block with emitter filters
--    (e.g. `{ emitter = 'd', go = … }` for director-sourced events).  This
--    keeps the event wiring co-located with the FSM structure.
--
-- 7. REQUEST/REPLY — DIRECTOR-INITIATED INTERACTIONS.
--    Several director events use the request pattern:
--      'player.world_emerge'        — director requests emergence animation.
--      'player.shrine_overlay_exit' — director requests shrine exit.
--      'player.halo_trigger'        — director requests halo teleport.
--    The player handles these in its root `on` block, performs the action,
--    and (for shrine exit) emits a reply event ('shrine_exit_done') when the
--    exit animation timeline completes.

local constants = require('constants')
local castle_map = require('castle_map')
local components = require('components')
local collision2d = require('collision2d')
local player_abilities = require('player_abilities')

local player = {}
player.__index = player

-- STATE_TAGS — short string tag identifiers.
-- variant: one per FSM state, exactly one active at a time (excluding the
--   concurrent sword region).
-- group: derived tags; true when ANY of their source variant tags is active.
--   Used by has_tag() queries in update/collision code instead of multi-state
--   equality checks.
-- visual: compound derived tags combining group + variant, used exclusively
--   by apply_presentation_state() for sprite selection.
local state_tags = {
	variant = {
		quiet = 'v.q',
		walking_right = 'v.wr',
		walking_left = 'v.wl',
		jumping = 'v.j',
		stopped_jumping = 'v.sj',
		controlled_fall = 'v.cf',
		uncontrolled_fall = 'v.uf',
		up_stairs = 'v.us',
		down_stairs = 'v.ds',
		quiet_stairs = 'v.qst',
		entering_world = 'v.ew',
		waiting_world_banner = 'v.wwb',
		waiting_halo_banner = 'v.whb',
		waiting_world_emerge = 'v.wwe',
		emerging_world = 'v.ewd',
		slowdoorpass = 'v.sdp',
		entering_shrine = 'v.es',
		waiting_shrine = 'v.ws',
		leaving_shrine = 'v.ls',
		hit_fall = 'v.hf',
		hit_collision = 'v.hc',
		hit_recovery = 'v.hr',
		dying = 'v.d',
	},
	group = {
		stairs = 'g.st',
		sword = 'g.sw',
		sword_activation_allowed = player_abilities.tags.sword_activation_allowed,
		stairs_action_allowed = player_abilities.tags.stairs_action_allowed,
		damage_lock = 'g.dl',
		elevator_transport = 'g.et',
		transition_lock = 'g.tr',
		damage_visual = 'g.dv',
		movement_walk = 'g.mw',
		movement_jump = 'g.mj',
		hit_blink = 'g.hb',
		player_stairs = 'g.ps',
		world_transition_waiting = 'g.wtw',
		world_transition = 'g.wt',
		world_transition_down = 'g.wtd',
		can_switch_up = 'g.csu',
		hit_lock_states = 'g.hls',
	},
	visual = {
		jump_sword = 'vis.js',
		ground_sword = 'vis.gs',
		stairs_sword = 'vis.ss',
	},
}

player_abilities.attach_player_methods(player)

local player_hit_fall_frames = {
	{ imgid = 'pietolon_hit_r' },
}
local player_sword_end_event = 'sword.end'
local player_shrine_exit_timeline_id = 'p.tl.sx'
local hit_blink_colorize = { r = 1, g = 0.35, b = 0.35, a = 1 }
local vertical_exit_directions = {
	up = true,
	down = true,
}
local stairs_landing_events = {
	stairs_end_top = true,
	stairs_end_bottom = true,
	stairs_step_off_left = true,
	stairs_step_off_right = true,
}
local stairs_vertical_exit_events = {
	stairs_end_top = true,
	stairs_end_bottom = true,
}

local function build_shrine_exit_transition_frames()
	local frames = {}
	for transition_step = constants.world_entrance.enter_world_midpoint_step, constants.world_entrance.enter_world_total_steps do
		local phase
		if constants.world_entrance.enter_leave_cycle_steps <= 0 then
			phase = 0
		else
			phase = transition_step % constants.world_entrance.enter_leave_cycle_steps
		end
		frames[#frames + 1] = {
			transition_step = transition_step,
			enter_leave_anim_frame = phase < 4 and 0 or 1,
			to_enter_cut = transition_step - constants.world_entrance.enter_world_total_steps,
		}
	end
	return frames
end

function player:clear_input_state()
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.attack_held = false
	self.up_input_sources = 0
end

function player:sync_input_state_from_runtime()
	self.left_held = action_triggered('left[p]')
	self.right_held = action_triggered('right[p]')
	self.down_held = action_triggered('down[p]')
	self.attack_held = action_triggered('x[p]')
	local up_primary_held = action_triggered('up[p]')
	local up_alt_held = action_triggered('a[p]')
	local up_sources = 0
	if up_primary_held then
		up_sources = up_sources + 1
	end
	if up_alt_held then
		up_sources = up_sources + 1
	end
	self.up_input_sources = up_sources
	self.up_held = up_sources > 0
end

function player:on_up_input_pressed()
	self.up_input_sources = self.up_input_sources + 1
	self.up_held = self.up_input_sources > 0
end

function player:on_up_input_released()
	self.up_input_sources = clamp_int(self.up_input_sources - 1, 0, 2)
	self.up_held = self.up_input_sources > 0
end

function player:zero_motion()
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = 0
end

function player:reset_stairs_lock()
	self.stairs_direction = 0
	self.stairs_x = -1
	self.hit_stairs_lock = false
end

function player:apply_spawn_position(switch)
	self.x = switch.spawn_x
	self.y = switch.spawn_y
	self.facing = switch.spawn_facing
end

function player:emit_room_switched(from_room, to_room, direction)
	self.events:emit('room.switched', {
		from = from_room,
		to = to_room,
		dir = direction,
		x = self.x,
		y = self.y,
	})
end

function player:land_from_hit()
	self:snap_feet_y_to_floor_grid()
	self.events:emit('fall')
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self.last_dx = 0
	self.last_dy = 0
	self.events:emit('hit_ground')
end

function player:update_collision_state()
	self.collider.enabled = true
	self.sword_collider.enabled = self:has_tag(state_tags.group.sword)
	self.left_wall_collision_primary = self:collides_at_left_wall_primary_profile(self.x, self.y, false)
	self.left_wall_collision_secondary = self:collides_at_left_wall_secondary_profile(self.x, self.y, false)
	self.left_wall_collision = self.left_wall_collision_primary or self.left_wall_collision_secondary
	self.right_wall_collision = self:collides_at_right_wall_profile(self.x, self.y, false)
end

function player:apply_colorize(r, g, b, a)
	self.sprite_component.colorize.r = r
	self.sprite_component.colorize.g = g
	self.sprite_component.colorize.b = b
	self.sprite_component.colorize.a = a
	self.sword_sprite.colorize.r = r
	self.sword_sprite.colorize.g = g
	self.sword_sprite.colorize.b = b
	self.sword_sprite.colorize.a = a
end

function player:define_runtime_timelines()
	self:define_timeline(timeline.new({
		id = 'p.tl.d',
		frames = timeline.build_frame_sequence({
			{ value = { imgid = 'pietolon_dying_1' }, hold = 8 },
			{ value = { imgid = 'pietolon_dying_2' }, hold = 8 },
			{ value = { imgid = 'pietolon_dying_3' }, hold = 8 },
			{ value = { imgid = 'pietolon_dying_4' }, hold = 8 },
			{ value = { imgid = 'pietolon_dying_5' }, hold = 8 },
		}),
		playback_mode = 'once',
	}))
	self:define_timeline(timeline.new({
		id = 'p.tl.hf',
		frames = player_hit_fall_frames,
		playback_mode = 'once',
	}))
	self:define_timeline(timeline.new({
		id = 'p.tl.hr',
		frames = timeline.build_frame_sequence({
			{ value = { imgid = 'pietolon_recover_r' }, hold = constants.damage.hit_recovery_frames },
		}),
		playback_mode = 'once',
	}))
	self:define_timeline(timeline.new({
		id = 'p.seq.s',
		frames = timeline.range(constants.sword.duration_frames + 1),
		playback_mode = 'once',
		autotick = false,
		markers = {
			{ frame = 1, event = 'sword.slice' },
		},
	}))
	self:define_timeline(timeline.new({
		id = 'p.seq.hi',
		frames = timeline.range(constants.damage.hit_invulnerability_frames),
		playback_mode = 'once',
		autotick = false,
	}))
	self:define_timeline(timeline.new({
		id = 'p.seq.hb',
		frames = timeline.range(constants.damage.hit_blink_switch_frames),
		playback_mode = 'loop',
		autotick = false,
	}))
	self:define_timeline(timeline.new({
		id = 'p.seq.f',
		frames = timeline.range(12),
		playback_mode = 'once',
		autotick = false,
	}))
	self:define_timeline(timeline.new({
		id = player_shrine_exit_timeline_id,
		frames = build_shrine_exit_transition_frames(),
		playback_mode = 'once',
		apply = true,
	}))
end

function player:ctor()
	self:add_component(components.new_component('actioneffectcomponent', {}))
	self.actioneffects:grant_effect('halo')
	self.actioneffects:grant_effect('pepernoot')
	self.actioneffects:grant_effect('spyglass')
	self:add_component(components.inputactioneffectcomponent.new({
		program = player_abilities.build_input_action_effect_program(),
	}))
	self:gfx('pietolon_stand_r')
	self.width = constants.player.width
	self.height = constants.player.height
	self.collider.id_local = 'body'
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('player')

	self.sword_collider = components.collider2dcomponent.new({
		id_local = 'sword',
		spaceevents = 'current',
	})
	self.sword_collider:apply_collision_profile('projectile')
	self.sword_collider.enabled = false
	self:add_component(self.sword_collider)

	self.sword_sprite = components.spritecomponent.new({
		id_local = 'sword',
		imgid = 'sword_r',
		offset = { x = 0, y = 0, z = 111 },
		collider_local_id = 'sword',
	})
	self:add_component(self.sword_sprite)
	self.sword_sprite.enabled = false
	self:define_runtime_timelines()
	self.inventory_items = {}
	self.secondary_weapon = nil
	self:equip_subweapon(self.secondary_weapon)
	self.weapon_level = 0
	self:apply_presentation_state()
	self:update_collision_state()
	self:force_seek_timeline('p.seq.s', 0)
	self:reset_hit_invulnerability_sequence()
	self:reset_fall_substate_sequence()
	self:clear_input_state()
	self:sync_input_state_from_runtime()

	self.sprite_component.scale.x = 1
	self.sprite_component.scale.y = 1
	self.sprite_component.offset.x = 0
	self.sprite_component.offset.z = 110

end

function player:get_damage_state_imgid()
	if self:has_tag(state_tags.group.damage_visual) then
		if self:has_tag(state_tags.variant.dying) then
			local dying_timeline = self:get_timeline('p.tl.d')
			dying_timeline:force_seek(self.death_timer)
			return dying_timeline:value().imgid
		end

		if self:has_tag(state_tags.variant.hit_recovery) then
			local hit_recovery_timeline = self:get_timeline('p.tl.hr')
			hit_recovery_timeline:force_seek(self.hit_recovery_timer)
			return hit_recovery_timeline:value().imgid
		end

		local hit_fall_timeline = self:get_timeline('p.tl.hf')
		hit_fall_timeline:force_seek(self.hit_substate)
		return hit_fall_timeline:value().imgid
	end
	return nil
end

function player:apply_presentation_state()
	if self:has_tag(state_tags.group.world_transition_waiting) then
		self:apply_colorize(1, 1, 1, 1)
		self.visible = false
		return
	end

	if self:has_tag(state_tags.group.world_transition) then
		self:apply_colorize(1, 1, 1, 1)
		local imgid
		if self:has_tag(state_tags.group.world_transition_down) then
			if self.enter_leave_anim_frame == 0 then
				imgid = 'pietolon_stairs_down_1'
			else
				imgid = 'pietolon_stairs_down_2'
			end
		else
			if self.enter_leave_anim_frame == 0 then
				imgid = 'pietolon_stairs_up_1'
			else
				imgid = 'pietolon_stairs_up_2'
			end
		end
		self.sword_sprite.enabled = false
		self:gfx(imgid)
		self.sprite_component.flip.flip_h = self.facing < 0
		self.sprite_component.offset.y = self.to_enter_cut
		self.visible = true
		return
	end
	self.sprite_component.offset.y = 0 -- Reset any stair cut offset when not in a world transition, to avoid visual bugs with exiting the shrine or similar effects that modify y offset (!= position!). UGLY DIRTY SHIT!!!!! BUT CODEX IS UNABLE TO WRITE PROPER CODE AND THUS HAVE TO FIX THIS MYSELF
	if self.hit_invulnerability_timer > 0 and self.hit_blink_on and not self:has_tag(state_tags.variant.dying) then
		self:apply_colorize(hit_blink_colorize.r, hit_blink_colorize.g, hit_blink_colorize.b, hit_blink_colorize.a)
	else
		self:apply_colorize(1, 1, 1, 1)
	end
	self.visible = true
	self.sprite_component.scale.x = 1
	self.sprite_component.scale.y = 1

	local damage_sprite_id = self:get_damage_state_imgid()

	local imgid
	local flip_h = self.facing < 0

	if self:has_tag(state_tags.group.damage_visual) then
		imgid = damage_sprite_id
	elseif self:has_tag(state_tags.variant.up_stairs) then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_up_1'
		else
			imgid = 'pietolon_stairs_up_2'
		end
	elseif self:has_tag(state_tags.variant.down_stairs) then
		if self.stairs_anim_frame == 0 then
			imgid = 'pietolon_stairs_down_1'
		else
			imgid = 'pietolon_stairs_down_2'
		end
	elseif self:has_tag(state_tags.group.movement_walk) then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	elseif self:has_tag(state_tags.group.movement_jump) then
		imgid = 'pietolon_jump_r'
	elseif self:has_tag(state_tags.variant.uncontrolled_fall) then
		if self.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	else
		imgid = 'pietolon_stand_r'
	end
	if self:has_tag(state_tags.visual.jump_sword) then
		imgid = 'pietolon_jumpslash_r'
		if flip_h then
			self.sprite_component.offset.x = constants.sword.jump_body_offset_left
			self.sword_sprite.offset.x = constants.sword.jump_offset_left
		else
			self.sprite_component.offset.x = constants.sword.jump_body_offset_right
			self.sword_sprite.offset.x = constants.sword.jump_offset_right
		end
		self.sword_sprite.offset.y = constants.sword.jump_offset_y
	elseif self:has_tag(state_tags.visual.ground_sword) then
		imgid = 'pietolon_slash_r'
		if flip_h then
			self.sprite_component.offset.x = constants.sword.ground_body_offset_left
			self.sword_sprite.offset.x = constants.sword.ground_offset_left
		else
			self.sprite_component.offset.x = constants.sword.ground_body_offset_right
			self.sword_sprite.offset.x = constants.sword.ground_offset_right
		end
		self.sword_sprite.offset.y = constants.sword.ground_offset_y
	elseif self:has_tag(state_tags.visual.stairs_sword) then
		imgid = 'pietolon_slash_r'
		if flip_h then
			self.sprite_component.offset.x = constants.sword.stairs_body_offset_left
			self.sword_sprite.offset.x = constants.sword.stairs_offset_left
		else
			self.sprite_component.offset.x = constants.sword.stairs_body_offset_right
			self.sword_sprite.offset.x = constants.sword.stairs_offset_right
		end
		self.sword_sprite.offset.y = constants.sword.stairs_offset_y
	elseif self:has_tag(state_tags.group.player_stairs) then
		flip_h = false
		self.sprite_component.offset.x = 0
	else
		self.sprite_component.offset.x = 0
	end

	self:gfx(imgid)
	self.sprite_component.flip.flip_h = flip_h
	self.sword_sprite.enabled = self:has_tag(state_tags.group.sword)
	self.sword_sprite.flip.flip_h = flip_h
end

function player:respawn()
	object('d').events:emit('death_done')
	self:cancel_sword()
	self:reset_hit_invulnerability_sequence()
	self:reset_fall_substate_sequence()
	self.events:emit('respawn')
end

function player:update_facing_from_horizontal_input()
	if self.left_held and not self.right_held then
		self.facing = -1
		return
	end
	if self.right_held and not self.left_held then
		self.facing = 1
	end
end

function player:cancel_sword()
	self:force_seek_timeline('p.seq.s', 0)
	self.events:emit('sword_cancel')
end

function player:try_hit_rock_with_sword()
	local room = object('room')
	local area = self.sword_collider:get_world_area()
	local rock_def = room:find_active_rock_overlapping_rect(
		area.left,
		area.top,
		area.right - area.left,
		area.bottom - area.top
	)
	if rock_def == nil then
		return
	end
	object(rock_def.id):process_weapon_hit(self.id, 'sword')
end

function player:advance_sword_sequence()
	local sword_sequence = self:get_timeline('p.seq.s')
	if sword_sequence:value() >= constants.sword.duration_frames then
		self.sword_cooldown = 1
		self.events:emit(player_sword_end_event)
		return
	end
	self:advance_timeline('p.seq.s')
end

function player:is_hittable()
	if self.hit_invulnerability_timer > 0 then
		return false
	end
	return not self:has_tag(state_tags.group.damage_lock)
end

function player:update_hit_invulnerability()
	if self.hit_invulnerability_timer == 0 then
		return
	end

	local hit_invulnerability_sequence = self:get_timeline('p.seq.hi')
	hit_invulnerability_sequence:advance()
	self.hit_invulnerability_timer = constants.damage.hit_invulnerability_frames - (hit_invulnerability_sequence:value() + 1)

	local hit_blink_sequence = self:get_timeline('p.seq.hb')
	local hit_blink_events = hit_blink_sequence:advance()
	for i = 1, #hit_blink_events do
		if hit_blink_events[i].kind == 'end' then
			self.hit_blink_on = not self.hit_blink_on
		end
	end
	if self.hit_invulnerability_timer == 0 then
		self.hit_blink_on = false
	end
end

function player:reset_hit_invulnerability_sequence()
	self.hit_invulnerability_timer = 0
	self.hit_blink_on = false
	self:get_timeline('p.seq.hi'):rewind()
	self:get_timeline('p.seq.hb'):rewind()
end

function player:start_hit_invulnerability_sequence()
	self.hit_invulnerability_timer = constants.damage.hit_invulnerability_frames
	self.hit_blink_on = true
	self:get_timeline('p.seq.hi'):rewind()
	self:get_timeline('p.seq.hb'):force_seek(0)
end

function player:get_hit_direction_from_source(source_x)
	local center_x = self.x + math.modf(self.width / 2)
	if source_x < center_x then
		return 1
	end
	if source_x > center_x then
		return -1
	end
	if self.facing > 0 then
		return -1
	end
	return 1
end

function player:start_dying()
	if self:has_tag(state_tags.variant.dying) then
		return
	end
	self:cancel_sword()
	self.hit_direction = 0
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self.death_timer = 0
	self.hit_stairs_lock = false
	self:reset_hit_invulnerability_sequence()
	self:zero_motion()
	self.events:emit('dying')
end

function player:emit_health_changed()
	self.events:emit('player.health_changed', {
		value = self.health,
		max_value = self.max_health,
	})
end

function player:emit_weapon_changed()
	self.events:emit('player.weapon_changed', {
		value = self.weapon_level,
		max_value = constants.hud.weapon_level,
	})
end

function player:take_hit(amount, source_x, source_y, reason)
	if not self:is_hittable() then
		return false
	end

	self.health = self.health - amount
	if self.health < 0 then
		self.health = 0
	end
	self:emit_health_changed()
	if self.health <= 8 then
		self.events:emit('approachingdeath')
	else
		self.events:emit('hit')
	end

	local hit_on_stairs = self:has_tag(state_tags.group.stairs)
	local hit_direction
	local damage_event
	if hit_on_stairs then
		hit_direction = 0
		damage_event = 'damage_on_stairs'
	else
		hit_direction = self:get_hit_direction_from_source(source_x)
		damage_event = 'damage'
	end

	self:cancel_sword()
	self.hit_stairs_lock = hit_on_stairs
	self.hit_direction = hit_direction
	self.hit_substate = 0
	self.hit_recovery_timer = 0
	self:start_hit_invulnerability_sequence()

	if hit_direction ~= 0 then
		self.facing = -hit_direction
	end

	self.events:emit(damage_event, { reason = reason })
	return true
end

function player:collect_loot(loot_type, loot_value)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if loot_type == 'life' then
		self.health = self.health + loot_value
		if self.health > self.max_health then
			self.health = self.max_health
		end
		self:emit_health_changed()
		return true
	end
	if loot_type == 'ammo' then
		self.weapon_level = self.weapon_level + loot_value
		if self.weapon_level > constants.hud.weapon_level then
			self.weapon_level = constants.hud.weapon_level
		end
		self:emit_weapon_changed()
		return true
	end
	error('pietious player invalid loot_type=' .. tostring(loot_type))
end

function player:find_near_shrine()
	local shrines = object('room').shrines
	local player_left = self.x
	local player_top = self.y
	local player_right = self.x + self.width
	local player_bottom = self.y + self.height

	for i = 1, #shrines do
		local shrine = shrines[i]
		local area_left = shrine.x + constants.shrine.hit_left_px
		local area_top = shrine.y + constants.shrine.hit_top_px
		local area_right = shrine.x + constants.shrine.hit_right_px
		local area_bottom = shrine.y + constants.shrine.hit_bottom_px
		if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
			return shrine
		end
	end

	return nil
end

function player:find_world_entrance_for_unlock()
	local world_entrances = object('room').world_entrances
	local castle = object('c')
	for i = 1, #world_entrances do
		local world_entrance = world_entrances[i]
		local entrance_state = castle.world_entrance_states[world_entrance.target].state
		if entrance_state == 'closed' then
			local within_x = self.x >= world_entrance.x and self.x <= (world_entrance.x + constants.room.tile_size2)
			local on_trigger_y = self.y == world_entrance.stair_y
			if within_x and on_trigger_y then
				return world_entrance
			end
		end
	end

	return nil
end

function player:find_near_open_world_entrance()
	local world_entrances = object('room').world_entrances
	local castle = object('c')
	for i = 1, #world_entrances do
		local world_entrance = world_entrances[i]
		local entrance_state = castle.world_entrance_states[world_entrance.target].state
		if entrance_state == 'open' then
			local within_x = self.x >= (world_entrance.stair_x - constants.world_entrance.trigger_half_width)
			and self.x <= (world_entrance.stair_x + constants.world_entrance.trigger_half_width)
			local on_trigger_y = self.y == world_entrance.stair_y
			if within_x and on_trigger_y then
				return world_entrance
			end
		end
	end

	return nil
end

function player:reset_enter_leave_animation()
	self.transition_step = 0
	self.enter_leave_anim_frame = 0
	self.to_enter_cut = 0
end

function player:update_enter_leave_anim_frame()
	if self.transition_step <= 0 then
		self.enter_leave_anim_frame = 0
		return
	end
	local phase = (self.transition_step - 1) % 8
	if phase < 4 then
		self.enter_leave_anim_frame = 0
	else
		self.enter_leave_anim_frame = 1
	end
end

function player:update_enter_leave_cut(direction)
	local transition_step = self.transition_step

	if transition_step <= 0 then
		self.to_enter_cut = 0
		return
	end
	if transition_step > constants.world_entrance.enter_world_total_steps then
		self.to_enter_cut = 0
		return
	end

	local phase_step
	if transition_step <= constants.world_entrance.enter_world_midpoint_step then
		phase_step = transition_step
	else
		phase_step = constants.world_entrance.enter_world_total_steps - transition_step
	end

	if direction < 0 then
		self.to_enter_cut = -phase_step
		return
	end
	self.to_enter_cut = phase_step
end

function player:begin_entering_world(world_entrance)
	self:cancel_sword()
	self:clear_input_state()
	self:reset_stairs_lock()
	self.enter_leave_world_target = world_entrance.target
	self.enter_leave_shrine_text_lines = {}
	self.x = world_entrance.stair_x
	self:reset_enter_leave_animation()
	self.events:emit('enter_world_start')
end

function player:begin_entering_shrine(shrine)
	self:cancel_sword()
	self:clear_input_state()
	self:reset_stairs_lock()
	self.enter_leave_world_target = nil
	self.enter_leave_shrine_text_lines = shrine.text_lines
	self.x = shrine.x
	self:reset_enter_leave_animation()
	self.events:emit('enter_shrine_start')
end

function player:begin_world_emerge_from_door_midpoint()
	self:cancel_sword()
	self:clear_input_state()
	self.transition_step = constants.world_entrance.enter_world_midpoint_step
	self:update_enter_leave_anim_frame()
	self.to_enter_cut = constants.world_entrance.enter_world_midpoint_step
	self.enter_leave_world_target = nil
	self.enter_leave_shrine_text_lines = {}
	self.events:emit('world_emerge_start')
end

function player:complete_enter_world_after_banner()
	local switch = object('c'):enter_world(self.enter_leave_world_target)
	self:apply_spawn_position(switch)
	self:zero_motion()
	self:reset_stairs_lock()
	self:reset_enter_leave_animation()
	self.enter_leave_world_target = nil
	self.enter_leave_shrine_text_lines = {}
	self:emit_room_switched(switch.from_room_number, switch.to_room_number, 'world_enter')
end

function player:start_slow_doorpass()
	self:cancel_sword()
	self.slow_doorpass_substate = 0
	self.events:emit('slowdoorpass_start')
end

function player:apply_halo_teleport_arrival(switch)
	self:apply_spawn_position(switch)
	self:zero_motion()
	self:reset_stairs_lock()
	self:reset_enter_leave_animation()
	self.enter_leave_world_target = nil
	self.enter_leave_shrine_text_lines = {}
	self:cancel_sword()
	self:reset_fall_substate_sequence()
	self.events:emit('stairs_lock_lost_after_room_switch')
	self:emit_room_switched(switch.from_room_number, switch.to_room_number, switch.direction)
end

function player:begin_waiting_halo_banner()
	self:cancel_sword()
	self:clear_input_state()
	self:zero_motion()
	self:reset_stairs_lock()
	self:reset_enter_leave_animation()
	self.enter_leave_world_target = nil
	self.enter_leave_shrine_text_lines = {}
	self:reset_fall_substate_sequence()
	self.events:emit('halo_wait_start')
end

function player:complete_halo_return_after_banner()
	local switch = object('room').last_room_switch
	self:apply_halo_teleport_arrival(switch)
end

function player:leave_shrine_overlay()
	self:reset_enter_leave_animation()
	self.enter_leave_shrine_text_lines = {}
	self.events:emit('leave_shrine_overlay')
end

function player:try_open_world_entrance_with_key()
	if not self.inventory_items.keyworld1 then
		return false
	end

	local world_entrance = self:find_world_entrance_for_unlock()
	if world_entrance == nil then
		return false
	end

	local opened = object('c'):begin_open_world_entrance(world_entrance.target)
	if not opened then
		return false
	end
	self.inventory_items.keyworld1 = false
	self.events:emit('worlddooropen')
	return true
end

function player:try_start_world_or_shrine_interaction_from_down()
	if not action_triggered('down[jp]') then
		return false
	end

	local world_entrance = self:find_near_open_world_entrance()
	if world_entrance ~= nil then
		self:begin_entering_world(world_entrance)
		return true
	end

	local shrine = self:find_near_shrine()
	if shrine ~= nil then
		self:begin_entering_shrine(shrine)
		return true
	end

	local castle = object('c')
	if castle:has_tag('c.seal.active') then
		if castle:has_tag('c.seal.sequence') then
			return false
		end
		object('d').events:emit('seal_dissolution_start')
		return true
	end

	return false
end

function player:get_walk_dx()
	if self.water_state ~= constants.water.none then
		local walk_dx, next_accum = consume_axis_accum(self.walk_speed_accum, 1, 2)
		self.walk_speed_accum = next_accum
		return walk_dx
	end
	if self.inventory_items['schoentjes'] then
		self.walk_speed_accum = self.walk_speed_accum + constants.physics.walk_dx_schoentjes_num
		local walk_dx = math.modf(self.walk_speed_accum / constants.physics.walk_dx_schoentjes_den)
		self.walk_speed_accum = self.walk_speed_accum - (walk_dx * constants.physics.walk_dx_schoentjes_den)
		return walk_dx
	end
	self.walk_speed_accum = 0
	return constants.physics.walk_dx
end

function player:update_water_state()
	self.previous_water_state = self.water_state
	local water_kind = object('room'):player_water_kind_at_world(self.x + constants.room.tile_half, self.y + self.height)
	self.water_state = water_kind
	if self.previous_water_state ~= self.water_state then
		self.events:emit('water_transition', {
			previous_state = self.previous_water_state,
			water_state = self.water_state,
		})
		return true
	end
	return false
end

function player:reset_vertical_motion_for_jump()
	self.vertical_motion_substate = 0
	self.vertical_motion_tick = 0
	self.vertical_motion_dy_accum = 0
end

function player:reset_vertical_motion_for_fall()
	self.vertical_motion_substate = constants.physics.aphrodite_water_fall_start_substate
	self.vertical_motion_tick = 0
	self.vertical_motion_dy_accum = 0
end

function player:advance_aphrodite_water_vertical_motion()
	self.vertical_motion_tick = self.vertical_motion_tick + 1
	if (self.vertical_motion_tick % constants.physics.aphrodite_water_vertical_tick_period) ~= 0 then
		return false
	end
	if self.vertical_motion_substate < constants.physics.aphrodite_water_vertical_substate_cap then
		self.vertical_motion_substate = self.vertical_motion_substate + 1
	end
	return true
end

function player:consume_aphrodite_water_vertical_dy()
	if self.vertical_motion_substate == 0 then
		return 0
	end
	local dy, next_accum = consume_axis_accum(
		self.vertical_motion_dy_accum,
		constants.physics.aphrodite_water_vertical_dy_by_substate[self.vertical_motion_substate - 1],
		constants.physics.aphrodite_water_vertical_scale_den
	)
	self.vertical_motion_dy_accum = next_accum
	return dy
end

function player:consume_water_controlled_fall_dx(dx)
	if self.water_state == constants.water.none then
		self.water_controlled_fall_dx_accum = 0
		return dx
	end
	local scaled_dx, next_accum = consume_axis_accum(self.water_controlled_fall_dx_accum, dx, 4)
	self.water_controlled_fall_dx_accum = next_accum
	return scaled_dx
end

function player:consume_water_jump_dx(dx)
	if self.water_state == constants.water.none then
		self.water_jump_dx_accum = 0
		return dx
	end
	local scaled_dx, next_accum = consume_axis_accum(self.water_jump_dx_accum, dx, 4)
	self.water_jump_dx_accum = next_accum
	return scaled_dx
end

function player:try_switch_room(direction, keep_stairs_lock)
	if self:has_tag(state_tags.variant.dying) then
		return false
	end
	if object('c'):is_current_room_boss_encounter_active() then
		return false
	end
	if keep_stairs_lock then
		self.x = self.stairs_x
	end

	local switch = object('c'):switch_room(direction, self.y, self.y + self.height)
	if switch.outside then
		local director = object('d')
		director.events:emit('world_leave_transition_start')
		local leave_switch = object('c'):leave_world_to_castle(false)
		self:apply_spawn_position(leave_switch)
		self:zero_motion()
		self:reset_stairs_lock()
		self:cancel_sword()
		self:sync_input_state_from_runtime() -- To avoid input buffering during the transition. THIS IS EXTREMELY UGLY AND SHOULD BE FIXED PROPERLY IN THE FUTURE, BUT CODEX IS UNABLE TO WRITE PROPER CODE AND THUS HAVE TO FIX THIS MYSELF
		self.enter_leave_world_target = nil
		self.enter_leave_shrine_text_lines = {}
		self.events:emit('leave_world_start')
		self:emit_room_switched(leave_switch.from_room_number, leave_switch.to_room_number, leave_switch.direction)
		return true
	end
	local room = object('room')
	if direction == 'left' then
		self.x = room.world_width - self.width
	elseif direction == 'right' then
		self.x = room.tile_size
	elseif direction == 'up' then
		self.y = room.world_height - self.height - room.tile_size
	else
		self.y = room.world_top - room.tile_size
	end

	if keep_stairs_lock then
		self.x = self.stairs_x
	end

	self.last_dx = 0
	self.last_dy = 0
	self.stairs_landing_sound_pending = false
	if not keep_stairs_lock then
		self:reset_stairs_lock()
	end
	self:sync_input_state_from_runtime() -- To avoid input buffering during the transition. THIS IS EXTREMELY UGLY AND SHOULD BE FIXED PROPERLY IN THE FUTURE, BUT CODEX IS UNABLE TO WRITE PROPER CODE AND THUS HAVE TO FIX THIS MYSELF
	self:emit_room_switched(switch.from_room_number, switch.to_room_number, direction)
	return true
end

function player:try_side_room_switch_from_position()
	local room = object('room')
	local max_x = room.world_width - self.width
	if self.x < room.tile_size then
		if room.room_links.left == 0 then
			self.x = room.tile_size
			return false
		end
		return self:try_switch_room('left', false)
	end
	if self.x > max_x then
		if room.room_links.right == 0 then
			self.x = max_x
			return false
		end
		return self:try_switch_room('right', false)
	end
	return false
end

function player:can_switch_up_from_state()
	if self:has_tag(state_tags.group.can_switch_up) then
		return true
	end
	return self.jumping_from_elevator and self:has_tag(state_tags.group.movement_jump)
end

function player:nearing_room_exit()
	local room = object('room')
	local max_x = room.world_width - self.width
	if self.x < 0 then
		return 'left'
	end
	if self.x > max_x then
		return 'right'
	end
	local up_exit_threshold = room.world_top - room.tile_size
	if self.y < up_exit_threshold then
		return 'up'
	end
	local down_exit_threshold = room.world_height - self.height
	if self.y > down_exit_threshold then
		return 'down'
	end
	return nil
end

function player:clamp_blocked_vertical_room_exit(direction)
	if direction == 'up' then
		local room = object('room')
		local up_limit = room.world_top - room.tile_size
		if self.y < up_limit then
			self.y = up_limit
		end
		self.previous_y_collision = true
		return
	end

	local down_limit = object('room').world_height - self.height
	if self.y > down_limit then
		self.y = down_limit
	end
end

function player:try_vertical_room_switch_from_position()
	local direction = self:nearing_room_exit()
	if direction and vertical_exit_directions[direction] then
		if direction == 'up' and (not self:can_switch_up_from_state()) then
			self:clamp_blocked_vertical_room_exit(direction)
			return false
		end
		if object('room').room_links[direction] == 0 then
			self:clamp_blocked_vertical_room_exit(direction)
			return false
		end
		local keep_stairs_lock = self:has_tag(state_tags.group.stairs) or self.hit_stairs_lock
		if not self:try_switch_room(direction, keep_stairs_lock) then
			self:clamp_blocked_vertical_room_exit(direction)
			return false
		end
		if keep_stairs_lock and (not self:sync_stairs_after_vertical_room_switch(direction)) then
			self:reset_stairs_lock()
			if self:has_tag(state_tags.group.stairs) then
				self.events:emit('stairs_lock_lost_after_room_switch')
			end
		end
		return true
	end
	return false
end

function player:try_room_switches_from_position()
	if self:has_tag(state_tags.group.transition_lock) then
		return false
	end
	if self:has_tag(state_tags.group.stairs) or self.hit_stairs_lock then
		if self:try_vertical_room_switch_from_position() then
			return true
		end
		return self:try_side_room_switch_from_position()
	end
	if self:try_side_room_switch_from_position() then
		return true
	end
	return self:try_vertical_room_switch_from_position()
end

function player:get_jump_inertia(default_inertia)
	if self.left_held and not self.right_held then
		return -1
	end
	if self.right_held and not self.left_held then
		return 1
	end
	return default_inertia
end

function player:pick_entry_stairs(direction)
	local stairs = object('room').stairs
	local best = nil
	local best_dx = 0

	for i = 1, #stairs do
		local stair = stairs[i]
		if self.x >= (stair.x - 4) and self.x <= (stair.x + 8) then
			local y_ok
			if direction < 0 then
				local min_y = stair.top_y + constants.room.tile_size2
				y_ok = self.y >= min_y and self.y <= stair.bottom_y
			else
				local max_y = stair.top_y + constants.room.tile_size
				y_ok = self.y >= stair.top_y and self.y <= max_y
			end
			if y_ok then
				local dx = math.abs(self.x - stair.x)
				if best == nil or dx < best_dx or (dx == best_dx and stair.x > best.x) then
					best = stair
					best_dx = dx
				end
			end
		end
	end

	return best
end

function player:search_stairs_at_locked_x(x, y_probe)
	local stairs = object('room').stairs
	local y_bottom = y_probe + self.height
	for i = 1, #stairs do
		local stair = stairs[i]
		if stair.x == x then
			if stair.top_y <= y_bottom and stair.bottom_y >= y_probe then
				return stair
			end
		end
	end
	return nil
end

function player:apply_stairs_lock(stair)
	self.stairs_x = stair.x
	self.stairs_top_y = stair.top_y
	self.stairs_bottom_y = stair.bottom_y
end

function player:sync_stairs_after_vertical_room_switch(direction)
	local probe_y = self.y
	if direction == 'up' then
		probe_y = probe_y + object('room').tile_size
	end
	local stair = self:search_stairs_at_locked_x(self.stairs_x, probe_y)
	if stair == nil then
		return false
	end

	self:apply_stairs_lock(stair)
	self.x = stair.x
	self.last_dx = 0
	self.last_dy = 0
	return true
end

function player:update_hit_stairs_lock()
	if not self.hit_stairs_lock then
		return
	end
	if not self:has_tag(state_tags.group.hit_lock_states) then
		self.hit_stairs_lock = false
		return
	end
	if self:search_stairs_at_locked_x(self.stairs_x, self.y) == nil then
		self.hit_stairs_lock = false
	end
end

function player:leave_stairs(event_name)
	self.stairs_direction = 0
	self.stairs_x = -1
	if stairs_vertical_exit_events[event_name] then
		local old_y = self.y
		self:snap_feet_y_to_floor_grid()
		self.last_dy = self.last_dy + (self.y - old_y)
	end
	if stairs_landing_events[event_name] then
		self.stairs_landing_sound_pending = true
	else
		self.stairs_landing_sound_pending = false
	end
	self.events:emit(event_name)
end

function player:collides_at_right_wall_stairs_step_off_profile(x, y)
	local wall_x = x + self.width
	local center_x = x + constants.room.tile_half
	local upper_probe_y = (y + self.height) - constants.room.tile_size - 1
	local lower_probe_y = (y + self.height) - 1
	return self:collides_at_probe(center_x, upper_probe_y, false)
		or self:collides_at_probe(center_x, lower_probe_y, false)
		or self:collides_at_probe(wall_x, upper_probe_y, false)
		or self:collides_at_probe(wall_x, lower_probe_y, false)
end

function player:collides_at_left_wall_stairs_step_off_profile(x, y)
	local wall_x = x
	local wall_x_secondary = wall_x - 1
	local center_x = x + constants.room.tile_half
	local upper_probe_y = (y + self.height) - constants.room.tile_size - 1
	local lower_probe_y = (y + self.height) - 1
	return self:collides_at_probe(center_x, upper_probe_y, false)
		or self:collides_at_probe(center_x, lower_probe_y, false)
		or self:collides_at_probe(wall_x, upper_probe_y, false)
		or self:collides_at_probe(wall_x, lower_probe_y, false)
		or self:collides_at_probe(wall_x_secondary, upper_probe_y, false)
		or self:collides_at_probe(wall_x_secondary, lower_probe_y, false)
end

function player:try_step_off_stairs()
	if self.up_held or self.down_held then
		return false
	end

	local dir
	local event_name
	local step_x
	local support_probe_x
	local blocked_by_wall
	if self.left_held and not self.right_held then
		dir = -1
		event_name = 'stairs_step_off_left'
		step_x = constants.stairs.step_off_left_x
		support_probe_x = self.x + constants.stairs.step_off_left_probe_offset_x
		blocked_by_wall = self:collides_at_left_wall_stairs_step_off_profile(self.x, self.y)
	elseif self.right_held and not self.left_held then
		dir = 1
		event_name = 'stairs_step_off_right'
		step_x = constants.stairs.step_off_right_x
		support_probe_x = self.x + constants.stairs.step_off_right_probe_offset_x
		blocked_by_wall = self:collides_at_right_wall_stairs_step_off_profile(self.x, self.y)
	else
		return false
	end

	self.facing = dir
	if blocked_by_wall then
		return false
	end
	local support_probe_y = self.y + self.height + constants.stairs.step_off_probe_extra_y
	if not object('room'):has_collision_flags_at_world(
		support_probe_x,
		support_probe_y,
		constants.collision_flags.solid_mask,
		false
	) then
		return false
	end

	local old_x = self.x
	self.x = self.x + step_x
	self.last_dx = self.x - old_x
	self.last_dy = 0
	self:leave_stairs(event_name)
	return true
end

function player:update_stairs_animation(distance_px)
	self.stairs_anim_distance = self.stairs_anim_distance + distance_px
	while self.stairs_anim_distance >= constants.stairs.anim_step_px do
		self.stairs_anim_distance = self.stairs_anim_distance - constants.stairs.anim_step_px
		if self.stairs_anim_frame == 0 then
			self.stairs_anim_frame = 1
		else
			self.stairs_anim_frame = 0
		end
	end
end

function player:start_stairs(direction, stair, event_name)
	local old_y = self.y
	self:apply_stairs_lock(stair)
	self.x = stair.x
	if direction > 0 then
		local feet_y = self.y + self.height
		self.y = ((math.modf(feet_y / constants.room.tile_size) * constants.room.tile_size) + constants.room.tile_size) - self.height
	end
	self.stairs_direction = direction
	self.stairs_anim_distance = 0
	self.stairs_anim_frame = 0
	self.last_dx = 0
	self.last_dy = self.y - old_y
	self.events:emit(event_name)
end

function player:collides_with_elevator_probe(x, y)
	local count = object('c').elevator_count
	local current_room_number = object('c').current_room_number
	for i = 1, count do
		local platform = object('e.p' .. tostring(i))
		if platform.current_room_number == current_room_number
			and x >= platform.x
			and x < (platform.x + constants.room.tile_size4)
			and y >= platform.y
			and y < (platform.y + constants.room.tile_size2)
		then
			return true
		end
	end

	return false
end

function player:collides_with_elevator_at(x, y)
	local old_x = self.x
	local old_y = self.y
	local count = object('c').elevator_count
	local current_room_number = object('c').current_room_number
	self.x = x
	self.y = y
	for i = 1, count do
		local platform = object('e.p' .. tostring(i))
		if platform.current_room_number == current_room_number
			and collision2d.collides(self.collider, platform.collider)
		then
			self.x = old_x
			self.y = old_y
			return true
		end
	end
	self.x = old_x
	self.y = old_y

	return false
end

function player:try_snap_to_elevator_platform(next_x, next_y)
	local count = object('c').elevator_count
	local current_room_number = object('c').current_room_number
	local tile_support = self:collides_at_support_profile(self.x, self.y, false)
	for i = 1, count do
		local platform = object('e.p' .. tostring(i))
		if platform.current_room_number ~= current_room_number then
			goto continue
		end
		local relative_x = (next_x + 2) - platform.x
		if platform.transport_switch_cooldown_steps == 0
			and relative_x >= 0
			and relative_x < constants.elevator.transport_width
			and (next_y + self.height) < (platform.y + constants.elevator.top_attach_feet_y)
			and (platform.transport_active or not tile_support)
		then
			self.y = platform.y - self.height
			self.x = next_x
			return true
		end
		::continue::
	end

	return false
end

function player:is_support_below_at(x, y, include_elevator)
	if self:collides_at_support_profile(x, y, false) then
		return true
	end
	if not include_elevator then
		return false
	end

	local player_bottom = y + self.height
	local left_foot_x = x + constants.room.tile_half
	local right_foot_x = (x + self.width) - constants.room.tile_half
	local count = object('c').elevator_count
	local current_room_number = object('c').current_room_number
	for i = 1, count do
		local platform = object('e.p' .. tostring(i))
		if platform.current_room_number == current_room_number then
			if player_bottom >= platform.y
				and player_bottom <= (platform.y + 1)
				and (
					(left_foot_x >= platform.x and left_foot_x < (platform.x + constants.room.tile_size4))
					or (right_foot_x >= platform.x and right_foot_x < (platform.x + constants.room.tile_size4))
				)
			then
				return true
			end
		end
	end

	return false
end

function player:collides_at(x, y, include_elevator)
	local rm = object('room')
	if rm:has_collision_flags_in_rect(x, y, self.width, self.height, constants.collision_flags.solid_mask, false) then
		return true
	end
	if include_elevator then
		return self:collides_with_elevator_at(x, y)
	end
	return false
end

function player:collides_at_probe(x, y, include_elevator)
	local rm = object('room')
	if rm:has_collision_flags_at_world(x, y, constants.collision_flags.solid_mask, false) then
		return true
	end
	if include_elevator then
		return self:collides_with_elevator_probe(x, y)
	end
	return false
end

function player:collides_at_support_profile(x, y, include_elevator)
	local feet_y = y + self.height
	local left_foot_x = x + constants.room.tile_half
	local right_foot_x = (x + self.width) - constants.room.tile_half
	return self:collides_at_probe(left_foot_x, feet_y, include_elevator)
		or self:collides_at_probe(right_foot_x, feet_y, include_elevator)
end

function player:collides_at_jump_ceiling_profile(x, y, include_elevator)
	local left_probe_x = x + constants.room.tile_half
	local right_probe_x = (x + self.width) - constants.room.tile_half
	return self:collides_at_probe(left_probe_x, y, include_elevator)
		or self:collides_at_probe(right_probe_x, y, include_elevator)
end

function player:collides_at_right_wall_profile(x, y, include_elevator)
	local wall_x = x + self.width
	local first_probe_y = (y + self.height) - constants.room.tile_size
	local second_probe_y = first_probe_y - 1
	return self:collides_at_probe(wall_x, first_probe_y, include_elevator)
		or self:collides_at_probe(wall_x, second_probe_y, include_elevator)
end

function player:collides_at_left_wall_primary_profile(x, y, include_elevator)
	local first_probe_y = (y + self.height) - constants.room.tile_size
	local second_probe_y = first_probe_y - 1
	return self:collides_at_probe(x, first_probe_y, include_elevator)
		or self:collides_at_probe(x, second_probe_y, include_elevator)
end

function player:collides_at_left_wall_secondary_profile(x, y, include_elevator)
	local wall_x = x - 1
	local first_probe_y = (y + self.height) - constants.room.tile_size
	local second_probe_y = first_probe_y - 1
	return self:collides_at_probe(wall_x, first_probe_y, include_elevator)
		or self:collides_at_probe(wall_x, second_probe_y, include_elevator)
end

function player:snap_feet_y_to_floor_grid()
	local feet_y = self.y + self.height
	self.y = (math.modf(feet_y / constants.room.tile_size) * constants.room.tile_size) - self.height
end

function player:apply_side_probe_horizontal_move(dx)
	local old_x = self.x
	local collided_x = false
	if dx < 0 then
		if self.left_wall_collision then
			self.right_wall_collision = false
			collided_x = true
		else
			local next_x = self.x + dx
			local next_left_wall_collision_primary = self:collides_at_left_wall_primary_profile(next_x, self.y, false)
			local next_left_wall_collision_secondary = self:collides_at_left_wall_secondary_profile(next_x, self.y, false)
			if next_left_wall_collision_primary or next_left_wall_collision_secondary then
				self.x = next_x
				self.left_wall_collision_primary = next_left_wall_collision_primary
				self.left_wall_collision_secondary = next_left_wall_collision_secondary
				self.left_wall_collision = true
				self.right_wall_collision = false
				collided_x = true
			end
		end
	elseif dx > 0 then
		collided_x = self.right_wall_collision
	end

	if collided_x then
		self:snap_x_to_current_wall_grid()
	else
		self.x = self.x + dx
	end

	local room = object('room')
	local max_x = room.world_width - self.width
	local room_links = room.room_links
	if self.x < room.tile_size then
		if room_links.left == 0 then
			self.x = room.tile_size
			collided_x = true
		end
	end
	if self.x > max_x then
		if room_links.right == 0 then
			self.x = max_x
			collided_x = true
		end
	end

	return self.x - old_x, collided_x
end

function player:snap_x_to_current_wall_grid()
	local msx_x = self.x + constants.room.tile_size
	if self.right_wall_collision then
		msx_x = math.modf(msx_x / constants.room.tile_size) * constants.room.tile_size
		self.x = msx_x - constants.room.tile_size
		return
	end
	if self.left_wall_collision then
		self.x = math.modf((self.x + constants.room.tile_size - 1) / constants.room.tile_size) * constants.room.tile_size
		if self.left_wall_collision_primary and (self.x % constants.room.tile_size) == 0 and self:collides_at_left_wall_primary_profile(self.x, self.y, false) then
			self.x = self.x + constants.room.tile_size
		end
	end
end

function player:apply_air_move(dx, dy, include_elevator_collision)
	local old_x = self.x
	local old_y = self.y
	local room = object('room')
	local moved_x, collided_x = self:apply_side_probe_horizontal_move(dx)

	local next_y = old_y + dy
	if dy > 0 and self:try_snap_to_elevator_platform(self.x, next_y) then
	else
		self.y = next_y
	end

	local max_x = room.world_width - self.width
	local room_links = room.room_links
	if self.x < room.tile_size then
		if room_links.left == 0 then
			self.x = room.tile_size
			collided_x = true
		end
	end
	if self.x > max_x then
		if room_links.right == 0 then
			self.x = max_x
			collided_x = true
		end
	end

	local max_y = room.world_height - self.height
	if self.y > max_y and room_links.down <= 0 then
		self.y = max_y
	end

	self.last_dx = self.x - old_x
	self.last_dy = self.y - old_y
	self.previous_x_collision = collided_x
	self.previous_y_collision = dy < 0 and self:collides_at_jump_ceiling_profile(self.x, self.y, include_elevator_collision)
end

function player:start_jump(inertia)
	self.jump_substate = 0
	self:reset_fall_substate_sequence()
	self:reset_vertical_motion_for_jump()
	self.water_jump_dx_accum = 0
	self.jump_inertia = inertia
	self.jumping_from_elevator = self.on_vertical_elevator
	self.events:emit('jump')
	if inertia < 0 then
		self.facing = -1
	elseif inertia > 0 then
		self.facing = 1
	end
end

function player:reset_fall_substate_sequence()
	self.fall_substate = 0
	self.water_controlled_fall_dx_accum = 0
	self:get_timeline('p.seq.f'):force_seek(0)
end

function player:advance_fall_substate_sequence()
	local fall_substate_sequence = self:get_timeline('p.seq.f')
	fall_substate_sequence:advance()
	self.fall_substate = fall_substate_sequence:value()
end

function player:get_controlled_fall_dy()
	if self.fall_substate < 3 then
		return 0
	end
	if self.fall_substate >= 11 then
		return 6
	end
	return constants.physics.controlled_fall_dy_by_substate[self.fall_substate]
end

function player:get_uncontrolled_fall_dy()
	if self.fall_substate >= 8 then
		return 6
	end
	return constants.physics.uncontrolled_fall_dy_by_substate[self.fall_substate]
end

function player:get_controlled_fall_dx()
	local inertia = self.jump_inertia
	if self.right_held and not self.left_held then
		if inertia == 1 then
			return constants.physics.fall_dx_with_inertia
		end
		if inertia == 0 then
			return constants.physics.fall_dx_neutral
		end
		return -constants.physics.fall_dx_against_inertia
	end
	if self.left_held and not self.right_held then
		if inertia == -1 then
			return -constants.physics.fall_dx_with_inertia
		end
		if inertia == 0 then
			return -constants.physics.fall_dx_neutral
		end
		return constants.physics.fall_dx_against_inertia
	end
	return inertia * constants.physics.fall_dx_neutral
end

function player:reset_walk_animation()
	self.walk_frame = 0
	self.walk_distance_accum = 0
end

function player:advance_walk_animation(distance_px)
	self.walk_distance_accum = self.walk_distance_accum + distance_px
	while self.walk_distance_accum >= constants.player.walk_anim_cycle_px do
		self.walk_distance_accum = self.walk_distance_accum - constants.player.walk_anim_cycle_px
		if self.walk_frame == 0 then
			self.walk_frame = 1
		else
			self.walk_frame = 0
		end
	end
end

function player:runcheck_quiet_controls()
	if action_triggered('up[jp] || a[jp]') then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
	end
	if self:try_start_world_or_shrine_interaction_from_down() then
		return
	end
	if action_triggered('down[jp]') then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if action_triggered('up[jp] || a[jp]') then
		local inertia
		if self.left_held and not self.right_held then
			inertia = -1
		elseif self.right_held and not self.left_held then
			inertia = 1
		else
			inertia = 0
		end
		self:start_jump(inertia)
		self.events:emit('jump_input')
		return
	end

	if self.left_held and not self.right_held then
		if self.facing < 0 then
			self.walk_state = 0
			self.events:emit('left_down')
		else
			self.facing = -1
		end
		return
	end
	if self.right_held and not self.left_held then
		if self.facing > 0 then
			self.walk_state = 1
			self.events:emit('right_down')
		else
			self.facing = 1
		end
	end
end

function player:runcheck_walking_right_controls()
	if self.right_held and not self.left_held then
		self.walk_state = 0
	end

	if action_triggered('up[jp] || a[jp]') then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(1)
		self.events:emit('jump_input')
		return
	end
	if self:try_start_world_or_shrine_interaction_from_down() then
		return
	end
	if action_triggered('down[jp]') then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.left_held and self.walk_state == 0 then
		self.events:emit('left_override')
		return
	end
	if not self.right_held then
		if self.left_held then
			self.events:emit('right_released_to_left')
			return
		end
		self.events:emit('right_released_to_quiet')
		return
	end

end

function player:runcheck_walking_left_controls()
	if self.left_held and not self.right_held then
		self.walk_state = 1
	end

	if action_triggered('up[jp] || a[jp]') then
		local stair = self:pick_entry_stairs(-1)
		if stair ~= nil then
			self:start_stairs(-1, stair, 'stairs_up')
			return
		end
		self:start_jump(-1)
		self.events:emit('jump_input')
		return
	end
	if self:try_start_world_or_shrine_interaction_from_down() then
		return
	end
	if action_triggered('down[jp]') then
		local stair = self:pick_entry_stairs(1)
		if stair ~= nil then
			self:start_stairs(1, stair, 'stairs_down')
			return
		end
	end

	if self.right_held and self.walk_state == 1 then
		self.events:emit('right_override')
		return
	end
	if not self.left_held then
		if self.right_held then
			self.events:emit('left_released_to_right')
			return
		end
		self.events:emit('left_released_to_quiet')
		return
	end

end

function player:runcheck_quiet_stairs_controls()
	if self.down_held then
		local was_at_or_below_bottom = self.y >= self.stairs_bottom_y
		self.stairs_direction = 1
		self.events:emit('stairs_down_hold')
		self.last_dy = constants.stairs.down_start_push_px
		self.y = self.y + self.last_dy
		if self.last_dy ~= 0 then
			self:update_stairs_animation(math.abs(self.last_dy))
		end
		if was_at_or_below_bottom then
			self:leave_stairs('stairs_end_bottom')
		end
		return
	end

	if self.up_held then
		self.events:emit('stairs_up_hold')
		local next_y
		if self.y > self.stairs_top_y then
			next_y = self.y - constants.stairs.speed_px
			self.last_dy = next_y - self.y
			self.y = next_y
			self.stairs_direction = -1
			if self.last_dy ~= 0 then
				self:update_stairs_animation(math.abs(self.last_dy))
			end
			return
		end
		self:leave_stairs('stairs_end_top')
		self.last_dy = 0
		return
	end

	if self.left_held and not self.right_held then
		if self:try_step_off_stairs() then
			return
		end
		self.facing = -1
	end
	if self.right_held and not self.left_held then
		if self:try_step_off_stairs() then
			return
		end
		self.facing = 1
	end
end

function player:reset_motion_for_transition_lock()
	self:zero_motion()
	self.walk_move_dx = 0
	self.walk_move_collided_x = false
end

function player:update_entering_world()
	self:reset_motion_for_transition_lock()
	self.transition_step = self.transition_step + 1
	self:update_enter_leave_anim_frame()
	self:update_enter_leave_cut(1)
	if self.transition_step == constants.world_entrance.enter_world_midpoint_step then
		object('d'):queue_world_banner_transition(castle_map.world_transitions[self.enter_leave_world_target].world_number)
		self.to_enter_cut = 0
		self.events:emit('world_entered')
		return
	end
end

function player:update_entering_shrine()
	self:reset_motion_for_transition_lock()
	self.transition_step = self.transition_step + 1
	self:update_enter_leave_anim_frame()
	self:update_enter_leave_cut(-1)
	if self.transition_step > constants.world_entrance.enter_world_total_steps then
		object('d'):open_shrine(self.enter_leave_shrine_text_lines)
		self.events:emit('shrine_entered')
		return
	end
end

function player:update_emerging_world()
	self:reset_motion_for_transition_lock()
	self.transition_step = self.transition_step + 1
	self:update_enter_leave_anim_frame()
	self:update_enter_leave_cut(-1)
	if self.transition_step > constants.world_entrance.enter_world_total_steps then
		self.to_enter_cut = 0
		self.events:emit('world_emerge_done')
	end
end

function player:update_quiet()
	self:zero_motion()
	if not self:is_support_below_at(self.x, self.y, true) then
		self:reset_fall_substate_sequence()
		self:reset_vertical_motion_for_fall()
		self.events:emit('falling')
		return
	end
	self.stairs_landing_sound_pending = false
	if not self:has_tag(state_tags.group.sword) then
		self:runcheck_quiet_controls()
	end
end

function player:update_walking_right()
	self.facing = 1
	local walk_dx = self:get_walk_dx()
	self.walk_move_dx = walk_dx
	self.walk_move_collided_x = false

	if not self:is_support_below_at(self.x, self.y, true) then
		self:zero_motion()
		self:reset_fall_substate_sequence()
		self:reset_vertical_motion_for_fall()
		self.events:emit('falling')
		return
	end

	local moved_x, collided_x = self:apply_side_probe_horizontal_move(walk_dx)
	self.last_dx = moved_x
	self.last_dy = 0
	self.previous_x_collision = collided_x
	self.previous_y_collision = false
	self.walk_move_collided_x = collided_x
	self:advance_walk_animation(walk_dx)
	self:runcheck_walking_right_controls()
end

function player:update_walking_left()
	self.facing = -1
	local walk_dx = self:get_walk_dx()
	self.walk_move_dx = -walk_dx
	self.walk_move_collided_x = false

	if not self:is_support_below_at(self.x, self.y, true) then
		self:zero_motion()
		self:reset_fall_substate_sequence()
		self:reset_vertical_motion_for_fall()
		self.events:emit('falling')
		return
	end

	local moved_x, collided_x = self:apply_side_probe_horizontal_move(-walk_dx)
	self.last_dx = moved_x
	self.last_dy = 0
	self.previous_x_collision = collided_x
	self.previous_y_collision = false
	self.walk_move_collided_x = collided_x
	self:advance_walk_animation(walk_dx)
	self:runcheck_walking_left_controls()
end

function player:update_slowdoorpass()
	if self.slow_doorpass_substate <= 24 then
		local collided_x = false
		if self.facing > 0 then
			collided_x = self.right_wall_collision
			if not collided_x then
				self.x = self.x + 1
			end
		else
			collided_x = self.left_wall_collision
			if not collided_x then
				self.x = self.x - 1
			end
		end
		self.last_dx = collided_x and 0 or self.facing
		self.last_dy = 0
		self.previous_x_collision = collided_x
		self.previous_y_collision = false
		if (math.modf(self.slow_doorpass_substate / 4) % 2) == 0 then
			self.walk_frame = 1
		else
			self.walk_frame = 0
		end
	end

	if self.slow_doorpass_substate >= 24 then
		self.slow_doorpass_substate = 0
		self.walk_frame = 0
		self.events:emit('slowdoorpass_done')
		return
	end

	self.slow_doorpass_substate = self.slow_doorpass_substate + 1
end

function player:update_jump_motion()
	if self.previous_x_collision then
		self.jump_inertia = 0
	end
	local water_jump = self.water_state ~= constants.water.none
	if not self.up_held and self.jump_substate < constants.physics.jump_release_cut_substate then
		if water_jump then
			self.jump_substate = constants.physics.aphrodite_water_jump_release_cut_substate
		else
			self.jump_substate = constants.physics.jump_release_cut_substate
		end
		if water_jump and self.vertical_motion_substate < constants.physics.aphrodite_water_jump_release_cut_substate then
			self.vertical_motion_substate = constants.physics.aphrodite_water_jump_release_cut_substate
		end
	end

	local dy
	local jump_substate_advanced = true
	if water_jump then
		jump_substate_advanced = self:advance_aphrodite_water_vertical_motion()
		dy = self:consume_aphrodite_water_vertical_dy()
	elseif constants.physics.popolon_jump_dy_by_substate[self.jump_substate] ~= nil then
		dy = constants.physics.popolon_jump_dy_by_substate[self.jump_substate]
	else
		dy = 0
	end
	if self.previous_y_collision then
		dy = 0
	end
	local hit_ceiling = self.previous_y_collision
	local dx = self.jump_inertia * constants.physics.jump_dx
	if water_jump then
		dx = self:consume_water_jump_dx(dx)
	end
	self:apply_air_move(dx, dy, true)

	if hit_ceiling then
		self.jump_substate = constants.physics.jump_ceiling_cut_substate
		if water_jump and self.vertical_motion_substate < constants.physics.jump_ceiling_cut_substate then
			self.vertical_motion_substate = constants.physics.jump_ceiling_cut_substate
		end
	end

	if water_jump then
		if jump_substate_advanced then
			self.jump_substate = self.jump_substate + 1
		end
	else
		self.jump_substate = self.jump_substate + 1
		self.vertical_motion_substate = self.jump_substate
	end
	local reached_fall = self.jump_substate >= constants.physics.jump_to_fall_substate
	if reached_fall then
		self:reset_fall_substate_sequence()
	end
	if hit_ceiling then
		self.events:emit('ceiling_to_stopped_jumping')
	end
	if reached_fall then
		self.events:emit('jump_apex_to_controlled_fall')
	end
end

function player:update_stopped_jump_motion()
	if (not self:has_tag(state_tags.group.sword)) and self.previous_x_collision then
		self.jump_inertia = 0
	end
	local dx = self.jump_inertia * constants.physics.jump_dx
	local moved_x, collided_x = self:apply_side_probe_horizontal_move(dx)
	self.last_dx = moved_x
	self.last_dy = 0
	self.previous_x_collision = collided_x
	self.previous_y_collision = false

	if self.water_state ~= constants.water.none then
		if self:advance_aphrodite_water_vertical_motion() then
			self.jump_substate = self.jump_substate + 1
		end
	else
		self.jump_substate = self.jump_substate + 1
		self.vertical_motion_substate = self.jump_substate
	end
	if self.jump_substate >= constants.physics.jump_to_fall_substate then
		self:reset_fall_substate_sequence()
		self.events:emit('landed_to_quiet')
		return
	end

	self:advance_fall_substate_sequence()
	self.events:emit('stopped_to_fall_to_controlled_fall')
end

function player:update_controlled_fall_motion()
	self:update_facing_from_horizontal_input()
	if (not self:has_tag(state_tags.group.sword)) and self.previous_x_collision then
		self.jump_inertia = 0
	end
	local tile_support = self:collides_at_support_profile(self.x, self.y, false)
	if tile_support or self:is_support_below_at(self.x, self.y, true) then
		if tile_support then
			self:snap_feet_y_to_floor_grid()
		end
		self.stairs_landing_sound_pending = false
		self:reset_fall_substate_sequence()
		self.events:emit('landed_to_quiet')
		return
	end
	local dx = self:get_controlled_fall_dx()
	if self.water_state ~= constants.water.none then
		dx = self:consume_water_controlled_fall_dx(dx)
	end
	local dy
	local fall_substate_advanced = true
	if self.water_state ~= constants.water.none then
		fall_substate_advanced = self:advance_aphrodite_water_vertical_motion()
		dy = self:consume_aphrodite_water_vertical_dy()
	else
		dy = self:get_controlled_fall_dy()
	end
	self:apply_air_move(dx, dy, true)
	if self.water_state ~= constants.water.none then
		if fall_substate_advanced then
			self:advance_fall_substate_sequence()
		end
	else
		self:advance_fall_substate_sequence()
		self.vertical_motion_substate = constants.physics.jump_to_fall_substate + self.fall_substate
	end
end

function player:update_uncontrolled_fall_motion()
	local tile_support = self:collides_at_support_profile(self.x, self.y, false)
	if tile_support or self:is_support_below_at(self.x, self.y, true) then
		if tile_support then
			self:snap_feet_y_to_floor_grid()
		end
		if self:has_tag(state_tags.group.sword) or self.fall_substate >= 2 or self.stairs_landing_sound_pending then
			self.events:emit('fall')
		end
		self.stairs_landing_sound_pending = false
		self:reset_fall_substate_sequence()
		self.events:emit('landed_to_quiet')
		return
	end

	local dy
	local fall_substate_advanced = true
	if self.water_state ~= constants.water.none then
		fall_substate_advanced = self:advance_aphrodite_water_vertical_motion()
		dy = self:consume_aphrodite_water_vertical_dy()
	else
		dy = self:get_uncontrolled_fall_dy()
	end
	self:apply_air_move(0, dy, true)
	if self.water_state ~= constants.water.none then
		if fall_substate_advanced then
			self:advance_fall_substate_sequence()
		end
	else
		self:advance_fall_substate_sequence()
		self.vertical_motion_substate = constants.physics.jump_to_fall_substate + self.fall_substate
	end
end

function player:update_up_stairs()
	self:zero_motion()
	self.x = self.stairs_x

	local moved
	local next_y

	if self.up_held and not self.down_held then
		self.stairs_direction = -1
		if self.y > self.stairs_top_y then
			next_y = self.y - constants.stairs.speed_px
			moved = true
		else
			self:leave_stairs('stairs_end_top')
			return
		end
		if next_y <= self.stairs_top_y then
			self.last_dy = next_y - self.y
			self.y = next_y
			self:leave_stairs('stairs_end_top')
			return
		end
	elseif self.down_held then
		self.stairs_direction = 1
		self.events:emit('stairs_reverse_down')
		if self.y < self.stairs_bottom_y then
			next_y = self.y + constants.stairs.speed_px
			moved = true
		else
			self:leave_stairs('stairs_end_bottom')
			return
		end
	elseif self.left_held and not self.right_held then
		self.facing = -1
		self.stairs_direction = 0
		self.events:emit('stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self.events:emit('stairs_quiet_right')
		return
	else
		self.stairs_direction = 0
	end

	if moved then
		self.last_dy = next_y - self.y
		self.y = next_y
		self:update_stairs_animation(math.abs(self.last_dy))
	end
end

function player:update_down_stairs()
	self:zero_motion()
	self.x = self.stairs_x

	local moved
	local next_y
	local down_exit_threshold = object('room').world_height - self.height
	local stairs_reaches_room_exit = self.stairs_bottom_y >= down_exit_threshold

	if self.down_held and not self.up_held then
		self.stairs_direction = 1
		if self.y < self.stairs_bottom_y or stairs_reaches_room_exit then
			next_y = self.y + constants.stairs.speed_px
			moved = true
		else
			self:leave_stairs('stairs_end_bottom')
			return
		end
		if (not stairs_reaches_room_exit) and next_y >= self.stairs_bottom_y then
			self.last_dy = next_y - self.y
			self.y = next_y
			self:leave_stairs('stairs_end_bottom')
			return
		end
	elseif self.up_held then
		self.stairs_direction = -1
		self.events:emit('stairs_reverse_up')
		if self.y > self.stairs_top_y then
			next_y = self.y - constants.stairs.speed_px
			moved = true
		else
			self:leave_stairs('stairs_end_top')
			return
		end
	elseif self.left_held and not self.right_held then
		self.facing = -1
		self.stairs_direction = 0
		self.events:emit('stairs_quiet_left')
		return
	elseif self.right_held and not self.left_held then
		self.facing = 1
		self.stairs_direction = 0
		self.events:emit('stairs_quiet_right')
		return
	else
		self.stairs_direction = 0
	end

	if moved then
		self.last_dy = next_y - self.y
		self.y = next_y
		self:update_stairs_animation(math.abs(self.last_dy))
	end
end

function player:update_quiet_stairs()
	self:zero_motion()
	self.x = self.stairs_x
	self.stairs_direction = 0
	if not self:has_tag(state_tags.group.sword) then
		self:runcheck_quiet_stairs_controls()
	end
end

function player:is_ground_below_for_hit_on_stairs()
	return (not self:collides_at(self.x, self.y, false)) and self:collides_at(self.x, self.y + 1, false)
end

function player:advance_hit_stairs_fall(dy)
	local moved_y = 0
	for i = 1, dy do
		if self:is_ground_below_for_hit_on_stairs() then
			break
		end
		self.y = self.y + 1
		moved_y = moved_y + 1
	end
	self.previous_x_collision = false
	self.previous_y_collision = false
	self.last_dx = 0
	self.last_dy = moved_y
	return self:is_ground_below_for_hit_on_stairs()
end

function player:update_hit_fall()
	local dx = self.hit_direction * constants.damage.knockback_dx
	local dy
	if self.hit_substate >= 4 then
		dy = self.hit_substate - 4
		if dy > 6 then
			dy = 6
		end
	else
		dy = 0
	end

	if self.hit_substate >= 4 then
		if self:collides_at_support_profile(self.x, self.y, false) then
			if self.health <= 0 then
				self:start_dying()
				return
			end
			self:land_from_hit()
			return
		end
	end

	local old_x = self.x
	local old_y = self.y
	local hit_wall = false
	if dx > 0 then
		hit_wall = self.right_wall_collision
	elseif dx < 0 then
		hit_wall = self.left_wall_collision
	end
	if hit_wall then
		self:snap_x_to_current_wall_grid()
		self.hit_direction = 0
	else
		self.x = self.x + dx
	end
	self.y = self.y + dy
	self.last_dx = self.x - old_x
	self.last_dy = self.y - old_y
	self.previous_x_collision = hit_wall
	self.previous_y_collision = false

	if self.hit_substate >= 4 and self.health <= 0 then
		self:start_dying()
		return
	end

	self.hit_substate = self.hit_substate + 1
	if hit_wall then
		self.events:emit('hit_wall')
	end
end

function player:update_hit_collision()
	local dy
	if self.hit_substate >= 4 then
		dy = self.hit_substate - 4
		if dy > 6 then
			dy = 6
		end
	else
		dy = 0
	end

	if self.hit_stairs_lock then
		if self.hit_substate >= 4 then
			local hit_ground = self:advance_hit_stairs_fall(dy)
			if self.health <= 0 then
				self:start_dying()
				return
			end
			if hit_ground then
				self:land_from_hit()
				return
			end
		else
			self:zero_motion()
		end

		self.hit_substate = self.hit_substate + 1
		return
	end

	if self.hit_substate >= 4 then
		if self:collides_at_support_profile(self.x, self.y, false) then
			if self.health <= 0 then
				self:start_dying()
				return
			end
			self:land_from_hit()
			return
		end
	end

	local old_y = self.y
	self.y = self.y + dy
	self.last_dx = 0
	self.last_dy = self.y - old_y
	self.previous_x_collision = false
	self.previous_y_collision = false

	if self.hit_substate >= 4 and self.health <= 0 then
		self:start_dying()
		return
	end

	self.hit_substate = self.hit_substate + 1
end

function player:update_hit_recovery()
	self:zero_motion()
	self.hit_recovery_timer = self.hit_recovery_timer + 1

	if self.hit_recovery_timer < constants.damage.hit_recovery_frames then
		return
	end

	self.hit_recovery_timer = 0
	self.hit_substate = 0
	self.hit_stairs_lock = false
	self.events:emit('hit_recovered')
end

function player:update_dying()
	self:zero_motion()
	self.death_timer = self.death_timer + 1
	if self.death_timer < constants.damage.death_frames then
		return
	end
	self:respawn()
end

function player:update_common_frame()
	self:update_collision_state()
	self:update_water_state()

	if self:has_tag(state_tags.group.transition_lock) then
		self:reset_motion_for_transition_lock()
		self.grounded = false
		self:apply_presentation_state()
		return
	end

	self:try_open_world_entrance_with_key()
	self:update_hit_stairs_lock()
	self:try_side_room_switch_from_position()
	self:try_vertical_room_switch_from_position()

	self.grounded = self:is_support_below_at(self.x, self.y, true)
	self:apply_presentation_state()
	self:update_hit_invulnerability()
end

local function define_player_fsm()
	local input_event_handlers = {
		['left[jp]'] = function(self)
			self.left_held = true
		end,
		['left[jr]'] = function(self)
			self.left_held = false
		end,
		['right[jp]'] = function(self)
			self.right_held = true
		end,
		['right[jr]'] = function(self)
			self.right_held = false
		end,
		['down[jp]'] = function(self)
			self.down_held = true
		end,
		['down[jr]'] = function(self)
			self.down_held = false
		end,
		['up[jp]'] = function(self)
			self:on_up_input_pressed()
		end,
		['up[jr]'] = function(self)
			self:on_up_input_released()
		end,
		['a[jp]'] = function(self)
			self:on_up_input_pressed()
		end,
		['a[jr]'] = function(self)
			self:on_up_input_released()
		end,
		['?(x[jp])'] = function(self)
			self.attack_held = true
		end,
		['?(x[jr])'] = function(self)
			self.attack_held = false
		end,
	}
	-- wrap_state_update: wraps every state's update handler with common per-frame
		-- logic (collision state, room switching, presentation,
	-- invulnerability updates).  This avoids duplicating the same trailing calls
	-- in every update function.  The wrapper also handles elevator-on-jump reset
	-- and sword cooldown decrement.
	local function wrap_state_update(update_handler)
		return function(self, state, event)
			-- Held-state must follow authoritative runtime [p] state every frame.
			-- That keeps movement stable even if a jp/jr edge is missed once.
			self:sync_input_state_from_runtime()
			self:update_collision_state()
			self:update_water_state()
			if not self:has_tag(state_tags.group.movement_jump) then
				self.jumping_from_elevator = false
			end
			if self.sword_cooldown > 0 then
				self.sword_cooldown = self.sword_cooldown - 1
			end
			local next_state = update_handler(self, state, event)
			self:update_common_frame()
			return next_state
		end
	end

	local states = {
		quiet = {
			tags = { state_tags.variant.quiet },
			on = {
				['jump_input'] = '/jumping',
				['left_down'] = '/walking_left',
				['right_down'] = '/walking_right',
				['falling'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
			},
			update = player.update_quiet,
		},
		walking_right = {
			tags = { state_tags.variant.walking_right },
			on = {
				['jump_input'] = '/jumping',
				['slowdoorpass_start'] = '/slowdoorpass',
				['left_override'] = '/walking_left',
				['right_released_to_left'] = '/walking_left',
				['right_released_to_quiet'] = '/quiet',
				['falling'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
				['sword_start'] = '/quiet',
			},
			entering_state = function(self)
				self:reset_walk_animation()
			end,
			update = player.update_walking_right,
		},
		walking_left = {
			tags = { state_tags.variant.walking_left },
			on = {
				['jump_input'] = '/jumping',
				['slowdoorpass_start'] = '/slowdoorpass',
				['right_override'] = '/walking_right',
				['left_released_to_right'] = '/walking_right',
				['left_released_to_quiet'] = '/quiet',
				['falling'] = '/uncontrolled_fall',
				['stairs_up'] = '/up_stairs',
				['stairs_down'] = '/down_stairs',
				['sword_start'] = '/quiet',
			},
			entering_state = function(self)
				self:reset_walk_animation()
			end,
			update = player.update_walking_left,
		},
		slowdoorpass = {
			tags = { state_tags.variant.slowdoorpass, state_tags.group.damage_lock },
			on = {
				['slowdoorpass_done'] = '/quiet',
			},
			entering_state = function(self)
				self.slow_doorpass_substate = 0
				self.walk_frame = 0
			end,
			update = player.update_slowdoorpass,
		},
		jumping = {
			tags = { state_tags.variant.jumping },
			on = {
				['ceiling_to_stopped_jumping'] = '/stopped_jumping',
				['jump_apex_to_controlled_fall'] = '/controlled_fall',
			},
			update = player.update_jump_motion,
		},
		stopped_jumping = {
			tags = { state_tags.variant.stopped_jumping },
			on = {
				['stopped_to_fall_to_controlled_fall'] = '/controlled_fall',
			},
			update = player.update_stopped_jump_motion,
		},
		controlled_fall = {
			tags = { state_tags.variant.controlled_fall },
			on = {
				['landed_to_quiet'] = '/quiet',
			},
			update = player.update_controlled_fall_motion,
		},
		uncontrolled_fall = {
			tags = { state_tags.variant.uncontrolled_fall },
			on = {
				['landed_to_quiet'] = '/quiet',
			},
			update = player.update_uncontrolled_fall_motion,
		},
		up_stairs = {
			tags = { state_tags.variant.up_stairs, state_tags.group.stairs },
			on = {
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_reverse_down'] = '/down_stairs',
				['stairs_quiet_left'] = '/quiet_stairs',
				['stairs_quiet_right'] = '/quiet_stairs',
			},
			update = player.update_up_stairs,
		},
		down_stairs = {
			tags = { state_tags.variant.down_stairs, state_tags.group.stairs },
			on = {
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_reverse_up'] = '/up_stairs',
				['stairs_quiet_left'] = '/quiet_stairs',
				['stairs_quiet_right'] = '/quiet_stairs',
			},
			update = player.update_down_stairs,
		},
		quiet_stairs = {
			tags = { state_tags.variant.quiet_stairs, state_tags.group.stairs },
			on = {
				['stairs_up_hold'] = '/up_stairs',
				['stairs_down_hold'] = '/down_stairs',
				['stairs_end_top'] = '/quiet',
				['stairs_end_bottom'] = '/quiet',
				['stairs_step_off_left'] = '/quiet',
				['stairs_step_off_right'] = '/quiet',
			},
			update = player.update_quiet_stairs,
		},
		entering_world = {
			tags = {
				state_tags.variant.entering_world,
				state_tags.group.transition_lock,
				state_tags.group.damage_lock,
			},
			on = {
				['world_entered'] = '/waiting_world_banner',
			},
			update = player.update_entering_world,
		},
			waiting_world_banner = {
				tags = {
					state_tags.variant.waiting_world_banner,
					state_tags.group.transition_lock,
					state_tags.group.damage_lock,
				},
				on = {
					['world_banner_done'] = {
						emitter = 'd',
						go = function(self)
							self:complete_enter_world_after_banner()
							return '/quiet'
						end,
					},
				},
				update = player.reset_motion_for_transition_lock,
			},
			waiting_halo_banner = {
				tags = {
					state_tags.variant.waiting_halo_banner,
					state_tags.group.transition_lock,
					state_tags.group.damage_lock,
				},
				on = {
					['halo_banner_done'] = {
						emitter = 'd',
						go = function(self)
							self:complete_halo_return_after_banner()
							return '/quiet'
						end,
					},
				},
				update = player.reset_motion_for_transition_lock,
			},
			waiting_world_emerge = {
				tags = {
					state_tags.variant.waiting_world_emerge,
					state_tags.group.transition_lock,
				state_tags.group.damage_lock,
			},
			on = {
				['world_emerge_start'] = '/emerging_world',
			},
			update = player.reset_motion_for_transition_lock,
		},
		emerging_world = {
			tags = {
				state_tags.variant.emerging_world,
				state_tags.group.transition_lock,
				state_tags.group.damage_lock,
			},
			on = {
				['world_emerge_done'] = '/quiet',
			},
			update = player.update_emerging_world,
		},
		entering_shrine = {
			tags = {
				state_tags.variant.entering_shrine,
				state_tags.group.transition_lock,
				state_tags.group.damage_lock,
			},
			on = {
				['shrine_entered'] = '/waiting_shrine',
			},
			update = player.update_entering_shrine,
		},
		waiting_shrine = {
			tags = {
				state_tags.variant.waiting_shrine,
				state_tags.group.transition_lock,
				state_tags.group.damage_lock,
			},
			on = {
				['leave_shrine_overlay'] = '/leaving_shrine',
			},
			update = player.reset_motion_for_transition_lock,
		},
			leaving_shrine = {
				tags = {
					state_tags.variant.leaving_shrine,
					state_tags.group.transition_lock,
					state_tags.group.damage_lock,
				},
				timelines = {
					[player_shrine_exit_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = function(self)
							local castle = object('c')
							self.to_enter_cut = 0
							object('d').events:emit('shrine_exit_done', castle:create_room_enter_payload(false))
							return '/quiet'
						end,
					},
				},
				update = player.reset_motion_for_transition_lock,
			},
		-- FREEZE — entered on 'seal_dissolution' from root on handler.
		-- Cancels any active sword swing, then waits for 'seal_flash_done'.
		-- On unfreeze: pop_and_transition() restores the previous state from
		-- the FSM history stack, so the player resumes exactly where they were.
		freeze = {
			entering_state = function(self)
				self:cancel_sword()
			end,
			on = {
				['seal_flash_done'] = {
					emitter = 'd',
					go = function(_self, state)
						state:pop_and_transition()
					end,
				},
				['title_wait_done'] = {
					emitter = 'd',
					go = function(_self, state)
						state:pop_and_transition()
					end,
				},
			},
		},
		hit_fall = {
			tags = { state_tags.variant.hit_fall, state_tags.group.damage_lock },
			on = {
				['hit_ground'] = '/hit_recovery',
				['hit_wall'] = '/hit_collision',
			},
			update = player.update_hit_fall,
		},
		hit_collision = {
			tags = { state_tags.variant.hit_collision, state_tags.group.damage_lock },
			on = {
				['hit_ground'] = '/hit_recovery',
			},
			update = player.update_hit_collision,
		},
		hit_recovery = {
			tags = { state_tags.variant.hit_recovery, state_tags.group.damage_lock },
			on = {
				['hit_recovered'] = '/quiet',
			},
			update = player.update_hit_recovery,
		},
		dying = {
			tags = { state_tags.variant.dying, state_tags.group.damage_lock },
			on = {
				['respawn'] = '/quiet',
			},
			update = player.update_dying,
		},
	}
	for _, state in pairs(states) do
		local update_handler = state.update
		if update_handler == nil then
			update_handler = function()
			end
		end
		state.update = wrap_state_update(update_handler)
		state.input_event_handlers = input_event_handlers
	end

	-- SWORD CONCURRENT REGION.
	-- is_concurrent = true means this state machine runs in parallel with the
	-- main movement states.  Sword activation/deactivation is orthogonal to
	-- movement — the player can swing while walking, jumping, standing, etc.
	-- The 'active' state adds the g.sw (sword) tag, which tag derivations
	-- combine with movement variant tags to produce visual sword tags
	-- (vis.js, vis.gs, vis.ss) for sprite selection.
	states.sword = {
		is_concurrent = true,
		initial = 'inactive',
		states = {
			inactive = {
				on = {
					['sword_start'] = '/sword/active',
				},
			},
			active = {
				tags = { state_tags.group.sword },
				on = {
					[player_sword_end_event] = '/sword/inactive',
					['sword_cancel'] = '/sword/inactive',
				},
				update = function(self)
					self:advance_sword_sequence()
				end,
			},
		},
	}

	define_fsm('player', {
		initial = 'quiet',
		-- TAG DERIVATIONS — define group and visual tags from state variant tags.
		--
		-- Simple array = ANY-OF: group tag is active when any listed variant is active.
		-- { all = [...] }         : active when ALL listed tags are active.
		-- { any = [...], all = [...] }: ALL must hold, plus at least one of ANY.
		-- { none = [...] }        : active when NONE of the listed tags are active.
		--
		-- These derivations replace scattered `if state == 'x' or state == 'y'`
		-- checks throughout the codebase.  Code instead uses has_tag(group_tag).
		tag_derivations = {
				[state_tags.group.world_transition_waiting] = {
					state_tags.variant.waiting_world_banner,
					state_tags.variant.waiting_halo_banner,
					state_tags.variant.waiting_world_emerge,
					state_tags.variant.waiting_shrine,
				},
			[state_tags.group.world_transition] = {
				state_tags.variant.entering_world,
				state_tags.variant.emerging_world,
				state_tags.variant.entering_shrine,
				state_tags.variant.leaving_shrine,
			},
			[state_tags.group.world_transition_down] = {
				state_tags.variant.emerging_world,
				state_tags.variant.leaving_shrine,
			},
			[state_tags.group.damage_visual] = {
				state_tags.variant.dying,
				state_tags.variant.hit_fall,
				state_tags.variant.hit_collision,
				state_tags.variant.hit_recovery,
			},
			[state_tags.group.movement_walk] = {
				state_tags.variant.walking_right,
				state_tags.variant.walking_left,
				state_tags.variant.slowdoorpass,
			},
			[state_tags.group.player_stairs] = {
				state_tags.variant.up_stairs,
				state_tags.variant.down_stairs,
			},
			[state_tags.group.movement_jump] = {
				state_tags.variant.jumping,
				state_tags.variant.stopped_jumping,
				state_tags.variant.controlled_fall,
			},
			[state_tags.group.can_switch_up] = {
				state_tags.variant.up_stairs,
				state_tags.variant.quiet,
				state_tags.variant.walking_right,
				state_tags.variant.walking_left,
			},
			[state_tags.group.hit_lock_states] = {
				state_tags.variant.hit_fall,
				state_tags.variant.hit_collision,
			},
			[state_tags.group.hit_blink] = {
				state_tags.variant.hit_fall,
				state_tags.variant.hit_collision,
				state_tags.variant.hit_recovery,
			},
			[state_tags.group.elevator_transport] = {
				state_tags.variant.quiet,
				state_tags.variant.walking_right,
				state_tags.variant.walking_left,
				state_tags.variant.hit_recovery,
				state_tags.variant.controlled_fall,
				state_tags.variant.uncontrolled_fall,
			},
			[state_tags.group.sword_activation_allowed] = {
				any = {
					state_tags.variant.quiet,
					state_tags.variant.walking_right,
					state_tags.variant.walking_left,
					state_tags.variant.uncontrolled_fall,
					state_tags.variant.controlled_fall,
					state_tags.variant.jumping,
					state_tags.variant.stopped_jumping,
					state_tags.variant.quiet_stairs,
				},
				none = {
					state_tags.group.damage_lock,
					state_tags.group.sword,
				},
			},
			[state_tags.group.stairs_action_allowed] = {
				none = {
					state_tags.variant.up_stairs,
					state_tags.variant.down_stairs,
				},
			},
			[state_tags.visual.jump_sword] = {
				all = { state_tags.group.sword },
				any = {
					state_tags.variant.jumping,
					state_tags.variant.stopped_jumping,
					state_tags.variant.controlled_fall,
					state_tags.variant.uncontrolled_fall,
				},
			},
			[state_tags.visual.ground_sword] = {
				all = { state_tags.group.sword, state_tags.variant.quiet },
			},
			[state_tags.visual.stairs_sword] = {
				all = { state_tags.group.sword, state_tags.variant.quiet_stairs },
			},
		},
		-- ROOT ON HANDLERS — catch-all event subscriptions.
		-- These fire regardless of which movement state is active.
		--
		-- Entries with { emitter = 'd', go = … } filter by director emitter,
		-- preventing accidental reactions to same-named events from other sources.
		--
		-- 'seal_dissolution' → /freeze: entered on seal break, restores via
		-- pop_and_transition() on 'seal_flash_done' (see freeze state above).
		on = {
					[player_abilities.command_ids.activate_sword] = function(self)
						player_abilities.activate_sword(self)
					end,
					['sword.slice'] = function(self)
						self:try_hit_rock_with_sword()
					end,
					['player.world_emerge'] = {
						emitter = 'd',
						go = function(self)
							self:begin_world_emerge_from_door_midpoint()
						end,
					},
					['player.shrine_overlay_exit'] = {
						emitter = 'd',
						go = function(self)
							self:leave_shrine_overlay()
						end,
					},
					['player.halo_trigger'] = {
						emitter = 'd',
						go = function(self)
							local result = self.actioneffects:trigger('halo')
							if result ~= 'ok' then
								self.events:emit('halo_trigger_cancelled')
							end
						end,
					},
					['enemy.contact_damage'] = function(self, _state, event)
						-- self:take_hit(event.amount, event.source_x, event.source_y, event.reason)
					end,
					['room.switched'] = function(self)
						self:set_space('main')
					end,
				['dying'] = '/dying',
				['damage'] = '/hit_fall',
			['damage_on_stairs'] = '/hit_collision',
				['stairs_lock_lost_after_room_switch'] = '/quiet',
				['enter_world_start'] = '/entering_world',
				['halo_wait_start'] = '/waiting_halo_banner',
				['leave_world_start'] = '/waiting_world_emerge',
				['enter_shrine_start'] = '/entering_shrine',
			['title_wait'] = {
				emitter = 'd',
				go = '/freeze',
			},
			['seal_dissolution'] = '/freeze',
		},
		states = states,
	})
end

local function register_player_definition()
	define_prefab({
		def_id = 'player',
		class = player,
		type = 'sprite',
		fsms = { 'player' },
		defaults = {
			imgid = 'pietolon_stand_r',
			player_index = 1,
			width = constants.player.width,
			height = constants.player.height,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,
			x = constants.player.start_x,
			y = constants.player.start_y,
			facing = 1,
			jump_substate = 0,
			fall_substate = 0,
			jump_inertia = 0,
			grounded = true,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			up_input_sources = 0,
			attack_held = false,
			last_dx = 0,
			last_dy = 0,
			previous_x_collision = false,
			previous_y_collision = false,
			left_wall_collision_primary = false,
			left_wall_collision_secondary = false,
			left_wall_collision = false,
			right_wall_collision = false,
			on_vertical_elevator = false,
			jumping_from_elevator = false,
			walk_frame = 0,
			walk_distance_accum = 0,
				walk_speed_accum = 0,
				walk_state = 0,
				walk_move_dx = 0,
			walk_move_collided_x = false,
			stairs_direction = 0,
			stairs_x = -1,
			stairs_top_y = constants.player.start_y,
			stairs_bottom_y = constants.player.start_y,
			stairs_anim_frame = 0,
			stairs_anim_distance = 0,
			previous_water_state = constants.water.none,
			water_state = constants.water.none,
			vertical_motion_substate = 0,
			vertical_motion_tick = 0,
			vertical_motion_dy_accum = 0,
			water_jump_dx_accum = 0,
			water_controlled_fall_dx_accum = 0,
			hit_stairs_lock = false,
			stairs_landing_sound_pending = false,
			slow_doorpass_substate = 0,
			health = constants.damage.max_health,
			max_health = constants.damage.max_health,
			hit_invulnerability_timer = 0,
			hit_blink_on = false,
			hit_substate = 0,
			hit_direction = 0,
			hit_recovery_timer = 0,
				death_timer = 0,
				transition_step = 0,
				to_enter_cut = 0,
				enter_leave_anim_frame = 0,
				enter_leave_world_target = nil,
				enter_leave_shrine_text_lines = {},
			inventory_items = nil,
			secondary_weapon = nil,
			weapon_level = 0,
			pepernoot_projectile_sequence = 0,
			sword_cooldown = 0,
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
}
