local actioneffectcomponent<const> = require('cartlib/actioneffects/actioneffectcomponent')
local registry<const> = require('cartlib/registry')

local actioneffects<const> = {}

function actioneffects.register_effect(id, definition)
	actioneffectcomponent.set_definition(id, definition)
	local components<const> = registry:entries(actioneffectcomponent)
	for i = 1, #components do
		local actioneffect<const> = components[i]
		if actioneffect.effects[id] ~= nil then
			actioneffect:rebind_effect(id, definition)
		end
	end
end

return actioneffects
