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
--    The subscriber reads event.lines in its handler.
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
--      on = { ['subsystem.result'] = function(self, _s, e)
--          return e.value and '/state_yes' or '/state_no'
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
-- 6. PERSISTENT FLAG.
--    persistent = true keeps the subscription alive across clear() calls.
--    Use only for long-lived system-level listeners that must outlive normal
--    object lifecycle resets.
--
-- 7. EVENTPORT VS EVENTEMITTER.
--    Cart code should use eventport (self.events) not eventemitter directly.
--    eventport:on() auto-fills the emitter filter from the port owner.
--    eventport:emit() auto-fills the emitter identity.
--    This prevents accidentally omitting the emitter and creating
--    subscriptions that fire for unrelated sources.

local eventemitter = {}
eventemitter.__index = eventemitter

local eventport = {}
eventport.__index = eventport

local port_cache = setmetatable({}, { __mode = 'k' })

local function copy_event_fields(dst, src)
	for k, v in pairs(src) do
		if k ~= 'type' and k ~= 'emitter' and k ~= 'timestamp' then
			dst[k] = v
		end
	end
	return dst
end

function eventemitter.new()
	return setmetatable({
		listeners = {},
		any_listeners = {},
	}, eventemitter)
end

eventemitter.instance = eventemitter.new()
eventemitter.instance.id = 'eventemitter'
eventemitter.instance.type_name = 'eventemitter'
eventemitter.instance.registrypersistent = true
require('registry').instance:register(eventemitter.instance)

function eventemitter:create_gameevent(spec)
	return copy_event_fields({
		type = spec.type,
		emitter = spec.emitter,
	}, spec)
end

function eventemitter:events_of(emitter)
	local port = port_cache[emitter]
	if not port then
		port = setmetatable({ emitter = emitter }, eventport)
		port_cache[emitter] = port
	end
	return port
end

-- eventemitter:on(spec): register a listener.
-- spec fields:
--   event / event_name  (string)  — required; event type to listen for.
--   handler             (function)— required; called with the event table.
--   subscriber          (object)  — strongly recommended; used by
--                                    remove_subscriber() for cleanup.
--   emitter             (string|object) — filter; only fire for this emitter.
--                                    Always supply for non-unique event names.
--   persistent          (bool)    — if true, survives clear() calls.
function eventemitter:on(spec)
	local name = spec.event_name or spec.event
	local list = self.listeners[name]
	if not list then
		list = {}
		self.listeners[name] = list
	end
	list[#list + 1] = {
		handler = spec.handler,
		subscriber = spec.subscriber,
		emitter = spec.emitter,
		persistent = spec.persistent,
	}
end

-- eventemitter:off(event_name, handler, emitter): remove a specific listener
-- by exact handler reference + emitter.  Prefer remove_subscriber() for bulk
-- cleanup of all subscriptions owned by a subscriber.
function eventemitter:off(event_name, handler, emitter)
	local list = self.listeners[event_name]
	if not list then
		return
	end
	for i = #list, 1, -1 do
		local entry = list[i]
		if entry.handler == handler and entry.emitter == emitter then
			table.remove(list, i)
		end
	end
end

-- eventemitter:on_any(handler, persistent, subscriber): listen to ALL events
-- regardless of type.  Use sparingly (e.g. debugging, event logging).  For
-- normal game logic always subscribe to a specific event name via on().
function eventemitter:on_any(handler, persistent, subscriber)
	self.any_listeners[#self.any_listeners + 1] = { handler = handler, persistent = persistent, subscriber = subscriber }
end

function eventemitter:off_any(handler, force_persistent)
	for i = #self.any_listeners, 1, -1 do
		local entry = self.any_listeners[i]
		if entry.handler == handler and (force_persistent or not entry.persistent) then
			table.remove(self.any_listeners, i)
		end
	end
end

-- eventemitter:emit(event): fire a pre-built event table directly.
-- The global bus does not normalize or mutate caller-owned payload tables.
-- Build canonical events at the edge (eventport:emit / emit_event / $.emit).
function eventemitter:emit(event)
	if type(event) ~= 'table' then
		error('eventemitter.emit expects an event table')
	end
	if event.emitter and event.emitter.dispose_flag then
		return
	end

	local list = self.listeners[event.type]
	if list then
		for i = 1, #list do
			local entry = list[i]
			local filter = entry.emitter
			if filter == nil or filter == event.emitter or filter == (event.emitter and event.emitter.id) then
				entry.handler(event)
			end
		end
	end

	for i = 1, #self.any_listeners do
		self.any_listeners[i].handler(event)
	end
end

-- eventemitter:remove_subscriber(subscriber, force_persistent): remove all
-- listeners whose `subscriber` field equals the given object.  This is the
-- standard cleanup path called from worldobject:unbind().  Pass
-- force_persistent = true to also remove persistent subscriptions.
function eventemitter:remove_subscriber(subscriber, force_persistent)
	for _, list in pairs(self.listeners) do
		for i = #list, 1, -1 do
			local entry = list[i]
			if entry.subscriber == subscriber and (force_persistent or not entry.persistent) then
				table.remove(list, i)
			end
		end
	end
	for i = #self.any_listeners, 1, -1 do
		local entry = self.any_listeners[i]
		if entry.subscriber == subscriber and (force_persistent or not entry.persistent) then
			table.remove(self.any_listeners, i)
		end
	end
end

function eventemitter:clear()
	for _, list in pairs(self.listeners) do
		for i = #list, 1, -1 do
			if not list[i].persistent then
				table.remove(list, i)
			end
		end
	end
	for i = #self.any_listeners, 1, -1 do
		if not self.any_listeners[i].persistent then
			table.remove(self.any_listeners, i)
		end
	end
end

-- eventport:on(spec): preferred cart API for subscribing to events.
-- Identical to eventemitter:on() but automatically sets spec.emitter to the
-- port's owner if not supplied.  Returns a function that unsubscribes when
-- called.  Always supply subscriber = <owning_object> for lifecycle cleanup.
function eventport:on(spec)
	if spec.persistent then
		error('Persistent listeners must register on eventemitter.instance directly.')
	end
	if spec.subscriber == nil and type(self.emitter) == 'table' then
		spec.subscriber = self.emitter
	end
	if spec.emitter == nil then
		spec.emitter = self.emitter.id or self.emitter
	elseif not spec.emitter then
		spec.emitter = nil
	end
	eventemitter.instance:on(spec)
	local name = spec.event_name or spec.event
	return function()
		eventemitter.instance:off(name, spec.handler, spec.emitter)
	end
end

-- eventport:emit(event_name, payload): preferred cart API for emitting events.
-- Automatically builds a canonical event table with emitter=self.emitter.
function eventport:emit(event_name, payload)
	local event = {
		type = event_name,
		emitter = self.emitter,
	}
	if payload ~= nil then
		if type(payload) == 'table' then
			copy_event_fields(event, payload)
		else
			event.payload = payload
		end
	end
	eventemitter.instance:emit(event)
end

-- eventport:emit_event(event): emit a pre-built event table, setting the
-- emitter to the port's owner if not already set.  Returns the event table.
-- Use when you already built the canonical event in a hot path or need to
-- pass the same event object to another system after emission.
function eventport:emit_event(event)
	event.emitter = event.emitter or self.emitter
	eventemitter.instance:emit(event)
	return event
end

return {
	eventemitter = eventemitter,
	eventport = eventport,
	events_of = function(emitter)
		return eventemitter.instance:events_of(emitter)
	end,
}
