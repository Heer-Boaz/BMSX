local object_2d<const> = require('cartlib/world/object_2d')
local curtain_component<const> = require('presentation/curtain_component')
local prefab<const> = require('cartlib/world/prefab')

local curtain<const> = { definition_id = 'nemesis_s.presentation.curtain' }
setmetatable(curtain, { __index = object_2d })

function curtain:ctor()
	self.visual = self:get_component(curtain_component)
	self.visual.visible = true
end

function curtain.register()
	prefab.define({
		def_id = curtain.definition_id,
		class = curtain,
		components = { curtain_component.new },
	})
end

return curtain
