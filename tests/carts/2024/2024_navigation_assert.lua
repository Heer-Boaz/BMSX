local registry<const> = require('cartlib/registry')

local controller_id<const> = 'quiz'
local portrait_id<const> = 'sint'
local last_question_index<const> = 27

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return registry:get(controller_id) ~= nil and registry:get(portrait_id) ~= nil
end

function __bmsx_host_test.setup()
	local test<const> = __bmsx_host_test
	local controller<const> = registry:get(controller_id)
	test.intro_state = controller.state_machines:bind_state_path('/intro')
	test.question_state = controller.state_machines:bind_state_path('/question')
	test.complete_state = controller.state_machines:bind_state_path('/complete')
	assert(controller.state_machines:matches_state(test.intro_state), 'quiz did not start on the introduction')
	assert(registry:get(portrait_id).sprite_component.imgid == 'quiz', 'introduction portrait mismatch')
	test.phase = 'started'
	return host.press('KeyA', 2)
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local controller<const> = registry:get(controller_id)
	local state_machines<const> = controller.state_machines
	if test.phase == 'started' then
		assert(state_machines:matches_state(test.question_state), 'accept did not open the first question')
		assert(controller.current_question_index == 1, 'quiz did not start at question 1')
		test.phase = 'returned_intro'
		return host.press('ArrowLeft', 2)
	end
	if test.phase == 'returned_intro' then
		assert(state_machines:matches_state(test.intro_state), 'left from question 1 did not return to the introduction')
		assert(registry:get(portrait_id).sprite_component.imgid == 'quiz', 'returning to the introduction retained the question portrait')
		test.phase = 'right_started'
		return host.press('ArrowRight', 2)
	end
	if test.phase == 'right_started' then
		assert(state_machines:matches_state(test.question_state), 'right from the introduction did not open question 1')
		assert(controller.current_question_index == 1, 'right from the introduction changed the question index')
		controller:present_question(last_question_index)
		test.phase = 'last_question_release'
		return false
	end
	if test.phase == 'last_question_release' then
		assert(state_machines:matches_state(test.question_state), 'last-question setup left the question state')
		assert(controller.current_question_index == last_question_index, 'last-question setup changed the question index')
		test.phase = 'last_question_ready'
		return false
	end
	if test.phase == 'last_question_ready' then
		test.phase = 'completed'
		return host.press('ArrowRight', 2)
	end
	if test.phase == 'completed' then
		assert(state_machines:matches_state(test.complete_state), 'right from the last question did not open the conclusion')
		assert(registry:get(portrait_id).sprite_component.imgid == 'klaar', 'conclusion portrait mismatch')
		test.phase = 'returned_last_question'
		return host.press('ArrowLeft', 2)
	end
	assert(state_machines:matches_state(test.question_state), 'left from the conclusion did not return to the last question')
	assert(controller.current_question_index == last_question_index, 'conclusion returned to the wrong question')
	assert(registry:get(portrait_id).sprite_component.imgid == 'hmm', 'last-question portrait mismatch after returning from the conclusion')
	return true
end
