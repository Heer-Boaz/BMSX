-- action_effects.lua
-- action effect registry + runtime component

local eventemitter = require("eventemitter")
local components = require("components")
local component = components.component

local actioneffects = {}

actioneffects.effecttype = {
	spawn = "spawn",
	despawn = "despawn",
	damage = "damage",
	heal = "heal",
	move = "move",
	play_sound = "play_sound",
	play_animation = "play_animation",
	emit_event = "emit_event",
}

local registry = {
	definitions = {},
	schemas = {},
	validators = {},
}

function actioneffects.register_effect(definition, opts)
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

function actioneffects.get(id)
	return registry.definitions[id]
end

function actioneffects.has(id)
	return registry.definitions[id] ~= nil
end

function actioneffects.validate(id, payload)
	local schema = registry.schemas[id]
	if schema and not schema.validate(payload) then
		error("actioneffect payload failed schema for '" .. id .. "'")
	end
	local validator = registry.validators[id]
	if validator then
		validator(payload)
	end
end

function actioneffects.execute(id, context, ...)
	local def = registry.definitions[id]
	return def.handler(context, ...)
end

local function create_context(owner, payload, args)
	return { owner = owner, target = owner, payload = payload, args = args }
end

local function matches_tag_requirements(owner, required_tags, blocked_tags)
	if required_tags then
		for i = 1, #required_tags do
			if not owner:has_tag(required_tags[i]) then
				return false
			end
		end
	end
	if blocked_tags then
		for i = 1, #blocked_tags do
			if owner:has_tag(blocked_tags[i]) then
				return false
			end
		end
	end
	return true
end

local function matches_state_path_requirements(owner, required_paths, blocked_paths)
	if required_paths then
		for i = 1, #required_paths do
			if not owner:matches_state_path(required_paths[i]) then
				return false
			end
		end
	end
	if blocked_paths then
		for i = 1, #blocked_paths do
			if owner:matches_state_path(blocked_paths[i]) then
				return false
			end
		end
	end
	return true
end

local function can_trigger(definition, context, args)
	if not matches_tag_requirements(context.owner, definition.required_tags, definition.blocked_tags) then
		return false
	end
	if not matches_state_path_requirements(context.owner, definition.required_state_paths, definition.blocked_state_paths) then
		return false
	end
	local trigger_gate = definition.can_trigger
	if trigger_gate then
		return trigger_gate(context, table.unpack(args or {})) == true
	end
	return true
end

local function invoke_handler(definition, context, args)
	if not definition.handler then
		return nil
	end
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
	return eventemitter.eventemitter.instance:create_gameevent(base)
end

actioneffects.register_effect(actioneffects.effecttype.move, {
	id = actioneffects.effecttype.move,
	handler = function(context, dx, dy)
		local target = context.target
		target.x = target.x + dx
		target.y = target.y + dy
	end,
})

actioneffects.register_effect(actioneffects.effecttype.play_animation, {
	id = actioneffects.effecttype.play_animation,
	handler = function(context, anim_id, opts)
		context.target:play_ani(anim_id, opts)
	end,
})

local actioneffectcomponent = {}
actioneffectcomponent.__index = actioneffectcomponent
setmetatable(actioneffectcomponent, { __index = component })

function actioneffectcomponent.new(opts)
	opts = opts or {}
	opts.type_name = "actioneffectcomponent"
	opts.unique = true
	local self = setmetatable(component.new(opts), actioneffectcomponent)
	self.definitions = {}
	self.cooldown_until = {}
	self.time_ms = 0
	return self
end

function actioneffectcomponent:advance_time(dt_ms)
	self.time_ms = self.time_ms + dt_ms
	for id, until_time in pairs(self.cooldown_until) do
		if self.time_ms >= until_time then
			self.cooldown_until[id] = nil
		end
	end
end

function actioneffectcomponent:tick(dt_ms)
	self:advance_time(dt_ms)
end

function actioneffectcomponent:grant_effect(definition)
	self.definitions[definition.id] = definition
end

function actioneffectcomponent:grant_effect_by_id(id)
	local definition = registry.definitions[id]
	self:grant_effect(definition)
end

function actioneffectcomponent:revoke_effect(id)
	self.definitions[id] = nil
	self.cooldown_until[id] = nil
end

function actioneffectcomponent:has_effect(id)
	return self.definitions[id] ~= nil
end

function actioneffectcomponent:trigger(id, opts)
	local definition = self.definitions[id]
	if not definition then
		return "failed"
	end
	local payload = opts and opts.payload
	local args = opts and opts.args or {}
	actioneffects.validate(id, payload)

	local now = self.time_ms
	local until_time = self.cooldown_until[id]
	if until_time ~= nil and now < until_time then
		return "on_cooldown"
	end

	local owner = self.parent
	local context = create_context(owner, payload, args)
	if not can_trigger(definition, context, args) then
		return "blocked"
	end

	local outcome = invoke_handler(definition, context, args)
	local event_type = (outcome and outcome.event) or definition.event or definition.id
	local event_payload = (outcome and outcome.payload ~= nil) and outcome.payload or payload
	local event = create_owner_event(owner, event_type, event_payload)
	owner.events:emit_event(event)
	owner.sc:dispatch(event)

	if definition.cooldown_ms and definition.cooldown_ms > 0 then
		self.cooldown_until[id] = now + definition.cooldown_ms
	end
	return "ok"
end

function actioneffectcomponent:cooldown_remaining(id)
	local until_time = self.cooldown_until[id]
	if until_time == nil then
		return nil
	end
	local remaining = until_time - self.time_ms
	if remaining <= 0 then
		return nil
	end
	return remaining
end

actioneffects.actioneffectcomponent = actioneffectcomponent
components.register_component("actioneffectcomponent", actioneffectcomponent)

return actioneffects
