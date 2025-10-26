return {
	id = 'lua_demo_engine_service',
	auto_activate = true,
	on_boot = function(self)
		self.engineActorId = nil
		self.mode = 'idle'
		self.timer = 0
		self.toggleCount = 0
		self.interval = 2
		self.status = 'Waiting for actor'
	end,
	events = {
		['lua_demo.engine_actor_spawned'] = function(self, _event_name, emitter, payload)
			self.engineActorId = emitter.id
			self.mode = 'idle'
			self.timer = 0
			self.toggleCount = 0
			self.status = 'Tracking actor ' .. emitter.id
			if payload and payload.interval then
				self.interval = payload.interval
			end
		end,
	},
	on_tick = function(self, delta)
		-- ensure we have an actor id; throw a clear error at the caller if missing
		-- assert(self.engineActorId, 'missing engineActorId')
		-- error('Simulated error in demo service')  -- to test error handling
		self.timer = self.timer + delta
		if self.timer < self.interval then
			return
		end
		self.timer = self.timer - self.interval
		local actor = registry:get(self.engineActorId)
		if self.mode == 'idle' then
			self.mode = 'running'
			self.toggleCount = self.toggleCount + 1
			self.status = 'Service switched to running (#' .. self.toggleCount .. ')'
			events:emit('start', actor or 'dummy')
		else
			self.mode = 'idle'
			self.toggleCount = self.toggleCount + 1
			self.status = 'Service switched to idle (#' .. self.toggleCount .. ')'
			events:emit('stop', actor or 'dummy')
		end
	end,
	get_state = function(self)
		return {
			engineActorId = self.engineActorId,
			mode = self.mode,
			timer = self.timer,
			interval = self.interval,
			toggleCount = self.toggleCount,
			status = self.status,
		}
	end,
	set_state = function(self, state)
		self.engineActorId = state.engineActorId
		self.mode = state.mode
		self.timer = state.timer
		self.interval = state.interval
		self.toggleCount = state.toggleCount
		self.status = state.status
	end,
}
