-- collision_profiles.lua
-- simple named collision profile registry for collider2dcomponent
--
-- DESIGN PRINCIPLES
--
-- 1. DEFINE ALL PROFILES IN ONE PLACE (e.g. a shared cart module), not inline.
--    Call collision_profiles.define() once at startup for every meaningful
--    layer/mask combination your cart uses. This keeps all bitmask constants
--    in a single authoritative location.
--
--      WRONG — raw bitmask sat in object file:
--        self.collider.layer = (1 << 2)
--        self.collider.mask  = (1 << 0) | (1 << 1)
--
--      RIGHT — named profile, defined once:
--        -- layers.lua:
--        collision_profiles.define('enemy',  { layer = (1<<2), mask = (1<<0)|(1<<1) })
--        -- enemy.lua:
--        self.collider:apply_collision_profile('enemy')
--
-- 2. BUILT-IN PROFILES
--    'default'  — layer=bit0, mask=0xffffffff  (hits everything, default)
--    'ui'       — layer=bit1, mask=bit1         (UI elements only)
--
-- 3. BITMASK LAYOUT CONVENTION (recommended)
--    Assign each logical layer its own bit and document the assignment:
--      bit 0 → 'default' / generic world objects
--      bit 1 → 'ui'
--      bit 2+→ cart-specific layers (player, enemy, projectile, terrain…)

local collision_profiles<const> = {}

local profiles<const> = {}

-- collision_profiles.define(name, {layer, mask})
-- collision_profiles.define(name, layer, mask)
--   Registers a named profile. Errors if layer/mask arguments are missing or wrong type.
--   @cx/@cc-based sprites should always have a profile applied after gfx().
function collision_profiles.define(name, profile_or_layer, mask)
	if type(profile_or_layer) == 'table' then
		profiles[name] = {
			layer = profile_or_layer.layer,
			mask = profile_or_layer.mask,
		}
		return
	end
	if type(profile_or_layer) == 'number' and type(mask) == 'number' then
		profiles[name] = {
			layer = profile_or_layer,
			mask = mask,
		}
		return
	end
	error('[collision_profiles] define expects (name, {layer,mask}) or (name, layer, mask)')
end

-- collision_profiles.get(name): returns {layer, mask} table or nil if not defined.
function collision_profiles.get(name)
	return profiles[name]
end

-- collision_profiles.apply(collider, name)
--   Copies layer and mask from the named profile onto collider. Errors if the
--   profile is not defined. Prefer collider:apply_collision_profile(name) in
--   cart code (which calls this internally).
function collision_profiles.apply(collider, name)
	local profile<const> = profiles[name]
	if profile == nil then
		error('[collision_profiles] unknown profile '' .. tostring(name) .. ''')
	end
	collider.layer = profile.layer
	collider.mask = profile.mask
	return collider
end

collision_profiles.define('default', { layer = (1 << 0), mask = 0xffffffff })
collision_profiles.define('ui', { layer = (1 << 1), mask = (1 << 1) })

return collision_profiles
