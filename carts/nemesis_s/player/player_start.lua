local prefab<const> = require('cartlib/world/prefab')

-- Authored spawn point. The director admits a player here only when that
-- player joins the run; a start point itself has no update or visual.
local player_start<const> = { definition_id = 'nemesis_s.player_start' }

function player_start.register()
	prefab.define({ def_id = player_start.definition_id, class = player_start })
end

return player_start
