local state<const> = require('results')
local assets<const> = require('assets')
local result<const>: *geo_scene_result = state.result
local local_hull<const>: *geo_scene_vertex = assets.local_hull
local translations<const>: *word = assets.translations
local pixels<const>: *u16[64][64] = state.sprite_pixels
local framebuffer<const>: *word = 0x0801035c

return {
	kind = 'integration',
	tests = {
		three_pose_geometry_and_visible_scene_sequence = function(t)
			t:wait_until('all scenes published including separated return', function()
				return result.completed_phase == 6
			end, 120)
			assert(result.prepared_poses == 3)
			assert(result.geo_sequence == 10)
			assert(result.geo_errors == 0)
			assert(result.system_origin == 0x02d002c0)
			assert(result.system_size == 0x00fc0140)
			assert(sizeof(geo_scene_polygon) == 96)
			assert(result.polygon.kind == 3)
			assert(result.polygon.vertex_count == 8)
			assert(result.polygon.data_offset == 32)
			assert(result.polygon.bounds_offset == 16)
			for pose_index = 0, 2 do
				local pose<const>: *geo_scene_pose = &result.poses[pose_index]
				for vertex = 0, 7 do
					assert(pose.world[vertex].x == local_hull[vertex].x)
					assert(pose.world[vertex].y == local_hull[vertex].y)
					assert(pose.world[vertex + 8].x == local_hull[vertex].x + (translations[pose_index] << 16))
					assert(pose.world[vertex + 8].y == local_hull[vertex].y)
					assert(result.polygon.vertices[vertex].x == local_hull[vertex].x / 65536)
					assert(result.polygon.vertices[vertex].y == local_hull[vertex].y / 65536)
				end
				assert(pose.bounds[0] == 0)
				assert(pose.bounds[1] == 0)
				assert(pose.bounds[2] == 16 << 16)
				assert(pose.bounds[3] == 16 << 16)
				assert(pose.bounds[4] == translations[pose_index] << 16)
				assert(pose.bounds[5] == 0)
				assert(pose.bounds[6] == (translations[pose_index] + 16) << 16)
				assert(pose.bounds[7] == 16 << 16)
				assert(pose.instances[0].tx == 0)
				assert(pose.instances[1].tx == translations[pose_index])
				assert(pose.instances[0].shape == &result.polygon)
				assert(pose.instances[1].shape == &result.polygon)
				for job = 0, 2 do
					assert(pose.jobs[job].status == 2)
					assert(pose.jobs[job].fault == 0)
					if job == 0 then
						assert(pose.jobs[job].processed == 2)
					else
						assert(pose.jobs[job].processed == 1)
					end
				end
				assert(pose.sat.ny == 0)
				assert(pose.summary.broadphase_pairs == 1)
				assert(pose.summary.flags == 0)
			end
			assert(result.poses[0].sat.hit == 0)
			assert(result.poses[0].sat.nx == 0)
			assert(result.poses[0].sat.depth == 0)
			assert(result.poses[0].sat.meta == 0)
			assert(result.poses[0].summary.result_count == 0)
			assert(result.poses[0].summary.exact_pairs == 0)
			assert(result.poses[1].sat.hit == 1)
			assert(result.poses[1].sat.nx == 65536)
			assert(result.poses[1].sat.depth == 0)
			assert(result.poses[1].sat.meta == 2)
			assert(result.poses[1].summary.result_count == 0)
			assert(result.poses[1].summary.exact_pairs == 1)
			assert(result.poses[2].sat.hit == 1)
			assert(result.poses[2].sat.nx == 65536)
			assert(result.poses[2].sat.depth == 4 << 16)
			assert(result.poses[2].sat.meta == 2)
			assert(result.poses[2].summary.result_count == 1)
			assert(result.poses[2].summary.exact_pairs == 1)
			assert(result.poses[2].contact.nx == -1)
			assert(result.poses[2].contact.ny == 0)
			assert(result.poses[2].contact.depth == 4)
			assert(result.poses[2].contact.px == 14)
			assert(result.poses[2].contact.py == 8)
			assert(result.poses[2].contact.piece_a == 0)
			assert(result.poses[2].contact.piece_b == 0)
			assert(result.poses[2].contact.feature_meta == 2)
			assert(result.poses[2].contact.pair_meta == 0x44524f4e)
			assert(result.return_summary.result_count == 0)
			assert(result.return_summary.exact_pairs == 0)
			assert(result.return_summary.broadphase_pairs == 1)
			assert(result.return_summary.flags == 0)
			assert(result.return_job.status == 2)
			assert(result.return_job.processed == 1)
			assert(result.return_job.fault == 0)
			-- The old contact bytes are still present, but no new contact was drawn.
			assert(result.contact_output.nx == -1)
			assert(result.contact_output.depth == 4)
			assert(result.contact_output.px == 14)
			assert(result.contact_output.py == 8)
			for scene = 0, 5 do
				assert(result.after_vblank[scene] > result.before_vblank[scene])
				assert(result.programmed_framebuffer[scene] == 0x000fa000 | ((scene & 1) << 6))
				if scene == 4 then
					assert(result.contact_drawn[scene] == 1)
				else
					assert(result.contact_drawn[scene] == 0)
				end
			end
			assert(*framebuffer == 0x000fa040)
			assert(pixels[0][0] == 0)
			assert(pixels[0][16] == 0x6318)
			assert(pixels[24][28] == 0x8000)
			assert(pixels[63][63] == 0)
			t:log('3 retained octagon poses: separated / SAT touching (depth 0, no F32 contact) / overlapping (depth 4, point 14,8); SAT A-to-B and F32 B-to-A; retained old contact with new count 0 is not drawn; 6 fresh VBlank publications')
		end,
	},
}
