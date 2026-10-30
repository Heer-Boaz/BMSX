-- Named constructor inputs are immutable definition data, not object state or
-- reflected component mutations. Each constructor consumes its own local slot.
local shallow_copy<const> = require('cartlib/util/shallow_copy')
local component_inputs<const> = { empty = {} }

function component_inputs.merge(defaults, overrides)
	if overrides == nil then
		return defaults
	end
	local inputs<const> = shallow_copy(defaults)
	for id_local, values in pairs(overrides) do
		local combined<const> = shallow_copy(defaults[id_local] or component_inputs.empty)
		for key, value in pairs(values) do
			combined[key] = value
		end
		inputs[id_local] = combined
	end
	return inputs
end

return component_inputs
