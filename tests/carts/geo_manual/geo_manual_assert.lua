local state<const> = require('results')
local result<const>: *geo_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_mask<const>: *word = 0x08000008

rodata expected_vertices: geo_manual_vertex[8] = {
	{ x = 0, y = 0 }, { x = 262144, y = 0 },
	{ x = 262144, y = 262144 }, { x = 0, y = 262144 },
	{ x = 65536, y = 65536 }, { x = 327680, y = 65536 },
	{ x = 327680, y = 327680 }, { x = 65536, y = 327680 },
}
rodata expected_bounds: word[8] = {
	0, 0, 262144, 262144, 65536, 65536, 327680, 327680,
}
rodata expected_processed: word[6] = { 2, 1, 1, 2, 0, 0 }

return {
	kind = 'integration',
	tests = {
		transforms_sat_contacts_and_fault_ack = function(t)
			t:wait_until('GEO phases complete', function()
				return result.completed_phase == 6
			end, 8)
			assert(result.done_count == 5)
			assert(result.error_count == 1)
			assert(result.service_sequence == 6)
			for index = 0, #expected_vertices - 1 do
				assert(result.vertices[index].x == expected_vertices[index].x)
				assert(result.vertices[index].y == expected_vertices[index].y)
			end
			for index = 0, #expected_bounds - 1 do
				assert(result.bounds[index] == expected_bounds[index])
			end
			assert(result.sat.hit == 1)
			assert(result.sat.nx == 0)
			assert(result.sat.ny == 65536)
			assert(result.sat.depth == 196608)
			assert(result.sat.meta == 0)
			for index = 0, 1 do
				assert(result.contacts[index].nx == 0)
				assert(result.contacts[index].ny == -1)
				assert(result.contacts[index].depth == 3)
				assert(result.contacts[index].px == 2.5)
				assert(result.contacts[index].py == 2.5)
				assert(result.contacts[index].piece_a == 0)
				assert(result.contacts[index].piece_b == 0)
				assert(result.contacts[index].feature_meta == 0)
				assert(result.summaries[index].result_count == 1)
				assert(result.summaries[index].exact_pairs == 1)
				assert(result.summaries[index].broadphase_pairs == 1)
				assert(result.summaries[index].flags == 0)
			end
			assert(result.contacts[0].pair_meta == 0x12345678)
			assert(result.contacts[1].pair_meta == 1)
			for index = 0, 5 do
				assert(result.observations[index].processed == expected_processed[index])
				if index == 4 then
					assert(result.observations[index].status == 6)
					assert(result.observations[index].fault == 0x00080000)
				else
					assert(result.observations[index].status == 2)
					assert(result.observations[index].fault == 0)
				end
			end
			assert(result.acknowledged_status == 2)
			assert(result.acknowledged_fault == 0)
			assert((result.final_irq_flags & 0x18) == 0)
			assert((*irq_flags & 0x18) == 0)
			assert(*irq_mask == 0)
			t:log('8 Q16 vertices,2 AABBs,SAT depth00030000; candidate/full F32 contacts (0,-1),depth3,point(2.5,2.5),metadata12345678/1; DONE5/ERROR1; BAD_RECORD_FLAGS00080000,localACK and zero-count recovery')
		end,
	},
}
