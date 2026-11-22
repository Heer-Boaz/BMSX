local event_emitter<const> = require('cartlib/event_emitter')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local fixture<const> = require('tests/carts/pietious/fixture')
require('constants')

local foe_count<const> = function(room)
	local count = 0
	for i = 1, #room.enemies do
		if room.scene.members[room.enemies[i].member_id] ~= nil then
			count = count + 1
		end
	end
	return count
end

local move_to_right_edge<const> = function(t, castle, player)
	local room<const> = castle.room
	local _<const>, floor_y<const> = room:tile_to_world(31, 12)
	player.state_machines:transition_to('/quiet')
	player:set_global_position(room.world_width - player.width - 2, floor_y - player.height)
	t:down('ArrowRight')
	t:wait_until('actual right edge enters room 2', function()
		return castle.current_room_number == 2 and world.active_space_id == 'transition'
	end, 30)
	t:up('ArrowRight')
end

return {
	kind = 'integration',
	tests = {
		room_admission_before_reveal = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			local outgoing<const> = castle.room
			local trace<const> = { enter = 0, switched = 0, revealed = 0 }
			castle.events:on({
				event = 'room.enter', subscriber = trace,
				handler = function(self, _event_type, _emitter, payload)
					assert(payload.room_number == 2 and not payload.suppress_room_music)
					self.enter = self.enter + 1
				end,
			})
			player.events:on({
				event = 'room.switched', subscriber = trace,
				handler = function(self, _event_type, _emitter, payload)
					assert(self.enter == 1 and payload.from == 1 and payload.to == 2 and payload.dir == 'right')
					assert(player.room == castle.room and payload.x == player.room.tile_size,
						'player arrival must happen on the original room switch boundary')
					assert(foe_count(castle.room) == 0, 'independent actors must not be constructed at the edge')
					assert(castle.room.scene.members.rock_002_01 ~= nil and castle.room.scene.members.rock_002_02 ~= nil,
						'rocks must retain their ordinary construction')
					self.switch_revision = world._update_revision
					self.switched = self.switched + 1
				end,
			})
			director.events:on({
				event = 'room', subscriber = trace,
				handler = function(self)
					assert(foe_count(castle.room) == 3, 'revealing a partially prepared room')
					self.reveal_revision = world._update_revision
					self.revealed = self.revealed + 1
				end,
			})
			move_to_right_edge(t, castle, player)
			local room<const> = castle.room
			local counts<const> = {}
			-- The switch callback already witnessed zero. Observe each
			-- construction wave across the following black display frames.
			local previous = 0
			for _ = 1, 2 * flow_room_switch_wait_frames do
				if world.active_space_id ~= 'transition' then break end
				local count<const> = foe_count(room)
				if count ~= previous then
					counts[#counts + 1] = count
					previous = count
				end
				for i = 1, count do
					local foe<const> = room.scene.members[room.enemies[i].member_id]
					assert(registry:get(foe.id) == foe, 'foe escaped its World admission boundary')
					assert(foe.flight_direction_ticks == nil, 'foe ran gameplay before its room was visible')
				end
				t:wait_ticks(1)
			end
			assert(#counts == 3 and counts[1] == 1 and counts[2] == 2 and counts[3] == 3,
				'expected three distinct black updates for the three authored bats, observed ' .. table.concat(counts, ','))
			assert(trace.enter == 1 and trace.switched == 1 and trace.revealed == 1,
				'a staged switch repeated or lost a room event')
			assert(trace.reveal_revision - trace.switch_revision == flow_room_switch_wait_frames - 1,
				'room readiness lengthened the existing black wait')
			assert(outgoing.scene.closed and outgoing.world == nil, 'old room retained behind the transition')
			event_emitter:remove_subscriber(trace)

			player.state_machines:transition_to('/quiet')
			local _<const>, floor_y<const> = room:tile_to_world(2, 12)
			player:set_global_position(room.tile_size + 2, floor_y - player.height)
			t:down('ArrowLeft')
			t:wait_until('left edge returns to empty room 1', function()
				return castle.current_room_number == 1 and world.active_space_id == 'transition'
			end, 30)
			t:up('ArrowLeft')
			t:wait_until('room 1 revealed', function() return world.active_space_id == 'main' end, 16)
			assert(room.world == nil and #room.scene.objects.items == 0 and castle.room.player == player,
				'left return retained staged actors or replaced the traveller')
		end,
		new_game_retires_incomplete_room = function(t)
			local director<const>, castle<const>, player<const> = fixture.start_game(t)
			move_to_right_edge(t, castle, player)
			local room<const> = castle.room
			t:wait_until('first batch is admitted', function() return foe_count(room) == 1 end, 8)
			local foe<const> = room.scene.members[room.enemies[1].member_id]
			assert(world.active_space_id == 'transition')
			director.request_new_game()
			t:wait_until('fresh game revealed', function()
				return registry:get('d') ~= director and registry:get('d') ~= nil and world.active_space_id == 'main'
			end, 24)
			t:wait_ticks(12)
			assert(room.scene.closed and room.world == nil and #room.scene.objects.items == 0)
			assert(registry:get(foe.id) == nil and registry:get('c').current_room_number == 1,
				'abandoned room batches escaped into the fresh world')
		end,
		vertical_edge_keeps_immediate_room = function(t)
			local _director<const>, castle<const>, player<const> = fixture.start_game(t)
			castle:switch_room('right')
			local room<const> = castle.room
			assert(foe_count(room) == 3, 'explicit castle switch should not require a director wait')
			player.state_machines:transition_to('/quiet')
			local x<const> = room:tile_to_world(27, 20)
			player:set_global_position(x, room.world_height - player.height + 1)
			assert(player:switch_vertical_room_from_position())
			assert(castle.current_room_number == 11 and player.room == castle.room
				and foe_count(castle.room) == 4, 'vertical arrival left some authored enemies deferred')
		end,
	},
}
