local world<const> = require('cartlib/world/world')
local scene_library<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local progression<const> = require('cartlib/progression')
local input<const> = require('cartlib/input/input')
local clock<const> = require('cartlib/clock')
local combat<const> = require('combat')
local sentinel<const> = require('sentinel')
local milestones<const> = require('milestones')
local scenes<const> = require('scenes')

local game_module<const> = {}
local game<const> = {}

local arrival_finished<const> = function(_ship, session)
	session.pending_scene = 'play'
end

function game:ctor()
	self.visible = false
	self.phase = 'title'
	self.frame = 0
	self.scene_changes = 0
	self.score = 0
	self.lives = 3
	self.wave = 0
	self.shots_fired = 0
	self.enemy_shots = 0
	self.dashes = 0
	self.dash_unlocked = false
	self.twin_cannon = false
	self.event_payload = { score = 0, lives = 3, wave = 0, phase = 'title' }
end

function game:bind()
	self.progress_state = progression.new_state(milestones)
	progression.mount(self, milestones, self.progress_state)
end

-- disable-next-line single_line_method_pattern -- Paired World lifecycle releases the session's mounted progression runtime.
function game:unbind()
	progression.unmount(self)
end

function game:reset_match()
	progression.unmount(self)
	self.progress_state = progression.new_state(milestones)
	progression.mount(self, milestones, self.progress_state)
	self.score = 0
	self.lives = 3
	self.wave = 0
	self.shots_fired = 0
	self.enemy_shots = 0
	self.dashes = 0
	self.dash_unlocked = false
	self.twin_cannon = false
end

function game:emit(event)
	local payload<const> = self.event_payload
	payload.score = self.score
	payload.lives = self.lives
	payload.wave = self.wave
	payload.phase = self.phase
	self.events:emit(event, payload)
end

function game:enter_scene()
	local phase<const> = self.pending_scene
	self.pending_scene = nil
	self.phase = phase
	self.scene_changes = self.scene_changes + 1
	world:set_space(phase)
	self.scene = scene_library.instantiate(scenes[phase], {
		backdrop = { game = self }, ship = { game = self }, enemy = { game = self },
	})
	self.player = self.scene.members.ship
	self.enemy = self.scene.members.enemy
	self.burst = self.scene.members.burst
	self.player_bolts = {}
	self.enemy_bolts = {}
	if phase == 'intro' then
		self.player.timelines:play('arrival', nil, arrival_finished, self)
	elseif phase == 'play' then
		for index = 1, 8 do
			self.player_bolts[index] = self.scene:spawn('starcatch.bolt', { space_id = 'play' })
		end
		for index = 1, 4 do
			self.enemy_bolts[index] = self.scene:spawn('starcatch.bolt', { space_id = 'play' })
		end
		self:next_enemy()
	end
	world:set_gameplay_clock_running(phase == 'play')
	self:emit('starcatch.scene_entered')
end

function game:change_scene()
	world:set_gameplay_clock_running(false)
	if self.scene == nil then
		self:enter_scene()
	else
		self.scene:dispose(game.enter_scene, self)
	end
end

function game:next_enemy()
	local enemy<const> = self.enemy
	self.wave = self.wave + 1
	enemy.brain:stop()
	enemy.x = 48 + (self.wave * 67 + 45) % 224
	enemy.y = 48 + (self.wave % 3) * 12
	enemy.charge = 0
	enemy.mode = 'align'
	enemy.brain:start()
end

function game:fire_player(ship)
	local count = 1
	if self.twin_cannon then count = 2 end
	for muzzle = 1, count do
		for index = 1, #self.player_bolts do
			local bolt<const> = self.player_bolts[index]
			if not bolt.visible then
				bolt.x = ship.x
				if count == 2 then bolt.x = ship.x - 6 + (muzzle - 1) * 12 end
				bolt.y = ship.y - 16
				bolt.vx = 0
				bolt.vy = -8
				bolt.visible = true
				self.shots_fired = self.shots_fired + 1
				break
			end
		end
	end
	ship.timelines:play('fire')
end

function game:fire_enemy(enemy)
	for index = 1, #self.enemy_bolts do
		local bolt<const> = self.enemy_bolts[index]
		if not bolt.visible then
			bolt.x = enemy.x
			bolt.y = enemy.y + 12
			local dx<const> = self.player.x - bolt.x
			local dy<const> = self.player.y - bolt.y
			local length<const> = math.sqrt(dx * dx + dy * dy)
			bolt.vx = dx * 2.5 / length
			bolt.vy = dy * 2.5 / length
			bolt.visible = true
			self.enemy_shots = self.enemy_shots + 1
			self:emit('starcatch.enemy_fired')
			break
		end
	end
end

function game:damage_player(ship)
	self.lives = self.lives - 1
	ship.timelines:play('hurt')
	self:emit('starcatch.ship_hit')
	if self.lives == 0 then self.pending_scene = 'over' end
end

function game:destroy_enemy()
	self.burst.x = self.enemy.x
	self.burst.y = self.enemy.y
	self.burst.timelines:play('burst')
	self.score = self.score + 1
	self:emit('starcatch.enemy_destroyed')
	if self.pending_scene == nil then self:next_enemy() end
end

function game:step_bolts(bolts, hostile)
	for index = 1, #bolts do
		local bolt<const> = bolts[index]
		if bolt.visible then
			bolt.x = bolt.x + bolt.vx
			bolt.y = bolt.y + bolt.vy
			if bolt.x < 12 or bolt.x > 308 or bolt.y < 26 or bolt.y > 222 then
				bolt.visible = false
			elseif hostile then
				if math.abs(bolt.x - self.player.x) <= 12 and math.abs(bolt.y - self.player.y) <= 14 then
					bolt.visible = false
					self.player.actioneffects:trigger('starcatch.hurt')
				end
			elseif math.abs(bolt.x - self.enemy.x) <= 14 and math.abs(bolt.y - self.enemy.y) <= 14 then
				bolt.visible = false
				self:destroy_enemy()
			end
		end
		if self.pending_scene ~= nil then return end
	end
end

function game:step()
	self.frame = self.frame + 1
	local start<const> = input.is_action_just_pressed(1, clock.frame, 'touch')
		or input.is_action_just_pressed(1, clock.frame, 'a')
	if self.scene.definition.launchable then
		if self.player ~= nil then self.player.spin = self.frame * 0.012 end
		if start then
			self:reset_match()
			self.pending_scene = 'intro'
		end
	elseif self.phase == 'play' then
		local dx = 0
		local dy = 0
		if input.is_action_pressed(1, clock.gameplay, 'left') then dx = dx - 1 end
		if input.is_action_pressed(1, clock.gameplay, 'right') then dx = dx + 1 end
		if input.is_action_pressed(1, clock.gameplay, 'up') then dy = dy - 1 end
		if input.is_action_pressed(1, clock.gameplay, 'down') then dy = dy + 1 end
		local speed = 3
		if dx ~= 0 and dy ~= 0 then speed = 2.1213203435596424 end
		local ship<const> = self.player
		speed = speed * ship.dash_speed
		ship.x = math.max(22, math.min(298, ship.x + dx * speed))
		ship.y = math.max(126, math.min(202, ship.y + dy * speed))
		ship.bank = dx * 0.16
		self:step_bolts(self.player_bolts, false)
		if self.pending_scene == nil then self:step_bolts(self.enemy_bolts, true) end
	end
	if self.pending_scene ~= nil then self:change_scene() end
end

function game_module.install()
	combat.install()
	sentinel.install()
	scenes.register()
	prefab.define({ def_id = 'starcatch.game', class = game })
end

function game_module.new()
	local session<const> = world:spawn('starcatch.game', {})
	session.pending_scene = 'title'
	session:change_scene()
	return session
end

return game_module
