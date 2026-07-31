local action_effects<const> = require('cartlib/action_effects')
local aem<const> = require('cartlib/aem')
local collision2d<const> = require('cartlib/collision2d')
local ecs_builtin<const> = require('cartlib/ecs/builtin')
local ecs_pipeline<const> = require('cartlib/ecs/pipeline')
local fsmlibrary<const> = require('cartlib/fsm/library')
local irq<const> = require('cartlib/irq')
local progression<const> = require('cartlib/progression')
local registry_instance<const> = require('cartlib/registry').instance
local world_instance<const> = require('cartlib/world/index').instance

local irq_geo_done_error<const> = 0x0018
local irq_apu<const> = 0x0020

local application<const> = {}

local register_singleton<const> = function(value, id, type_name)
	value.id = id
	value.type_name = type_name
	value.registrypersistent = true
	registry_instance:register(value)
end

function application.reset()
	world_instance:clear()
	ecs_builtin.register_builtin_ecs()
	ecs_pipeline.defaultecspipelineregistry:build(
		world_instance,
		ecs_builtin.default_pipeline_spec()
	)
end

irq.register(irq_geo_done_error, collision2d.on_geo_irq)
irq.register(irq_apu, aem.on_apu_irq)
aem.reload()

register_singleton(
	ecs_pipeline.defaultecspipelineregistry,
	'ecspipeline',
	'ecspipeline'
)
register_singleton(fsmlibrary, 'fsmlibrary', 'fsmlibrary')
register_singleton(progression, 'progression', 'progression')
register_singleton(aem, 'aem', 'aem')
register_singleton(action_effects, 'actioneffects', 'actioneffects')

return application
