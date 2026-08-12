local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
local registry<const> = require('cartlib/registry')

local actioneffects<const> = {}

function actioneffects.register_effect(id, definition)
	actioneffect_component.set_definition(id, definition)
	local components<const> = registry:entries(actioneffect_component)
	for i = 1, #components do
		local actioneffect<const> = components[i]
		if actioneffect.effects[id] ~= nil then
			actioneffect:rebind_effect(id, definition)
		end
	end
end

return actioneffects
