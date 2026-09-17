local clock<const> = require('cartlib/clock')
local custom_visual<const> = require('cartlib/component/custom_visual_component')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local scene<const> = require('cartlib/world/scene')
local system_manager<const> = require('cartlib/world/system_manager')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')

local actor_id<const> = 'cartlib_test.boundary_actor'
prefab.define({ def_id = actor_id, class = {}, base = world_object })

local first<const> = { group = 10, priority = 0, clock_source = clock.frame, method = 'first' }
local last<const> = { group = 20, priority = 0, clock_source = clock.frame, method = 'last' }
local test_system<const> = {}
function test_system.new(owner)
	return setmetatable({ tick_functions = { first, last }, owner = owner }, { __index = test_system })
end
function test_system:first()
	local state<const> = __bmsx_host_test
	assert(not state.receipt.reached, 'admission happened before the update completed')
	state.scene:dispose(function()
		assert(not state.receipt.reached, 'admission escaped into an unload callback')
		-- This teardown owns and commits its own structural barrier. It must
		-- not publish the enclosing update's admission point.
		local nested<const> = scene.new({ objects = {} })
		nested:spawn(actor_id, {})
		nested:dispose()
		assert(not state.receipt.reached, 'nested disposal admitted an external edit')
		state.unloaded = true
	end)
	if state.stop_schedule then self.owner:set_gameplay_clock_running(false) end
end
function test_system:last()
	local state<const> = __bmsx_host_test
	assert(state.unloaded and not state.receipt.reached,
		'between-group publication exposed the remainder of an old schedule')
	state.last_ran = true
end

prefab.define({
	def_id = 'cartlib_test.boundary_visual', class = {}, base = world_object,
	components = { custom_visual.factory({ draw = function(visual)
		local parent<const> = visual.parent
		local state<const> = parent.state
		state.draws = state.draws + 1
		parent:mark_for_disposal()
		assert(parent.world ~= nil and registry:get(parent.id) == parent,
			'render disposed its current visual while command construction was active')
		assert(not state.receipt.reached, 'render admitted an edit before submission')
	end }) },
})

__bmsx_host_test = {}
function __bmsx_host_test.ready() return cartlib_test_ready end
function __bmsx_host_test.setup()
	world:clear()
	local state<const> = __bmsx_host_test
	local manager<const> = system_manager.new(world)
	local update<const> = manager:configure({ test_system }, 20, 20)
	for mode = 1, 2 do
		state.stop_schedule = mode == 2
		state.last_ran = false
		state.unloaded = false
		state.scene = scene.new({ objects = {} })
		local actor<const> = state.scene:spawn(actor_id, {})
		state.receipt = world:request_mutation_boundary()
		local other_receipt<const> = world:request_mutation_boundary()
		assert(other_receipt == state.receipt, 'concurrent waiters did not share one rendezvous')
		update()
		assert(state.receipt.reached and other_receipt.reached and actor.world == nil and state.unloaded,
			'update boundary did not include lifecycle completion')
		assert(state.last_ran == (mode == 1), 'clock change did not terminate the old schedule')
		world:set_gameplay_clock_running(true)
	end
	-- Empty and suspended gameplay schedules must also publish; admission is
	-- independent of whether this pass has any gameplay systems to execute.
	local empty<const>, paused<const> = manager:configure({}, 20, 20)
	local receipt<const> = world:request_mutation_boundary()
	empty()
	assert(receipt.reached, 'empty schedule stranded the request')
	local next_receipt<const> = world:request_mutation_boundary()
	assert(next_receipt ~= receipt and not next_receipt.reached, 'request reused an already completed receipt')
	paused()
	assert(next_receipt.reached, 'paused gameplay schedule stranded the request')

	-- Isolated World fixtures exercise both real render paths and GPU submission.
	for pages = 1, 2 do
		local owner<const> = getmetatable(world).new()
		owner:configure({ framebuffer_count = pages, gameplay_interval_vblanks = 1,
			frame_interval_vblanks = 1, spaces = { 'render_test' }, systems = {} })
		local render_state<const> = { draws = 0, receipt = owner:request_mutation_boundary() }
		local a<const> = owner:spawn('cartlib_test.boundary_visual', { state = render_state })
		local b<const> = owner:spawn('cartlib_test.boundary_visual', { state = render_state })
		owner:render()
		assert(render_state.draws == 2 and render_state.receipt.reached,
			'render skipped a visual or failed to publish its completed boundary')
		assert(a.world == nil and b.world == nil and #owner._objects == 0,
			'render failed to commit its structural mutations')
		owner:clear()
	end
end
function __bmsx_host_test.update() return true end
