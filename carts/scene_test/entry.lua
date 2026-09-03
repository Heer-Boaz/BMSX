module<entry>
local gx_display<const> = require('cartlib/gx/display')
local irq_module<const> = require('cartlib/irq')
local actor<const> = require('actor')
local root_scene<const> = require('root.scene')
local scene_library<const> = require('cartlib/world/scene_library')
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')

local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0

scene_test_object = nil
scene_test_applied_revision = 0
scene_test_pending_revision = 0
scene_test_tombstoned = false
scene_test_dispose_request = 0
scene_test_reload_request = 0
scene_test_runtime_value_request = 0
scene_test_prepare_pending_request = 0
scene_test_commit_pending_request = 0
scene_test_pending_ready = false

local publish_scene_state<const> = function()
	local instance<const> = scene_library.instance(root_scene.id)
	local applied<const>, pending<const> = instance:revisions()
	scene_test_applied_revision = applied
	scene_test_pending_revision = pending
	scene_test_object = instance:object('actor')
	scene_test_tombstoned = instance:tombstoned('actor')
end

local function init<init>()
	actor.register()
	root_scene.register()
	if scene_library.instance(root_scene.id) ~= nil then
		publish_scene_state()
	end
	irq_module.register(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

gx_display.reset_320x240()
world:configure(world_module)
init()
scene_test_object = scene_library.load(root_scene.id):object('actor')
scene_test_object.runtime_value = 73
publish_scene_state()
*irq_mask_register = irq_vblank
*input_control_register = 0x00000001
wait_vblank()

while true do
	if scene_test_dispose_request ~= 0 then
		scene_test_dispose_request = 0
		scene_test_object:mark_for_disposal()
		publish_scene_state()
	elseif scene_test_reload_request ~= 0 then
		scene_test_reload_request = 0
		scene_library.reload(root_scene.id)
		publish_scene_state()
	elseif scene_test_runtime_value_request ~= 0 then
		scene_test_object.runtime_value = scene_test_runtime_value_request
		scene_test_runtime_value_request = 0
		publish_scene_state()
	elseif scene_test_prepare_pending_request ~= 0 then
		scene_test_prepare_pending_request = 0
		world:_open_mutation_barrier()
		root_scene.register_pending_test_revision()
		publish_scene_state()
		scene_test_pending_ready = true
	elseif scene_test_commit_pending_request ~= 0 then
		scene_test_commit_pending_request = 0
		world:_commit_mutation_barrier()
		publish_scene_state()
		scene_test_pending_ready = false
	elseif not scene_test_pending_ready then
		world:update()
	end
	*input_control_register = 0x00000001
	wait_vblank()
	world:render()
end
