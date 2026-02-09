-- collision_profiles.lua
-- simple named collision profile registry for collider2dcomponent

local collision_profiles = {}

local profiles = {}

function collision_profiles.define(name, profile_or_layer, mask)
	if type(profile_or_layer) == "table" then
		profiles[name] = {
			layer = profile_or_layer.layer,
			mask = profile_or_layer.mask,
		}
		return
	end
	if type(profile_or_layer) == "number" and type(mask) == "number" then
		profiles[name] = {
			layer = profile_or_layer,
			mask = mask,
		}
		return
	end
	error("[collision_profiles] define expects (name, {layer,mask}) or (name, layer, mask)")
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

return collision_profiles
