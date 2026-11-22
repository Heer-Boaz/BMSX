local registry<const> = require('cartlib/registry')
local story_scene<const> = require('scenes/story')
local world<const> = require('cartlib/world/world')

return {
	kind = 'integration',
	tests = {
		venom_portrait_and_curtain_boundaries = function(t)
			t:wait_until('director admission', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			t:at_boundary(world:request_mutation_boundary(), 30)
			local director<const> = registry:get('nemesis_s.director')
			director.state_machines:transition_to('/story')
			local story<const> = registry:get('nemesis_s.story')
			story.state_machines:transition_to('/playing/slide_6')
			local members<const> = story.presentation.members
			local portrait<const> = members.picture.sprite_component
			local curtain<const> = members.curtain.visual
			local secondary<const> = members.secondary_caption.text_component
			local id<const> = 'nemesis_s.story.slide.6'
			local entry<const> = story.timelines:seek(id, 125)
			assert(entry.last_frame == 1013 and portrait.imgid == nil and secondary.glyph_visible_height == 0)
			story.timelines:advance_to(id, 126)
			assert(portrait.imgid == story_scene.portrait_imgid and curtain.opening_start == 126
				and curtain.opening_end == 110, 'portrait and opening split one authored edge')
			story.timelines:advance_to(id, 125)
			assert(portrait.imgid == nil, 'reverse crossing did not restore the hidden portrait')
			story.timelines:seek(id, 158)
			assert(curtain.opening_start == 78 and curtain.opening_end == 62)
			story.timelines:seek(id, 329)
			assert(curtain.opening_end == 110)
			story.timelines:advance_to(id, 330)
			assert(curtain.opening_end == 109)
			story.timelines:seek(id, 630)
			assert(curtain.opening_end == 4)
			story.timelines:seek(id, 651)
			assert(secondary.glyph_visible_height == 1)
			story.timelines:seek(id, 663)
			assert(secondary.glyph_visible_height == nil)
			story.timelines:seek(id, 961)
			assert(curtain.count == 1)
		end,

		title_lights_and_signed_lift = function(t)
			t:wait_until('director admission', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			t:at_boundary(world:request_mutation_boundary(), 30)
			local director<const> = registry:get('nemesis_s.director')
			director.state_machines:transition_to('/title')
			local title<const> = registry:get('nemesis_s.title_screen')
			title.state_machines:transition_to('/idle')
			local members<const> = title.presentation.members
			local idle<const> = 'nemesis_s.title_screen.idle'
			local entry<const> = title.timelines:seek(idle, 8)
			assert(entry.last_frame == 23 and members.selector.visible == true
				and members.background.sprite_component.imgid == members.background.images[2])
			title.timelines:seek(idle, 11)
			title.timelines:advance_to(idle, 12)
			assert(members.selector.visible == false
				and members.background.sprite_component.imgid == members.background.images[1])
			title.timelines:advance_to(idle, 11)
			assert(members.selector.visible == true
				and members.background.sprite_component.imgid == members.background.images[2])
			title.state_machines:transition_to('/startup/flight/lift')
			local hangar<const> = title.presentation.members
			local lights<const> = 'nemesis_s.title_screen.hangar'
			local lift<const> = 'nemesis_s.title_screen.lift'
			title.timelines:seek(lights, 20)
			assert(hangar.background.sprite_component.imgid == hangar.background.images[2])
			title.timelines:advance_to(lights, 21)
			assert(hangar.background.sprite_component.imgid == hangar.background.images[1])
			title.timelines:seek(lift, 13)
			assert(hangar.ship.sprite_component.presentation_oy == -16 and hangar.ship.burst.presentation_oy == -16)
			title.timelines:advance_to(lift, 12)
			assert(hangar.ship.sprite_component.presentation_oy == -8 and hangar.ship.burst.presentation_oy == -8)
		end,
	},
}
