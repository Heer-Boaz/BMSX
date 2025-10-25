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
	self:resetBehavior()
	self:setMode('priming')
	self:setBehaviorStatus('Priming behavior routines')
	return 'SUCCESS'
end

local function update_cycle(self, blackboard)
	if blackboard:get('celebrate') then
		return 'SUCCESS'
	end
	if (blackboard:get('cooldown') or 0) > 0 then
		blackboard:set('loop_tick', 0)
		return 'SUCCESS'
	end
	local tick = (blackboard:get('loop_tick') or 0) + 1
	local interval = blackboard:get('celebrate_interval') or blackboard:get('celebrate_base') or 180
	if tick >= interval then
		blackboard:set('celebrate', true)
		blackboard:set('loop_tick', 0)
		blackboard:set('celebrate_stage', 0)
	else
		blackboard:set('loop_tick', tick)
	end
	return 'SUCCESS'
end

local function should_celebrate(_self, blackboard)
	return blackboard:get('celebrate') == true
end

local function celebrate_action(self, blackboard)
	self:setMode('celebrating')
	self:setHue(12)
	local stage = (blackboard:get('celebrate_stage') or 0) + 1
	blackboard:set('celebrate_stage', stage)
	local pulse = self:adjustPulse(0.05 + math.min(stage / 240, 0.04))
	local iterationPreview = (self.behavior.iteration or 0) + 1
	self:setBehaviorStatus('Celebrating #' .. tostring(iterationPreview) .. ' (' .. tostring(math.floor(pulse * 100 + 0.5)) .. '% pulse)')
	if stage >= 90 then
		blackboard:set('celebrate', false)
		blackboard:set('celebrate_stage', 0)
		blackboard:set('cooldown', 120)
		local base = blackboard:get('celebrate_base') or 180
		local jitter = blackboard:get('celebrate_jitter') or 120
		local nextInterval = base + math.random(0, jitter)
		blackboard:set('celebrate_interval', nextInterval)
		self:setCurrentInterval(nextInterval)
		self:incrementIteration()
		self:setBehaviorStatus('Celebration complete #' .. tostring(self.behavior.iteration or 0))
		return 'SUCCESS'
	end
	return 'RUNNING'
end

local function cooling_down(_self, blackboard)
	return (blackboard:get('cooldown') or 0) > 0
end

local function cooldown_action(self, blackboard)
	self:setMode('cooldown')
	self:setHue(11)
	self:setBehaviorStatus('Cooling behavior energy...')
	self:adjustPulse(-0.025)
	local remaining = (blackboard:get('cooldown') or 0) - 1
	if remaining <= 0 then
		blackboard:set('cooldown', 0)
		self:setBehaviorStatus('Cooldown finished')
		return 'SUCCESS'
	end
	blackboard:set('cooldown', remaining)
	return 'RUNNING'
end

local function idle_action(self, blackboard)
	self:setMode('idle')
	self:setHue(9)
	local interval = blackboard:get('celebrate_interval') or (blackboard:get('celebrate_base') or 180)
	self:setCurrentInterval(interval)
	self:setBehaviorStatus('Waiting for celebration in ~' .. tostring(interval) .. ' frames')
	self:adjustPulse(-0.01)
	print('sadfsf', 12, 13, 15)
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
								{ type = 'Action', action = celebrate_action },
							},
						},
						{
							type = 'Sequence',
							children = {
								{ type = 'Condition', condition = cooling_down },
								{ type = 'Action', action = cooldown_action },
							},
						},
						{ type = 'Action', action = idle_action },
					},
				},
			},
		},
	},
}
