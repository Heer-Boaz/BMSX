-- action_effects.lua
-- Action effect registry + runtime component

local eventemitter = require("eventemitter")
local components = require("components")
local Component = components.Component

local ActionEffects = {}

ActionEffects.EffectType = {
	SPAWN = "spawn",
	DESPAWN = "despawn",
	DAMAGE = "damage",
	HEAL = "heal",
	MOVE = "move",
	PLAY_SOUND = "play_sound",
	PLAY_ANIMATION = "play_animation",
	EMIT_EVENT = "emit_event",
}

local registry = {
	definitions = {},
	schemas = {},
	validators = {},
}

function ActionEffects.register_effect(definition, opts)
	if type(definition) == "string" then
		local id = definition
		if type(opts) == "table" then
			definition = opts
			definition.id = definition.id or id
		else
			definition = { id = id, handler = opts }
		end
		opts = nil
	end
	registry.definitions[definition.id] = definition
	if opts then
		if opts.schema then
			registry.schemas[definition.id] = opts.schema
		end
		if opts.validate then
			registry.validators[definition.id] = opts.validate
		end
	end
	return definition
end

function ActionEffects.get(id)
	return registry.definitions[id]
end

function ActionEffects.has(id)
	return registry.definitions[id] ~= nil
end

function ActionEffects.validate(id, payload)
	local schema = registry.schemas[id]
	if schema and not schema.validate(payload) then
		error("ActionEffect payload failed schema for '" .. id .. "'")
	end
	local validator = registry.validators[id]
	if validator then
		validator(payload)
	end
end

function ActionEffects.execute(id, context, ...)
	local def = registry.definitions[id]
	return def.handler(context, ...)
end

local function invoke_handler(definition, owner, payload, args)
	if not definition.handler then
		return nil
	end
	local context = { owner = owner, target = owner, payload = payload, args = args }
	return definition.handler(context, table.unpack(args or {}))
end

local function create_owner_event(owner, event_type, payload)
	local base = { type = event_type, emitter = owner }
	if payload ~= nil then
		if type(payload) == "table" and payload.type == nil then
			for k, v in pairs(payload) do
				base[k] = v
			end
		else
			base.payload = payload
		end
	end
	return eventemitter.create_gameevent(base)
end

ActionEffects.register_effect(ActionEffects.EffectType.MOVE, {
	id = ActionEffects.EffectType.MOVE,
	handler = function(context, dx, dy)
		local target = context.target
		target.x = target.x + dx
		target.y = target.y + dy
	end,
})

ActionEffects.register_effect(ActionEffects.EffectType.PLAY_ANIMATION, {
	id = ActionEffects.EffectType.PLAY_ANIMATION,
	handler = function(context, anim_id)
		context.target:play_ani(anim_id)
	end,
})

local ActionEffectComponent = {}
ActionEffectComponent.__index = ActionEffectComponent
setmetatable(ActionEffectComponent, { __index = Component })

function ActionEffectComponent.new(opts)
	opts = opts or {}
	opts.type_name = "ActionEffectComponent"
	opts.unique = true
	local self = setmetatable(Component.new(opts), ActionEffectComponent)
	self.definitions = {}
	self.cooldown_until = {}
	self.time_ms = 0
	return self
end

function ActionEffectComponent:advance_time(dt_ms)
	self.time_ms = self.time_ms + dt_ms
	for id, until in pairs(self.cooldown_until) do
		if self.time_ms >= until then
			self.cooldown_until[id] = nil
		end
	end
end

function ActionEffectComponent:tick(dt)
end
end

function ActionEffectComponent:grant_effect(definition)
	self.definitions[definition.id] = definition
end

function ActionEffectComponent:grant_effect_by_id(id)
	local definition = registry.definitions[id]
	self:grant_effect(definition)
end

function ActionEffectComponent:revoke_effect(id)
	self.definitions[id] = nil
	self.cooldown_until[id] = nil
end

function ActionEffectComponent:has_effect(id)
	return self.definitions[id] ~= nil
end

function ActionEffectComponent:trigger(id, opts)
	local definition = self.definitions[id]
	if not definition then
		return "failed"
	end
	local payload = opts and opts.payload
	local args = opts and opts.args or {}
	ActionEffects.validate(id, payload)

	local now = self.time_ms
	local until = self.cooldown_until[id]
	if until ~= nil and now < until then
		return "on_cooldown"
	end

	local owner = self.parent
	local outcome = invoke_handler(definition, owner, payload, args)
	local event_type = (outcome and outcome.event) or definition.event or definition.id
	local event_payload = (outcome and outcome.payload ~= nil) and outcome.payload or payload
	local event = create_owner_event(owner, event_type, event_payload)
	owner.events:emit_event(event)
	owner.sc:dispatch_event(event)

	if definition.cooldown_ms and definition.cooldown_ms > 0 then
		self.cooldown_until[id] = now + definition.cooldown_ms
	end
	return "ok"
end

function ActionEffectComponent:cooldown_remaining(id)
	local until = self.cooldown_until[id]
	if until == nil then
		return nil
	end
	local remaining = until - self.time_ms
	if remaining <= 0 then
		return nil
	end
	return remaining
end

ActionEffects.ActionEffectComponent = ActionEffectComponent
components.register_component("ActionEffectComponent", ActionEffectComponent)

return ActionEffects
