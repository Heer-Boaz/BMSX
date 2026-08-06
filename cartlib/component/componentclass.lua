local componentclass<const> = {}
local class_chain_by_class<const> = {}

-- Component module tables are the runtime class identities. Cache each static
-- inheritance chain once so structural indexes never rediscover it per frame.
function componentclass.chain(component_class)
	local chain<const> = class_chain_by_class[component_class]
	if chain then
		return chain
	end
	local created<const> = {}
	local class = component_class
	while class ~= nil do
		created[#created + 1] = class
		local class_metatable<const> = getmetatable(class)
		class = class_metatable and class_metatable.__index
	end
	class_chain_by_class[component_class] = created
	return created
end

return componentclass
