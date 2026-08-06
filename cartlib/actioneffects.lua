local actioneffectcomponent<const> = require('cartlib/actioneffects/actioneffectcomponent')
local registry<const> = require('cartlib/registry')

local actioneffects<const> = {}

actioneffects.effect_type = {
	spawn = 'spawn',
	despawn = 'despawn',
	damage = 'damage',
	heal = 'heal',
	move = 'move',
	play_sound = 'play_sound',
	play_animation = 'play_animation',
	emit_event = 'emit_event',
}

function actioneffects.register_effect(id, definition)
	actioneffectcomponent.set_definition(id, definition)
	local components<const> = registry:components(actioneffectcomponent)
	for i = 1, #components do
		local actioneffect<const> = components[i]
		if actioneffect.effects[id] ~= nil then
			actioneffect:rebind_effect(id, definition)
		end
	end
end

actioneffects.register_effect(actioneffects.effect_type.move, {
	handler = function(owner, _payload, dx, dy)
		owner.x = owner.x + dx
		owner.y = owner.y + dy
	end,
})

actioneffects.register_effect(actioneffects.effect_type.play_animation, {
	handler = function(owner, _payload, animation_id, options)
		owner.timelines:play(animation_id, options)
	end,
})

return actioneffects
