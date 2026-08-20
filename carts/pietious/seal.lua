local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local input_actioneffect_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local seal<const> = {}
seal.__index = seal

function seal:ctor()
	local command<const> = self.command
	local steps<const> = {}
	for index = 1, #command do
		steps[index] = 'seal_' .. command:sub(index, index) .. '[jp]'
	end
	self:add_component(input_actioneffect_component.new({
		program = {
			bindings = {
				{
					name = 'incantation',
					on = {
						combo = {
							steps = steps,
							cancel = 'seal_character[jp]',
						},
					},
					go = {
						combo = {
							['emit.gameplay'] = {
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
		base = sprite_object,
		defaults = {
			imgid = 'seal',
		},
	})
end

return {
	seal = seal,
	register_seal_definition = register_seal_definition,
}
