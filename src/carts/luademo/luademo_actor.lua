local LuaDemoActor = LuaDemoActor or {}

local function clamp(value, min_value, max_value)
	if value < min_value then
		return min_value
	end
	if value > max_value then
		return max_value
	end
	return value
end

local function ensure_behavior(target)
	local behavior = target.behavior
	if not behavior then
		behavior = {}
		target.behavior = behavior
	end
	if behavior.mode == nil then
		behavior.mode = 'idle'
	end
	if behavior.hue == nil then
		behavior.hue = 10
	end
	if behavior.pulse == nil then
		behavior.pulse = 0
	end
	if behavior.iteration == nil then
		behavior.iteration = 0
	end
	if behavior.interval == nil then
		behavior.interval = 0
	end
	if behavior.status == nil then
		behavior.status = ''
	end
	return behavior
end

function LuaDemoActor:create(actor)
	actor.visible = true
	actor.behavior = nil
	LuaDemoActor.resetbehavior(actor)
end

function LuaDemoActor:resetbehavior()
	local behavior = ensure_behavior(self)
	behavior.mode = 'priming'
	behavior.hue = 10
	behavior.pulse = 0
	behavior.iteration = 0
	behavior.interval = 0
	behavior.status = 'Booting behavior tree'
	return behavior
end

function LuaDemoActor:setmode(mode)
	local behavior = ensure_behavior(self)
	behavior.mode = mode or 'idle'
end

function LuaDemoActor:sethue(hue)
	local behavior = ensure_behavior(self)
	local next_hue = hue or 0
	behavior.hue = clamp(math.floor(next_hue + 0.5), 0, 15)
end

function LuaDemoActor:setbehaviorstatus(text)
	local behavior = ensure_behavior(self)
	if text == nil then
		behavior.status = ''
	else
		behavior.status = tostring(text)
	end
end

function LuaDemoActor:adjustpulse(delta)
	local behavior = ensure_behavior(self)
	local amount = delta or 0
	local next_value = clamp((behavior.pulse or 0) + amount, 0, 1)
	behavior.pulse = next_value
	return next_value
end

function LuaDemoActor:setcurrentinterval(interval)
	local behavior = ensure_behavior(self)
	local next_interval = interval or 0
	if next_interval < 0 then
		next_interval = 0
	end
	behavior.interval = math.floor(next_interval + 0.5)
end

function LuaDemoActor:incrementiteration()
	local behavior = ensure_behavior(self)
	local next_value = (behavior.iteration or 0) + 1
	behavior.iteration = next_value
	return next_value
end

register_worldobject({
	id = 'LuaDemoActor',
	class = LuaDemoActor,
	bts = {
		{ id = 'lua_demo_bt', auto_tick = true },
	},
})
