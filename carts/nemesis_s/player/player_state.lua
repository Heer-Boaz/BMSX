local event_emitter<const> = require('cartlib/event_emitter')

local player_state<const> = {}
player_state.__index = player_state

-- The original extra-step UP LASER is unlocked in this cart and therefore
-- occupies its own gauge slot immediately after LASER.
local powerup_slot<const> = {
	speed = 1,
	missile = 2,
	laser = 3,
	uplaser = 4,
	option = 5,
	shield = 6,
}
local powerup_max_levels<const> = { 3, 2, 2, 2, 2, 1 }
local player_state_ids<const> = {
	'nemesis_s.player_state.1',
	'nemesis_s.player_state.2',
}
local events<const> = {
	lives_changed = 'player_state.lives_changed',
	powerups_changed = 'player_state.powerups_changed',
}
local initial_lives<const> = 9
local no_powerup_slot<const> = 0

local reset_powerup_values<const> = function(self, selected_slot)
	local levels<const> = self.powerup_levels
	for slot = 1, #powerup_max_levels do
		levels[slot] = 0
	end
	self.current_powerup_slot = selected_slot
end

local has_powerup_capacity<const> = function(self, slot)
	return self.powerup_levels[slot] < powerup_max_levels[slot]
end

function player_state:set_lives(lives)
	if self.lives == lives then
		return
	end
	self.lives = lives
	self.events:emit(events.lives_changed)
end

function player_state:advance_powerup_selection()
	local slot<const> = self.current_powerup_slot + 1
	if slot > #powerup_max_levels then
		self.current_powerup_slot = 1
	else
		self.current_powerup_slot = slot
	end
	self.events:emit(events.powerups_changed)
end

function player_state:activate_selected_powerup()
	local slot<const> = self.current_powerup_slot
	if slot == no_powerup_slot or not has_powerup_capacity(self, slot) then
		return nil
	end
	local levels<const> = self.powerup_levels
	levels[slot] = levels[slot] + 1
	self.current_powerup_slot = no_powerup_slot
	self.events:emit(events.powerups_changed, slot)
	return slot
end

-- Recoverable world pickups grant their concrete power-up without consuming
-- the status-bar selection. Capacity remains owned by the player state, not by
-- each pickup actor.
function player_state:grant_powerup(slot)
	if not has_powerup_capacity(self, slot) then
		return false
	end
	self.powerup_levels[slot] = self.powerup_levels[slot] + 1
	self.events:emit(events.powerups_changed, slot)
	return true
end

function player_state:remove_powerup(slot)
	self.powerup_levels[slot] = 0
	self.events:emit(events.powerups_changed, slot)
end

function player_state:reset_powerups()
	reset_powerup_values(self, no_powerup_slot)
	self.events:emit(events.powerups_changed)
end

function player_state:lose_life()
	local lives<const> = self.lives - 1
	self:set_lives(lives)
	local selected_slot<const> = lives < 0 and no_powerup_slot or powerup_slot.speed
	reset_powerup_values(self, selected_slot)
	self.events:emit(events.powerups_changed)
	return lives
end

function player_state.new(player_index)
	local self<const> = setmetatable({
		id = player_state_ids[player_index],
		player_index = player_index,
		lives = initial_lives,
		current_powerup_slot = no_powerup_slot,
		powerup_levels = { 0, 0, 0, 0, 0, 0 },
	}, player_state)
	self.events = event_emitter.events_of(self)
	return self
end

return {
	new = player_state.new,
	events = events,
	initial_lives = initial_lives,
	no_powerup_slot = no_powerup_slot,
	powerup_max_levels = powerup_max_levels,
	powerup_slot = powerup_slot,
}
