return {
	kind = 'unit',
	tests = {
		rebind_preserves_progress = function()
			local session_model<const> = require('session')

			local progression<const> = require('cartlib/progression')

			local program<const> = progression.compile_program({ rules = {}, filters = {}, handlers = {} })
			local room<const> = {
				scene_id = 'room',
				rocks = {
					{ member_id = 'kept', options = { item_type = 'health' } },
					{ member_id = 'changed', options = { item_type = 'health' } },
					{ member_id = 'removed', options = { item_type = 'health' } },
				},
				world_entrances = { { options = { target = 'kept' } }, { options = { target = 'removed' } } },
			}
			local state<const> = session_model.new(program, { x = 8, y = 16 }, { room })
			local player<const> = state.player
			player.health = 13
			state.world_boss_defeated[1] = true
			state.world_entrances.kept.state = 'open'
			state.world_entrances.removed.state = 'open'
			for _, rock in ipairs(room.rocks) do
				state.rooms.room.destroyed_rocks[rock.member_id] = true
				state.region_drops['drop.' .. rock.member_id] = { scene_id = 'room', item_type = 'health' }
			end
			local drop<const> = state.region_drops['drop.kept']
			local replacement<const> = {
				scene_id = 'room',
				rocks = {
					room.rocks[1],
					{ member_id = 'changed', options = { item_type = 'money' } },
					{ member_id = 'renamed', options = { item_type = 'health' } },
				},
				world_entrances = { room.world_entrances[1], { options = { target = 'renamed' } } },
			}
			state:rebind_rooms({ replacement })
			assert(state.rooms.room.destroyed_rocks.kept and state.rooms.room.destroyed_rocks.changed, 'stable rock identities lost progress')
			assert(state.rooms.room.destroyed_rocks.removed == nil and state.rooms.room.destroyed_rocks.renamed == nil,
			'renamed or removed rocks retained progress')
			assert(state.region_drops['drop.kept'] == drop and state.region_drops['drop.changed'] == nil
			and state.region_drops['drop.removed'] == nil, 'obsolete drops survived a definition change')
			assert(state.world_entrances.kept.state == 'open' and state.world_entrances.renamed.state == 'closed'
			and state.world_entrances.removed == nil, 'entrances did not follow stable target identity')
			state:rebind_rooms({})
			assert(next(state.rooms) == nil and next(state.region_drops) == nil and next(state.world_entrances) == nil,
			'deleted scene data remained as tombstones')
			state:rebind_rooms({ room })
			assert(next(state.rooms.room.destroyed_rocks) == nil and state.world_entrances.kept.state == 'closed',
			'reintroducing a removed scene resurrected discarded progress')
			assert(state.player == player and player.health == 13 and state.world_boss_defeated[1],
			'room schema replacement changed unrelated player or boss progress')
		end,
	},
}
