-- collision_profiles.lua
-- simple named collision profile registry for collider2dcomponent

local collision_profiles = {}

local profiles = {}

function collision_profiles.define(name, profile)
	profiles[name] = {
		layer = profile.layer,
		mask = profile.mask,
	}
end

function collision_profiles.get(name)
	return profiles[name]
end

function collision_profiles.apply(collider, name)
	local profile = profiles[name]
	if profile == nil then
		error("[collision_profiles] unknown profile '" .. tostring(name) .. "'")
	end
	collider.layer = profile.layer
	collider.mask = profile.mask
	return collider
end

collision_profiles.define("default", { layer = (1 << 0), mask = 0xFFFFFFFF })
collision_profiles.define("ui", { layer = (1 << 1), mask = (1 << 1) })
collision_profiles.define("player", { layer = (1 << 2), mask = (1 << 0) | (1 << 3) | (1 << 4) })
collision_profiles.define("enemy", { layer = (1 << 3), mask = (1 << 0) | (1 << 2) | (1 << 4) })
collision_profiles.define("projectile", { layer = (1 << 4), mask = (1 << 3) | (1 << 2) })

return collision_profiles
