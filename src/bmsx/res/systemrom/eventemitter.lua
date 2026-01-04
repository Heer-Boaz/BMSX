-- eventemitter.lua
-- lightweight event emitter + per-emitter event port

local eventemitter = {}
eventemitter.__index = eventemitter

local eventport = {}
eventport.__index = eventport

local port_cache = setmetatable({}, { __mode = "k" })

local function format_emitter(value)
	if value == nil then
		return "nil"
	end
	local value_type = type(value)
	if value_type == "table" or value_type == "native_object" then
		if value.id ~= nil then
			return tostring(value.id)
		end
	end
	return tostring(value)
end

local function should_log_event(event_type)
	return event_type == "combat.start" or event_type == "combat.results" or event_type == "story.node.enter"
end

local function create_gameevent(spec)
	local event = {
		type = spec.type,
		emitter = spec.emitter,
		timestamp = spec.timestamp or (os.clock() * 1000),
	}
	for k, v in pairs(spec) do
		if k ~= "type" and k ~= "emitter" and k ~= "timestamp" then
			event[k] = v
		end
	end
	return event
end

function eventemitter.new()
	return setmetatable({
		listeners = {},
		any_listeners = {},
	}, eventemitter)
end

eventemitter.instance = eventemitter.new()
eventemitter.instance._debug_id = eventemitter.instance._debug_id or tostring(os.clock())

function eventemitter:create_gameevent(spec)
	return create_gameevent(spec)
end

function eventemitter:events_of(emitter)
	local port = port_cache[emitter]
	if not port then
		port = setmetatable({ emitter = emitter }, eventport)
		port_cache[emitter] = port
	end
	return port
end

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

function eventemitter:on_any(handler, persistent)
	self.any_listeners[#self.any_listeners + 1] = { handler = handler, persistent = persistent }
end

function eventemitter:off_any(handler, force_persistent)
	for i = #self.any_listeners, 1, -1 do
		local entry = self.any_listeners[i]
		if entry.handler == handler and (force_persistent or not entry.persistent) then
			table.remove(self.any_listeners, i)
		end
	end
end

function eventemitter:emit(arg0, emitter, payload)
	local event
	if type(arg0) == "table" then
		event = arg0
	else
		local spec = { type = arg0, emitter = emitter }
		if payload ~= nil then
			if type(payload) == "table" and payload.type == nil then
				for k, v in pairs(payload) do
					spec[k] = v
				end
			else
				spec.payload = payload
			end
		end
		event = create_gameevent(spec)
	end

	local list = self.listeners[event.type]
	if should_log_event(event.type) then
		print("[EventEmitter] emit " .. tostring(event.type) .. " emitter=" .. format_emitter(event.emitter) .. " instance=" .. tostring(self._debug_id))
		print("[EventEmitter] listeners " .. tostring(event.type) .. " count=" .. tostring(list and #list or 0))
	end

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

function eventemitter:remove_subscriber(subscriber, force_persistent)
	for _, list in pairs(self.listeners) do
		for i = #list, 1, -1 do
			local entry = list[i]
			if entry.subscriber == subscriber and (force_persistent or not entry.persistent) then
				table.remove(list, i)
			end
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

function eventport:on(spec)
	spec.emitter = spec.emitter or self.emitter.id or self.emitter
	eventemitter.instance:on(spec)
	local name = spec.event_name or spec.event
	return function()
		eventemitter.instance:off(name, spec.handler, spec.emitter)
	end
end

function eventport:emit(event_name, payload)
	eventemitter.instance:emit(event_name, self.emitter, payload)
end

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
	create_gameevent = create_gameevent,
}
