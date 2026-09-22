local world<const> = require('cartlib/world/world')
local registry<const> = require('cartlib/registry')
local record_lithograph_exit<const> = function(test, _event_type, _emitter, payload)
	test.exit_payload = payload
end
local fixture<const> = require('tests/carts/pietious/fixture')

return {
	kind = 'integration',
	tests = {
		lithograph_audio_restore = function(t)
			local director<const> = fixture.start_game(t)
			local state_machines<const> = director.state_machines
			local test<const> = {}
			test.viewing_state = state_machines:bind_state_path('/lithograph/viewing')
			director.events:on({
				event = 'lithograph_exit_done',
				subscriber = test,
				handler = record_lithograph_exit,
			})
			registry:get('pietolon').events:emit('lithograph.request', {
				text_line = 'TEST',
			})

			t:wait_until('lithograph viewing', function() return state_machines:matches_state(test.viewing_state) end, 120)
			assert(
			registry:get('lithograph').text_component.background_color == 0xff000000,
			'lithograph text cells did not retain their opaque Graphic 2 background'
			)
			state_machines:transition_to('/lithograph/closing')

			t:wait_until('lithograph closed', function() return world.active_space_id == 'main' end, 120)
			local payload<const> = test.exit_payload
			assert(payload ~= nil, 'lithograph exit did not publish room music state')
			assert(payload.world_number == registry:get('c').room.world_number, 'lithograph exit published the wrong world')
			assert(not payload.suppress_room_music, 'lithograph exit suppressed room music')

		end,
	},
}
