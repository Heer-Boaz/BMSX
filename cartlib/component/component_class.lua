local component_class<const> = {}
local class_chain_by_class<const> = {}
local class_word_by_class<const> = {}
local next_class_word = 0

-- Component module tables are the runtime class identities. Cache each static
-- inheritance chain once so structural indexes never rediscover it per frame.
function component_class.chain(component_class)
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

-- Studio and other machine-word consumers receive a guest-owned class word;
-- host object identity never crosses the cartridge bus.
function component_class.word(component_class)
	local word<const> = class_word_by_class[component_class]
	if word ~= nil then
		return word
	end
	next_class_word = next_class_word + 1
	class_word_by_class[component_class] = next_class_word
	return next_class_word
end

return component_class
