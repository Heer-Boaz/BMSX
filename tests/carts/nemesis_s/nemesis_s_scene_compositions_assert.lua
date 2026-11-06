local shallow_copy<const> = require('cartlib/util/shallow_copy')
local registry<const> = require('cartlib/registry')
local atlas<const> = require('cartlib/gx/atlas')
local image<const> = require('cartlib/gx/image')
local gp0<const> = require('cartlib/gx/gp0')
local assert_gameplay_textures<const> = function(hud_sources)
	for _, id in ipairs({ 'gameplay', 'status', 'font' }) do
		assert(atlas.resolve(id)._allocation ~= nil,
			'gameplay admission evicted required texture ' .. id)
	end
	-- Retained HUD packet words must follow atlas relocation across scene reloads.
	for _, source in ipairs(hud_sources) do
		local texture<const> = source._texture
		local source_y<const> = texture.y + source.source_y
		assert(source._blit_draw_mode == gp0.palette4_draw_mode(
			texture.x, source.source_x, source_y, gp0.draw_mode_blend_half)
		and source._blit_uv_word == gp0.uv_clut(
			source.source_x, source_y, texture.clut_x, texture.clut_y),
			'retained HUD source did not follow its current texture allocation')
	end
end
local assert_disposed<const> = function(members)
	for name, member in pairs(members) do
		-- Named runtime slots may already hold the replacement composition.
		assert(member.world == nil and registry:get(member.id) ~= member and #member._components == 0,
		'composition teardown retained ' .. name .. ' in ' .. member.space_id)
	end
end
local fixture<const> = require('tests/carts/nemesis_s/fixture')

return {
	kind = 'integration',
	tests = {
		gameplay_texture_residency = function(t)
			local hud_sources<const> = { image.resolve('status_powerup_empty'), image.resolve('font_9') }
			local director<const> = fixture.start_game(t)
			assert_gameplay_textures(hud_sources)
			local previous<const> = director.gameplay
			director.state_machines:transition_to('/game_start')
			t:wait_until('replacement gameplay textures', function()
				return director.gameplay ~= nil and director.gameplay ~= previous
			end, 30)
			assert_gameplay_textures(hud_sources)
		end,
		scene_compositions = function(t)
			t:wait_until('director admission', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			local test<const> = {}
			local director<const> = registry:get('nemesis_s.director')
			local intro<const> = registry:get('nemesis_s.intro')
			local logo_scene<const> = shallow_copy(intro.presentation.members)
			intro.state_machines:transition_to('/hidden')
			assert_disposed(logo_scene)
			intro.state_machines:transition_to('/playing')
			assert(intro.presentation.members.logo ~= logo_scene.logo and intro.presentation.members.logo.ox == 40,
			'intro reentry did not instantiate fresh authored members')
			intro.state_machines:transition_to('/hidden')
			director.state_machines:transition_to('/story')
			local story<const> = registry:get('nemesis_s.story')
			local panels<const> = shallow_copy(story.presentation.members)
			story.state_machines:transition_to('/hidden')
			assert_disposed(panels)
			story.state_machines:transition_to('/playing')
			assert(story.presentation.members.picture ~= panels.picture,
			'story reentry reused disposed scene members')
			story.state_machines:transition_to('/hidden')
			director.state_machines:transition_to('/game_start')
			director.state_machines:transition_to('/end_demo')
			t:wait_until('ending composition', function() return registry:get('nemesis_s.end_demo') ~= nil end, 30)
			local ending<const> = registry:get('nemesis_s.end_demo')
			do
				local members<const> = shallow_copy(ending.presentation.members)
				ending.state_machines:transition_to('/hidden')
				assert_disposed(members)
				ending.state_machines:transition_to('/playing')
				assert(ending.presentation.members.caption ~= members.caption and ending.presentation.members.caption.oy == 8,
				'end demo reentry did not use a fresh authored caption')
				test.ending = shallow_copy(ending.presentation.members)
				director.state_machines:transition_to('/game_start')

			end
			t:wait_until('gameplay composition', function() return director.gameplay ~= nil end, 30)
			do
				assert_disposed(test.ending)
				local members<const> = director.gameplay.members
				local stage<const> = members.stage
				assert(stage.starfield == members.starfield and members.starfield ~= stage
				and members.status_bar ~= stage and members.game_over_curtain ~= director,
				'gameplay composition hid its visual members inside the controller')
				local player<const> = director.players[1]
				assert(player.start_point == members.player_start_1,
				'player admission did not retain the scene-owned respawn point')
				members.player_start_1:set_position(88, 68)
				player:finish_dying()
				assert(player.ox == 88 and player.oy == 68,
				'respawn discarded the authored start point')
				assert(stage.actor_spawn_count == 179 and stage.actor_spawns[1].options.position.y == 16,
				'stage did not consume its YAML-authored actor placements')
				local first<const> = stage.actor_spawns[1]
				assert(first.options.formation == stage.actor_spawns[6].options.formation
				and first.options.formation ~= stage.actor_spawns[7].options.formation,
				'formation ownership crossed an authored group')
				first.options.formation.remaining = 1
				test.formation = first.options.formation
				-- The placed terrain and its collision queries share one origin.
				stage.total_scroll_px = 128 * 8
				local solid_x<const> = (150 - 1) * 8 - stage.total_scroll_px
				local solid_y<const> = 21 * 8
				assert(stage:is_solid_pixel(solid_x, solid_y), 'fixture must address solid terrain')
				stage:set_global_position(16, 8)
				assert(stage:is_solid_pixel(solid_x + 16, solid_y + 8)
				and stage:first_solid_tile_offset(solid_x + 16, solid_y + 8, 3) == 0
				and stage:first_solid_vertical_tile_offset(solid_x + 16, solid_y + 8, 3, -1) == 0,
				'terrain placement separated rendering from collision coordinates')
				assert(stage:first_solid_tile_offset(0, 0, 3) == 3,
				'a beam outside placed terrain collided with an absent row')
				assert(stage:first_solid_vertical_tile_offset(solid_x + 16, -16, 3, -1) == 0
				and stage:first_solid_vertical_tile_offset(solid_x + 16, 200, 3, 1) == 0,
				'a beam outside placed terrain returned a negative length')
				test.old_gameplay = director.gameplay
				test.old_members = shallow_copy(members)
				test.old_player = player
				-- Use the normal unload/admission boundary, as checkpoint restart does.
				director.state_machines:transition_to('/gameplay')
				director.state_machines:transition_to('/game_start')

			end
			t:wait_until('replacement gameplay composition', function() return director.gameplay ~= test.old_gameplay end, 30)
			assert_disposed(test.old_members)
			assert(#test.old_gameplay.objects.items == 0 and test.old_player.world == nil,
			'gameplay disposal retained dynamically admitted actors')
			local stage<const> = director.gameplay.members.stage
			assert(registry:get(stage.id) == stage,
			'restart did not register the replacement stage')
			assert(stage.actor_spawns[1].options.formation ~= test.formation
			and stage.actor_spawns[1].options.formation.remaining == 6
			and director.players[1].ox == 80 and director.players[1].oy == 60,
			'new run shared formation progress or modified placement with the previous run')

		end,
	},
}
