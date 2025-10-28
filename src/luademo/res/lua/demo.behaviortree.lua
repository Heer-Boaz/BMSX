local function get_number(blackboard, key, fallback)
	local value = blackboard:get(key)
	if type(value) == 'number' and value == value then
		return value
	end
	return fallback
end

local function set_number(blackboard, key, value)
	blackboard:set(key, value)
end

local function bootstrap(self, blackboard)
	if blackboard:get('bootstrapped') then
		return 'SUCCESS'
	end
	blackboard:set('bootstrapped', true)
	blackboard:set('loop_tick', 0)
	blackboard:set('celebrate', false)
	blackboard:set('celebrate_stage', 0)
	blackboard:set('cooldown', 0)
	blackboard:set('celebrate_base', 180)
	blackboard:set('celebrate_jitter', 120)
	blackboard:set('celebrate_interval', 180)
	self:resetbehavior()
	self:setmode('priming')
	self:setbehaviorstatus('Priming behavior routines')
	return 'SUCCESS'
end

local function update_cycle(self, blackboard)
	if blackboard:get('celebrate') then
		return 'SUCCESS'
	end
	local cooldown = get_number(blackboard, 'cooldown', 0)
	if cooldown > 0 then
		blackboard:set('loop_tick', 0)
		return 'SUCCESS'
	end
	local tick = get_number(blackboard, 'loop_tick', 0) + 1
	local base_interval = get_number(blackboard, 'celebrate_base', 180)
	local interval = get_number(blackboard, 'celebrate_interval', base_interval)
	if tick >= interval then
		blackboard:set('celebrate', true)
		blackboard:set('loop_tick', 0)
		blackboard:set('celebrate_stage', 0)
	else
		blackboard:set('loop_tick', tick)
	end
	return 'SUCCESS'
end

local function should_celebrate(_, blackboard)
	return blackboard:get('celebrate') == true
end

local function cooling_down(_, blackboard)
	return get_number(blackboard, 'cooldown', 0) > 0
end

local function celebrate(self, blackboard)
	self:setmode('celebrating')
	self:sethue(12)
	local stage = get_number(blackboard, 'celebrate_stage', 0) + 1
	set_number(blackboard, 'celebrate_stage', stage)
	local pulse = self:adjustpulse(0.05 + math.min(stage / 240, 0.04))
	local iteration_preview = (self.behavior.iteration or 0) + 1
	self:setbehaviorstatus('Celebrating #' .. iteration_preview .. ' (' .. math.floor(pulse * 100 + 0.5) .. '% pulse)')
	if stage >= 90 then
		blackboard:set('celebrate', false)
		blackboard:set('celebrate_stage', 0)
		set_number(blackboard, 'cooldown', 120)
		local base = get_number(blackboard, 'celebrate_base', 180)
		local jitter = get_number(blackboard, 'celebrate_jitter', 120)
		local next_interval = base + math.floor(math.random() * (jitter + 1))
		set_number(blackboard, 'celebrate_interval', next_interval)
		self:setcurrentinterval(next_interval)
		self:incrementiteration()
		self:setbehaviorstatus('Celebration complete #' .. (self.behavior.iteration or 0))
		return 'SUCCESS'
	end
	return 'RUNNING'
end

local function cooldown(self, blackboard)
	self:setmode('cooldown')
	self:sethue(11)
	self:setbehaviorstatus('Cooling behavior energy...')
	self:adjustpulse(-0.025)
	local remaining = get_number(blackboard, 'cooldown', 0) - 1
	if remaining <= 0 then
		blackboard:set('cooldown', 0)
		self:setbehaviorstatus('Cooldown finished')
		return 'SUCCESS'
	end
	set_number(blackboard, 'cooldown', remaining)
	return 'RUNNING'
end

local function idle(self, blackboard)
	self:setmode('idle')
	self:sethue(9)
	local base_interval = get_number(blackboard, 'celebrate_base', 180)
	local interval = get_number(blackboard, 'celebrate_interval', base_interval)
	self:setcurrentinterval(interval)
	self:setbehaviorstatus('Waiting for celebration in ~' .. interval .. ' frames')
	self:adjustpulse(-0.01)
	return 'SUCCESS'
end

return {
	id = 'lua_demo_bt',
	definition = {
		root = {
			type = 'Sequence',
			children = {
				{ type = 'Action', action = bootstrap },
				{ type = 'Action', action = update_cycle },
				{
					type = 'Selector',
					children = {
						{
							type = 'Sequence',
							children = {
								{ type = 'Condition', condition = should_celebrate },
								{ type = 'Action', action = celebrate },
							},
						},
						{
							type = 'Sequence',
							children = {
								{ type = 'Condition', condition = cooling_down },
								{ type = 'Action', action = cooldown },
							},
						},
						{ type = 'Action', action = idle },
					},
				},
			},
		},
	},
}
