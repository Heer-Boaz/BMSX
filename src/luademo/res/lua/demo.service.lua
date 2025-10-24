return {
	id = 'lua_demo_engine_service',
	auto_activate = true,
	on_boot = function(self)
		self.engineActorId = nil
		self.mode = 'idle'
		self.timer = 0
	end,
	events = {
		['lua_demo.engine_actor_spawned'] = function(self, _event_name, _emitter, payload)
			if not payload then
				return
			end
			local actorId = payload.actorId
			if not actorId then
				return
			end
			self.engineActorId = actorId
			self.mode = 'idle'
			self.timer = 0
		end,
	},
	on_tick = function(self, delta)
		if not self.engineActorId then
			return
		end
		self.timer = self.timer + delta
		if self.timer < 2 then
			return
		end
		self.timer = self.timer - 2
		if self.mode == 'idle' then
			emit('start', nil, self.engineActorId)
			self.mode = 'running'
		else
			emit('stop', nil, self.engineActorId)
			self.mode = 'idle'
		end
	end,
	get_state = function(self)
		return {
			engineActorId = self.engineActorId,
			mode = self.mode,
			timer = self.timer,
		}
	end,
	set_state = function(self, state)
		if not state then
			return
		end
		self.engineActorId = state.engineActorId
		self.mode = state.mode or 'idle'
		self.timer = state.timer or 0
	end,
}
