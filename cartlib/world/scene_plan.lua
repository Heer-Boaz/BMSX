-- Cold declaration admission. Runtime Scenes consume these retained bindings,
-- never resolving a member's prefab name again during staged construction.
local prefab<const> = require('cartlib/world/prefab')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local scene_plan<const> = {}
local empty_options<const> = {}

function scene_plan.compile(declaration)
	local plan<const> = shallow_copy(declaration)
	local objects<const> = {}
	local members_by_id<const> = {}
	local declared_objects<const> = declaration.objects
	for index = 1, #declared_objects do
		local source<const> = declared_objects[index]
		local member_id<const> = source.member_id
		if members_by_id[member_id] ~= nil then
			error('scene member already declared: ' .. member_id)
		end
		local definition<const> = prefab.definition(source.definition_id)
		if definition == nil then
			error('scene prefab is not registered: ' .. source.definition_id)
		end
		local member<const> = {
			member_id = member_id,
			definition_id = definition.definition_id,
			definition = definition,
			options = shallow_copy(source.options or empty_options),
		}
		objects[index] = member
		members_by_id[member_id] = member
	end
	plan.objects = objects
	plan.members_by_id = members_by_id
	return plan
end

return scene_plan
