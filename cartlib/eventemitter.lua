-- eventemitter.lua
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
--          subscriber = self,
--          handler = function() self:reset() end })
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
--          subscriber = self,
--          handler = function() self:compute_and_reply() end })
--      -- B emits the answer with a payload:
--      self.events:emit('subsystem.result', { value = computed_value })
--      -- A reacts in its FSM on-handler:
--      on = { ['subsystem.result'] = function(self, _s, payload)
--          return payload.value and '/state_yes' or '/state_no'
--      end }
--
-- 4. EMITTER FILTER.
--    The `emitter` field in on() filters by emitter id (string) or object
--    reference.  Always supply it when the event name is not globally unique
--    (e.g. short names such as 'ready', 'done', 'update') to avoid reacting
--    to unrelated emitters of the same event name.
--
-- 5. SUBSCRIBER FIELD.
--    `subscriber` in on() is used exclusively by remove_subscriber(); it plays
--    no role in dispatch filtering.  Always populate it so that subscriptions
--    are cleaned up when the subscriber object is removed.
--
-- 6. EVENTPORT VS EVENTEMITTER.
--    Cart code should use event_port (self.events) not eventemitter directly.
--    event_port:on() auto-fills the emitter filter from the port owner.
--    event_port:emit() auto-fills the emitter identity.
--    This prevents accidentally omitting the emitter and creating
--    subscriptions that fire for unrelated sources.

local eventemitter<const> = {
	id = 'eventemitter',
	listeners = {},
	any_listeners = {},
	_subscriptions_by_subscriber = {},
	_dispatch_depth = 0,
	_pending_listener_lists = {},
	_pending_listener_count = 0,
}

local event_port<const> = {}
event_port.__index = event_port

local port_cache<const> = setmetatable({}, { __mode = 'k' })

local compact_listeners<const> = function(list)
	local write_index = 1
	local count<const> = #list
	for read_index = 1, count do
		local entry<const> = list[read_index]
		if entry then
			list[write_index] = entry
			entry.list_index = write_index
			write_index = write_index + 1
		end
	end
	for index = write_index, count do
		list[index] = nil
	end
	list._removals_pending = nil
end

local append_listener<const> = function(self, list, entry)
	local list_index<const> = #list + 1
	list[list_index] = entry
	entry.list = list
	entry.list_index = list_index
	local subscriber<const> = entry.subscriber
	if subscriber ~= nil then
		local subscriptions = self._subscriptions_by_subscriber[subscriber]
		if subscriptions == nil then
			subscriptions = {}
			self._subscriptions_by_subscriber[subscriber] = subscriptions
		end
		local subscriber_index<const> = #subscriptions + 1
		subscriptions[subscriber_index] = entry
		entry.subscriber_index = subscriber_index
	end
end

local unlink_subscriber<const> = function(self, entry)
	local subscriber<const> = entry.subscriber
	if subscriber == nil then
		return
	end
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
	local index<const> = entry.list_index
	unlink_subscriber(self, entry)
	entry.list = nil
	entry.list_index = nil
	if self._dispatch_depth == 0 then
		table.remove(list, index)
		for moved_index = index, #list do
			list[moved_index].list_index = moved_index
		end
		return
	end
	list[index] = false
	if not list._removals_pending then
		list._removals_pending = true
		local pending_index<const> = self._pending_listener_count + 1
		self._pending_listener_count = pending_index
		self._pending_listener_lists[pending_index] = list
	end
end

local commit_listener_removals<const> = function(self)
	local pending<const> = self._pending_listener_lists
	for index = 1, self._pending_listener_count do
		compact_listeners(pending[index])
		pending[index] = nil
	end
	self._pending_listener_count = 0
end

function eventemitter.events_of(emitter)
	local port = port_cache[emitter]
	if not port then
		local emitter_id = emitter
		local subscriber
		if type(emitter) == 'table' then
			emitter_id = emitter.id
			subscriber = emitter
		end
		port = setmetatable({ emitter = emitter, emitter_id = emitter_id, subscriber = subscriber }, event_port)
		port_cache[emitter] = port
	end
	return port
end

-- eventemitter:on(spec): register a listener.
-- spec fields:
--   event               (string)  — required; event type to listen for.
--   handler             (function)— required; called with event type, emitter
--                                    and payload as direct Lua values.
--   subscriber          (object)  — strongly recommended; used by
--                                    remove_subscriber() for cleanup.
--   emitter             (string|object) — filter; only fire for this emitter.
--                                    Always supply for non-unique event names.
function eventemitter:on(spec, default_subscriber, default_emitter)
	local name<const> = spec.event
	local list = self.listeners[name]
	if not list then
		list = {}
		self.listeners[name] = list
	end
	local subscriber = spec.subscriber
	if subscriber == nil then
		subscriber = default_subscriber
	end
	local emitter = spec.emitter
	if emitter == nil then
		emitter = default_emitter
	end
	append_listener(self, list, {
		handler = spec.handler,
		subscriber = subscriber,
		emitter = emitter,
	})
end

-- eventemitter:off(event_name, handler, emitter): remove a specific listener
-- by exact handler reference + emitter.  Prefer remove_subscriber() for bulk
-- cleanup of all subscriptions owned by a subscriber.
function eventemitter:off(event_name, handler, emitter)
	local list<const> = self.listeners[event_name]
	if not list then
		return
	end
	for i = #list, 1, -1 do
		local entry<const> = list[i]
		if entry and entry.handler == handler and entry.emitter == emitter then
			remove_listener(self, entry)
		end
	end
end

function eventemitter:on_any(handler, subscriber)
	append_listener(self, self.any_listeners, {
		handler = handler,
		subscriber = subscriber,
	})
end

-- eventemitter:emit(): synchronously dispatch direct event values. emitter_id
-- is retained by the owning event port for filtering and downstream FSMs.
-- Removal during dispatch takes effect before the listener's next call;
-- listeners added during dispatch start with the next emission.
function eventemitter:emit(event_type, emitter, payload, emitter_id)
	local list<const> = self.listeners[event_type]
	local listener_count<const> = list and #list or 0
	local any_listeners<const> = self.any_listeners
	local any_listener_count<const> = #any_listeners
	self._dispatch_depth = self._dispatch_depth + 1
	if list then
		for i = 1, listener_count do
			local entry<const> = list[i]
			if entry then
				local filter<const> = entry.emitter
				if filter == nil or filter == emitter or filter == emitter_id then
					entry.handler(event_type, emitter, payload, emitter_id)
				end
			end
		end
	end
	for i = 1, any_listener_count do
		local entry<const> = any_listeners[i]
		if entry then
			entry.handler(event_type, emitter, payload, emitter_id)
		end
	end
	local dispatch_depth<const> = self._dispatch_depth - 1
	self._dispatch_depth = dispatch_depth
	if dispatch_depth == 0 and self._pending_listener_count ~= 0 then
		commit_listener_removals(self)
	end
end

-- eventemitter:remove_subscriber(subscriber): remove all
-- listeners whose `subscriber` field equals the given object.  This is the
-- standard cleanup path called from worldobject:unbind().
function eventemitter:remove_subscriber(subscriber)
	local subscriptions<const> = self._subscriptions_by_subscriber[subscriber]
	if subscriptions == nil then
		return
	end
	while #subscriptions > 0 do
		remove_listener(self, subscriptions[#subscriptions])
	end
end

-- event_port:on(spec): preferred cart API for subscribing to events.
-- Identical to eventemitter:on() but defaults the retained emitter filter and
-- subscriber to the port owner. The caller's declarative spec is not retained
-- or modified.
function event_port:on(spec)
	eventemitter:on(spec, self.subscriber, self.emitter_id)
end

-- event_port:emit(event_name, payload): preferred cart API for emitting events.
-- Payload identity is preserved exactly, including nil and false.
function event_port:emit(event_name, payload)
	eventemitter:emit(event_name, self.emitter, payload, self.emitter_id)
end

require('cartlib/registry'):register(eventemitter)

return eventemitter
