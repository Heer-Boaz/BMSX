local fixture<const> = require('tests/carts/nemesis_s/fixture')
local registry<const> = require('cartlib/registry')
local rom_dir<const> = require('cartlib/rom_dir')
local world<const> = require('cartlib/world/world')
local transition_recorder<const> = require('testlib/fsm/transition_recorder')
require('constants')
local apu_slot<const>: *word = 0x08000148
local selected_apu_source<const>: *word = 0x0800018c
local apu_active_mask<const>: *word = 0x08000190
local music_slot_mask<const> = 0x00000002
local stage_music_source<const> = rom_dir.audio('music_stage_intro').addr
local pause_source<const> = rom_dir.audio('nemesis2_pause').addr
local read_slot_source<const> = function(slot)
	*apu_slot = slot
	return *selected_apu_source
end
return { kind = 'integration', tests = { input_pause_retains_simulation_and_music = function(t)
			local director<const>, stage<const>, player<const> = fixture.start_game(t, 2)
			local player_2<const> = director.players[2]
			local running_state<const> = director.state_machines:bind_state_path('/gameplay/running')
			local pause_state<const> = director.state_machines:bind_state_path('/gameplay/pause')
			t:wait_until('stage intro music', function() return read_slot_source(1) == stage_music_source end, 120)
			local recorder<const> = transition_recorder.new(director.state_machines:get_machine(ids_director_fsm), 32)
			t:observe_fsm_transitions(recorder)
			t:press('start', 4, 2)
			t:wait_until('player two pauses', function() return director.state_machines:matches_state(pause_state) and not world.gameplay_clock_running end, 120)
			local test<const> = {}
			assert(world.active_space_id == 'main', 'pause changed the retained gameplay space')
			test.stage = stage
			test.player = player
			test.player_2 = player_2
			test.gameplay_time_ms = world.gameplay_time_ms
			test.stage_tape_head = stage.tape_head
			test.stage_scroll_px = stage.total_scroll_px
			test.stage_scroll_gate = stage.scroll_gate
			test.player_frame = player.frame
			test.player_x = player.x
			test.player_y = player.y
			test.player_visual_visible = player.vessel_visual.visible

			for _ = 1, 12 do
				assert(not world.gameplay_clock_running, 'pause resumed the gameplay schedule')
				assert(world.gameplay_time_ms == test.gameplay_time_ms,
				'gameplay time advanced while the gameplay clock was suspended')
				assert(director.stage == test.stage
				and director.players[1] == test.player
				and director.players[2] == test.player_2,
				'pause replaced the retained gameplay objects')
				assert(stage.tape_head == test.stage_tape_head
				and stage.total_scroll_px == test.stage_scroll_px
				and stage.scroll_gate == test.stage_scroll_gate,
				'stage simulation advanced during pause')
				assert(player.frame == test.player_frame
				and player.x == test.player_x
				and player.y == test.player_y,
				'player simulation advanced during pause')
				assert(player.vessel_visual.visible == test.player_visual_visible,
				'pause changed the retained gameplay presentation')
				assert(read_slot_source(1) == stage_music_source
				and (*apu_active_mask & music_slot_mask) ~= 0,
				'pause discarded the retained music voice')
				if read_slot_source(0) == pause_source then
					test.saw_pause_sound = true
				end

				t:wait_ticks(1)
			end
			assert(test.saw_pause_sound, 'pause did not play the XNA pause sound')
			t:press('F1', 4)
			t:wait_until('keyboard resumes', function() return director.state_machines:matches_state(running_state) and world.gameplay_clock_running end, 120)
			assert(world.active_space_id == 'main'
			and director.stage == test.stage
			and director.players[1] == test.player
			and director.players[2] == test.player_2,
			'resume rebuilt the retained gameplay scene')
			assert(read_slot_source(1) == stage_music_source
			and (*apu_active_mask & music_slot_mask) ~= 0,
			'resume restarted or discarded the retained music voice')

			local resumed_player_frame<const> = player.frame
			local previous_time = world.gameplay_time_ms
			local gameplay_updates = 0
			for _ = 1, 120 do
				t:wait_ticks(1)
				if world.gameplay_time_ms ~= previous_time then
					previous_time = world.gameplay_time_ms
					gameplay_updates = gameplay_updates + 1
				end
			end
			assert(gameplay_updates == 50, '5/6 gameplay clock did not admit 50 fixed steps over 60 world updates')
			assert(player.frame > resumed_player_frame, 'player did not resume simulation')
			recorder:dispose()

		end, }, }
