-- event_emitter.lua
-- lightweight event emitter + per-emitter event port
--
-- DESIGN PRINCIPLES — event usage contracts
--
-- 1. EVENTS ARE ANNOUNCEMENTS, NOT COMMANDS.
--    An event says 'this happened', not 'do this'.  The emitter does not know
--    who listens and does not care.  If the only subscriber is one named object
--    and the event name implies an imperative action on that object, it is a
--    disguised method call.  Delete the event and either call the method
--    directly, or — better — invert the dependency: let the target subscribe
--    to a meaningful broadcast instead of being commanded.
--
--    WRONG — command event (only widget_a listens; thinly-veiled widget_a:reset()):
--      self.events:emit('widget_a.reset')
--    RIGHT — broadcast + self-managing subscriber:
--      -- coordinator announces a state change once:
--      self.events:emit('level_entered')
--      -- each subsystem that needs to reset subscribes in its own bind():
--      self.events:on({ event = 'level_entered', emitter = 'coordinator',
--          handler = self.on_level_entered })
--
-- 2. BROADCAST WITH PAYLOAD — DATA IN THE EVENT, NOT SEPARATE EVENTS.
--    When a subsystem needs data alongside a mode switch, carry it as a
--    payload on the mode broadcast.  Do NOT emit a separate "data" event
--    followed by a "mode" event — this creates fragile ordering dependencies
--    and disguised method calls.
--
--    WRONG — two events (data + mode):
--      self.events:emit('shrine.open', { lines = lines })
--      self.events:emit('shrine')
--    RIGHT — single broadcast with payload:
--      self.events:emit('shrine', { lines = lines })
--    The subscriber reads payload.lines in its handler.
--
--    Subsystems that need to reset when a new mode starts subscribe to the
--    appropriate mode broadcast (e.g. 'room') in their own bind() and
--    self-clear.  No separate 'X.clear' events are needed.
--
-- 3. REQUEST / REPLY PATTERN.
--    When object A needs a result from object B but must not call B directly:
--    A emits a namespaced request event; B subscribes, does work, and emits a
--    reply event; A (or A's FSM on-handler) reacts to the reply.
--
--      -- A emits the request (e.g. from an FSM entering_state):
--      self.events:emit('subsystem.query_result')
--      -- B subscribes in its bind():
--      self.events:on({ event = 'subsystem.query_result', emitter = 'a',
--          handler = self.on_result_requested })
--      -- B emits the answer with a payload:
--      self.events:emit('subsystem.result', { value = computed_value })
--      -- A reacts in its FSM on-handler:
--      on = { ['subsystem.result'] = function(self, _s, payload)
--          return payload.value and '/state_yes' or '/state_no'
--      end }
--
-- 4. EMITTER FILTER.
--    The `emitter` field in on() filters by emitter id. Always supply it when
--    the event name is not globally unique
--    (e.g. short names such as 'ready', 'done', 'update') to avoid reacting
--    to unrelated emitters of the same event name.
--
-- 5. SUBSCRIBER + HANDLER FORM ONE CALLABLE.
--    The listener record retains the subscriber and unbound handler separately.
--    Dispatch invokes handler(subscriber, event_type, emitter, payload,
--    emitter_id), matching an object-method callable without allocating a
--    closure per subscription. remove_subscriber() uses the same receiver for
--    lifecycle cleanup. It plays no role in dispatch filtering.
--
-- 6. EVENTPORT VS EVENTEMITTER.
--    Cart code should use event_port (self.events) not event_emitter directly.
--    event_port:on() auto-fills the emitter filter from the port owner.
--    event_port:emit() auto-fills the emitter identity.
--    This prevents accidentally omitting the emitter and creating
--    subscriptions that fire for unrelated sources.

local event_emitter<const> = {
	id = 'event_emitter',
	_global_listeners = {},
	_scoped_listeners = {},
	_subscriptions_by_subscriber = {},
	_listener_admission = 0,
}

local event_port<const> = {}
event_port.__index = event_port

local port_cache<const> = setmetatable({}, { __mode = 'k' })

local retire_listener_list<const> = function(self, list)
	local event_name<const> = list._event_name
	local emitter_id<const> = list._emitter_id
	if emitter_id == nil then
		self._global_listeners[event_name] = nil
		return
	end
	local scope<const> = self._scoped_listeners[event_name]
	scope.by_emitter[emitter_id] = nil
	local scope_count<const> = scope.count - 1
	scope.count = scope_count
	if scope_count == 0 then
		self._scoped_listeners[event_name] = nil
	end
end

local append_listener<const> = function(self, list, entry)
	local admission<const> = self._listener_admission + 1
	self._listener_admission = admission
	entry.admission = admission
	local previous<const> = list.last
	entry.previous = previous
	if previous == nil then
		list.first = entry
	else
		previous.next = entry
	end
	list.last = entry
	entry.list = list
	local subscriber<const> = entry.subscriber
	local subscriptions = self._subscriptions_by_subscriber[subscriber]
	if subscriptions == nil then
		subscriptions = {}
		self._subscriptions_by_subscriber[subscriber] = subscriptions
	end
	local subscriber_index<const> = #subscriptions + 1
	subscriptions[subscriber_index] = entry
	entry.subscriber_index = subscriber_index
end

local unlink_subscriber<const> = function(self, entry)
	local subscriber<const> = entry.subscriber
	local subscriptions<const> = self._subscriptions_by_subscriber[subscriber]
	local subscriber_index<const> = entry.subscriber_index
	local last_index<const> = #subscriptions
	if subscriber_index < last_index then
		local moved<const> = subscriptions[last_index]
		subscriptions[subscriber_index] = moved
		moved.subscriber_index = subscriber_index
	end
	subscriptions[last_index] = nil
	entry.subscriber_index = nil
	if last_index == 1 then
		self._subscriptions_by_subscriber[subscriber] = nil
	end
end

local remove_listener<const> = function(self, entry)
	local list<const> = entry.list
	local previous<const> = entry.previous
	local next<const> = entry.next
	unlink_subscriber(self, entry)
	if previous == nil then
		list.first = next
	else
		previous.next = next
	end
	if next == nil then
		list.last = previous
	else
		next.previous = previous
	end
	entry.list = nil
	entry.previous = nil
	entry.subscriber = nil
	entry.handler = nil
	-- An active emission may already have borrowed this node. Its forward
	-- link survives removal; no live index retains the removed node itself.
	if list.first == nil then
		retire_listener_list(self, list)
	end
end

function event_emitter.events_of(emitter)
	local port = port_cache[emitter]
	if not port then
		port = setmetatable({ emitter = emitter, emitter_id = emitter.id }, event_port)
		port_cache[emitter] = port
	end
	return port
end

-- event_emitter:on(spec): register a listener.
-- spec fields:
--   event               (string)  — required; event type to listen for.
--   handler             (function)— required unbound method; called with the
--                                    subscriber first, then event type, emitter,
--                                    payload and emitter id as direct Lua values.
--   subscriber          (object)  — method receiver and lifecycle owner used
--                                    by remove_subscriber().
--   emitter             (id)      — filter; only fire for this emitter.
--                                    Always supply for non-unique event names.
--   once                (boolean) — remove this subscription before its first
--                                    dispatch, including recursive emission.
function event_emitter:on(spec, default_subscriber, default_emitter)
	local name<const> = spec.event
	local subscriber = spec.subscriber
	if subscriber == nil then
		subscriber = default_subscriber
	end
	local emitter = spec.emitter
	if emitter == nil then
		emitter = default_emitter
	end
	local list
	if emitter == nil then
		local listeners<const> = self._global_listeners
		list = listeners[name]
		if list == nil then
			list = { _event_name = name }
			listeners[name] = list
		end
	else
		local listeners<const> = self._scoped_listeners
		local scope = listeners[name]
		if scope == nil then
			scope = { by_emitter = {}, count = 0 }
			listeners[name] = scope
		end
		local scopes<const> = scope.by_emitter
		list = scopes[emitter]
		if list == nil then
			list = {
				_event_name = name,
				_emitter_id = emitter,
			}
			scopes[emitter] = list
			scope.count = scope.count + 1
		end
	end
	append_listener(self, list, {
		handler = spec.handler,
		subscriber = subscriber,
		once = spec.once,
	})
end

-- event_emitter:off(event_name, subscriber, handler, emitter): remove one
-- object-method callable. Prefer remove_subscriber() for bulk cleanup.
function event_emitter:off(event_name, subscriber, handler, emitter)
	local list
	if emitter == nil then
		list = self._global_listeners[event_name]
	else
		local scope<const> = self._scoped_listeners[event_name]
		if scope ~= nil then
			list = scope.by_emitter[emitter]
		end
	end
	if not list then
		return
	end
	local entry = list.last
	while entry ~= nil do
		local previous<const> = entry.previous
		if entry.subscriber == subscriber and entry.handler == handler then
			remove_listener(self, entry)
		end
		entry = previous
	end
end

-- event_emitter:emit(): synchronously dispatch direct event values. emitter_id
-- is retained by the owning event port for filtering and downstream FSMs.
-- Removal during dispatch takes effect before the listener's next call;
-- listeners added during dispatch start with the next emission.
-- Studio observes formal arguments, not their spellings: self=0, event=1,
-- emitter=2, payload=3, emitter identity=4. See docs/cartlib_inspection_contract.md.
function event_emitter:emit(event_type, emitter, payload, emitter_id)
	blua32.trace(self, 'event.emit', event_type, emitter_id, payload)
	local scope<const> = self._scoped_listeners[event_type]
	local scoped_list<const> = scope and scope.by_emitter[emitter_id]
	local global_list<const> = self._global_listeners[event_type]
	if scoped_list == nil and global_list == nil then
		return
	end
	-- A single admission boundary applies to both phases, including global
	-- listeners added by a scoped callback. Dispatch owns only stack borrows;
	-- errors and abandoned coroutines need no deferred cleanup to release them.
	local admission<const> = self._listener_admission
	local entry = scoped_list and scoped_list.first
	while entry ~= nil and entry.admission <= admission do
		local next<const> = entry.next
		if entry.list == scoped_list then
			if entry.once then
				local handler<const>, subscriber<const> = entry.handler, entry.subscriber
				remove_listener(self, entry)
				handler(subscriber, event_type, emitter, payload, emitter_id)
			else
				entry.handler(entry.subscriber, event_type, emitter, payload, emitter_id)
			end
		end
		entry = next
	end
	entry = global_list and global_list.first
	while entry ~= nil and entry.admission <= admission do
		local next<const> = entry.next
		if entry.list == global_list then
			if entry.once then
				local handler<const>, subscriber<const> = entry.handler, entry.subscriber
				remove_listener(self, entry)
				handler(subscriber, event_type, emitter, payload, emitter_id)
			else
				entry.handler(entry.subscriber, event_type, emitter, payload, emitter_id)
			end
		end
		entry = next
	end
end

-- event_emitter:remove_subscriber(subscriber): remove all
-- listeners whose `subscriber` field equals the given object.  This is the
-- standard cleanup path called from world_object:unbind().
function event_emitter:remove_subscriber(subscriber)
	local subscriptions<const> = self._subscriptions_by_subscriber[subscriber]
	if subscriptions == nil then
		return
	end
	while #subscriptions > 0 do
		remove_listener(self, subscriptions[#subscriptions])
	end
end

-- event_port:on(spec): preferred cart API for subscribing to events.
-- Identical to event_emitter:on() but defaults the retained emitter filter and
-- subscriber to the port owner. The caller's declarative spec is not retained
-- or modified.
function event_port:on(spec)
	event_emitter:on(spec, self.emitter, self.emitter_id)
end

-- event_port:emit(event_name, payload): preferred cart API for emitting events.
-- Payload identity is preserved exactly, including nil and false.
function event_port:emit(event_name, payload)
	event_emitter:emit(event_name, self.emitter, payload, self.emitter_id)
end

require('cartlib/registry'):register(event_emitter)

return event_emitter
