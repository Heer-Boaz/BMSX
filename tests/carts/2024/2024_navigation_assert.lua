local registry<const> = require('cartlib/registry')
local controller_id<const> = 'quiz'
local portrait_id<const> = 'sint'
local last_question_index<const> = 27
return {
	kind = 'integration',
	tests = {
		quiz_navigation = function(t)
			t:wait_until('quiz admission', function() return registry:get(controller_id) ~= nil and registry:get(portrait_id) ~= nil end, 120)
			local test<const> = {}
			local controller<const> = registry:get(controller_id)
			test.intro_state = controller.state_machines:bind_state_path('/intro')
			test.question_state = controller.state_machines:bind_state_path('/question')
			test.complete_state = controller.state_machines:bind_state_path('/complete')
			assert(controller.state_machines:matches_state(test.intro_state), 'quiz did not start on the introduction')
			assert(registry:get(portrait_id).sprite_component.imgid == 'quiz', 'introduction portrait mismatch')

			t:press('KeyA', 2)
			local state_machines<const> = controller.state_machines
			t:wait_until('first question', function() return state_machines:matches_state(test.question_state) end, 30)
			assert(controller.current_question_index == 1, 'quiz did not start at question 1')
			t:press('ArrowLeft', 2)
			t:wait_until('introduction', function() return state_machines:matches_state(test.intro_state) end, 30)
			assert(registry:get(portrait_id).sprite_component.imgid == 'quiz', 'introduction retained question portrait')
			t:press('ArrowRight', 2)
			t:wait_until('right enters first question', function() return state_machines:matches_state(test.question_state) end, 30)
			assert(controller.current_question_index == 1, 'right changed first question index')
			controller:present_question(last_question_index)
			assert(state_machines:matches_state(test.question_state), 'last-question setup left question state')
			assert(controller.current_question_index == last_question_index, 'last-question setup changed index')
			t:press('ArrowRight', 2)
			t:wait_until('conclusion', function() return state_machines:matches_state(test.complete_state) end, 30)
			assert(registry:get(portrait_id).sprite_component.imgid == 'klaar', 'conclusion portrait mismatch')
			t:press('ArrowLeft', 2)
			t:wait_until('return to last question', function() return state_machines:matches_state(test.question_state) end, 30)
			assert(controller.current_question_index == last_question_index, 'conclusion returned to wrong question')
			assert(registry:get(portrait_id).sprite_component.imgid == 'hmm', 'last-question portrait mismatch')
		end,
	},
}
