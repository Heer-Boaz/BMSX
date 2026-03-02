-- action_effects.lua
-- action effect registry + runtime component
--
-- DESIGN PRINCIPLES — action effects
--
-- 1. WHAT IS AN ACTION EFFECT?
--    An action effect is a named, reusable behaviour that can be granted to an
--    object at runtime (think: abilities, power-ups, attacks).  An object can
--    only trigger an effect if that effect has been granted to it.  Cooldown,
--    tag/condition gating, and event emission after execution are all built in.
--
-- 2. TWO-STEP FLOW: register globally, then grant to objects.
--
--    STEP 1 — register the effect definition once at load time:
--      actioneffects.register_effect({
--          id = 'sword_swing',
--          cooldown_ms = 400,
--          handler = function(ctx)
--              ctx.owner:play_timeline('swing')
--          end,
--      })
--
--    STEP 2 — grant the effect to an object's actioneffectcomponent:
--      player.abilities:grant_effect('sword_swing')
--
--    STEP 3 — trigger the effect from any input/event handler:
--      local result = player.abilities:trigger('sword_swing')
--      -- result: "ok" | "blocked" | "on_cooldown" | "failed"
--
-- 3. EFFECTS FIRE via emit_gameplay_fact(), NOT direct emits.
--    After a successful trigger, the effect automatically calls
--    owner:emit_gameplay_fact(event) if the definition specifies an event name.
--    Do not emit manually inside the handler.
--
-- 4. CONTEXT: handler receives { owner, target, payload, args }.
--    target defaults to owner but can be overridden for targeted effects.

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

-- actioneffects.register_effect(definition_or_id, opts?)
--   Registers a named effect definition.  Two call forms:
--     register_effect({ id='name', handler=fn, cooldown_ms=N, event='name', … })
--     register_effect('name', fn)   -- shorthand: handler only, no opts
--   opts (optional second arg) may include:
--     schema   — validate payload before execution
--     validate — extra validation function
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

-- actioneffects.execute(id, context, ...): runs the effect handler directly,
--   bypassing cooldown / tag / grant checks.  Rarely needed in cart code;
--   prefer actioneffectcomponent:trigger() for normal gameplay use.
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
		return (trigger_gate(context, table.unpack((args or {}))))
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
		context.target:play_timeline(anim_id, opts)
	end,
})

local actioneffectcomponent = {}
actioneffectcomponent.__index = actioneffectcomponent
setmetatable(actioneffectcomponent, { __index = component })

-- actioneffectcomponent.new(opts): creates the abilities/effects component.
--   Attach once per object; it manages a set of granted effects + their cooldowns.
--   The component is unique (only one per object allowed).
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

function actioneffectcomponent:tick(dt_ms)
	self.time_ms = self.time_ms + dt_ms
	for id, until_time in pairs(self.cooldown_until) do
		if self.time_ms >= until_time then
			self.cooldown_until[id] = nil
		end
	end
end

-- actioneffectcomponent:grant_effect(id): gives the object access to the
--   named registered effect.  Call when an ability is unlocked or equipped.
function actioneffectcomponent:grant_effect(id)
	local definition = registry.definitions[id]
	self.definitions[definition.id] = definition
end

-- actioneffectcomponent:revoke_effect(id): removes the effect and its cooldown.
--   Call when an ability is lost or unequipped.
function actioneffectcomponent:revoke_effect(id)
	self.definitions[id] = nil
	self.cooldown_until[id] = nil
end

function actioneffectcomponent:has_effect(id)
	return self.definitions[id] ~= nil
end

-- actioneffectcomponent:trigger(id, opts?)
--   Attempts to activate the named effect on this object.
--   opts.payload — passed to the effect handler as context.payload
--   opts.args    — array of extra arguments forwarded to the handler
--   Returns a string result:
--     "ok"          — effect executed successfully
--     "on_cooldown" — effect is cooling down; try again later
--     "blocked"     — effect conditions / tag requirements not met
--     "failed"      — effect id is not granted to this component
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
	local event_type = (outcome and outcome.event) or definition.event
	if event_type ~= nil then
		local event_payload = (outcome and outcome.payload ~= nil) and outcome.payload or payload
		local event = create_owner_event(owner, event_type, event_payload)
		owner:emit_gameplay_fact(event)
	end

	if definition.cooldown_ms and definition.cooldown_ms > 0 then
		self.cooldown_until[id] = now + definition.cooldown_ms
	end
	return "ok"
end

-- actioneffectcomponent:cooldown_remaining(id)
--   Returns remaining cooldown in ms, or nil if the effect is ready.
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
