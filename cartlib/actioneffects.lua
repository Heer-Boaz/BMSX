local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local world<const> = require('cartlib/world/world')

local actioneffects<const> = {}

function actioneffects.register_effect(id, definition)
	if not actioneffect_component.set_definition(id, definition) then return end
	world:visit_admitted_components(actioneffect_component, function(actioneffect)
		if actioneffect.effects[id] ~= nil then
			actioneffect:rebind_effect(id, definition)
		end
	end)
end

return actioneffects
