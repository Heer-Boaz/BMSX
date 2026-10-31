local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local input_actioneffect_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local seal<const> = {}
seal.__index = seal
setmetatable(seal, { __index = sprite_object })

function seal:ctor()
	self:add_component(input_actioneffect_component.new(self, {
		program = {
			bindings = {
				{
					name = 'incantation',
					on = {
						combo = {
							keyboard = self.command,
						},
					},
					go = {
						combo = {
							['emit.event'] = {
								event = 'seal.incantation_completed',
							},
						},
					},
				},
			},
		},
	}))
end

local register_seal_definition<const> = function()
	prefab.define({
		def_id = 'seal',
		class = seal,
		defaults = {
			order = 23,
			imgid = 'seal',
		},
	})
end

return {
	seal = seal,
	register_seal_definition = register_seal_definition,
}
