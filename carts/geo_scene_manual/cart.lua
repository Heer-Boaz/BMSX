module<entry>

local state<const> = require('results')
local assets<const> = require('assets')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *geo_scene_result = state.result
local pixels<const>: *u16[64][64] = state.sprite_pixels
local indices<const>: *u8[16][16] = assets.drone_indices
local palette<const>: *u16 = assets.drone_palette
local local_hull<const>: *geo_scene_vertex = assets.local_hull
local translations<const>: *word = assets.translations
local src<const>: *geo_scene_sources = 0x08000024
local param<const>: *geo_scene_parameters = 0x08000048
local command<const>: *word = 0x0800003c
local status<const>: *word = 0x08000044
local processed<const>: *word = 0x0800005c
local fault<const>: *word = 0x08000060
local fault_ack<const>: *word = 0x08010224
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_origin<const>: *word = 0x08010364
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

function irq(flags)
	if (flags & 0x04) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	if (flags & 0x18) ~= 0 then
		result.geo_sequence = result.geo_sequence + 1
	end
	if (flags & 0x10) ~= 0 then
		result.geo_errors = result.geo_errors + 1
	end
	*irq_ack = flags & 0x1c
end

-- Draw the scene artwork and result overlays into the selected surface.
local draw_scene<const> = function(scene, buffer_y)
	*gp0 = 0xe100050a
	*gp0 = 0xe2000000
	*gp0 = 0xe3000000 | (buffer_y << 10)
	*gp0 = 0xe40000ff | ((buffer_y + 191) << 10)
	*gp0 = 0xe5000000 | (buffer_y << 11)
	*gp0 = 0xe6000000
	-- Fill ignores the drawing offset; its destination is explicitly raw VRAM.
	*gp0 = 0x02181008
	*gp0 = buffer_y << 16
	*gp0 = 256 | (192 << 16)

	-- Stars and docking-lane markings belong to the dummy game artwork.
	for star = 0, 14 do
		local x<const> = 12 + (star * 47) % 232
		local y<const> = 20 + (star * 29) % 140
		*gp0 = 0x60605040
		*gp0 = x | (y << 16)
		*gp0 = 1 | (1 << 16)
	end
	for lane = 0, 5 do
		*gp0 = 0x40383020
		*gp0 = (16 + lane * 40) | (160 << 16)
		*gp0 = (32 + lane * 40) | (160 << 16)
	end
	*gp0 = 0x40383020
	*gp0 = 16 | (152 << 16)
	*gp0 = 240 | (152 << 16)

	if scene == 0 then
		-- Local-space sprite view: origin (0,0) at screen (96,64), scale 4.
		*gp0 = 0x64a07030
		*gp0 = 96 | (64 << 16)
		*gp0 = 0
		*gp0 = 64 | (64 << 16)
		-- Local axes start at the sprite origin, not the central pivot.
		*gp0 = 0x40706050
		*gp0 = 96 | (64 << 16)
		*gp0 = 176 | (64 << 16)
		*gp0 = 0x40706050
		*gp0 = 96 | (64 << 16)
		*gp0 = 96 | (144 << 16)
		for edge = 0, 7 do
			local next_edge<const> = (edge + 1) % 8
			*gp0 = 0x40ffff00
			*gp0 = (96 + (local_hull[edge].x >> 14))
				| ((64 + (local_hull[edge].y >> 14)) << 16)
			*gp0 = (96 + (local_hull[next_edge].x >> 14))
				| ((64 + (local_hull[next_edge].y >> 14)) << 16)
		end
		*gp0 = 0x40ffffff
		*gp0 = 124 | (96 << 16)
		*gp0 = 132 | (96 << 16)
		*gp0 = 0x40ffffff
		*gp0 = 128 | (92 << 16)
		*gp0 = 128 | (100 << 16)
	else
		local pose_index = 0
		if scene == 3 then
			pose_index = 1
		elseif scene == 4 then
			pose_index = 2
		end
		local pose<const>: *geo_scene_pose = &result.poses[pose_index]
		-- Game world -> display: screen=(32+4*x,64+4*y).
		-- The two 64px sprites share one texture, with blue and red modulation.
		*gp0 = 0x64a07030
		*gp0 = 32 | (64 << 16)
		*gp0 = 0
		*gp0 = 64 | (64 << 16)
		*gp0 = 0x644050c0
		*gp0 = (32 + translations[pose_index] * 4) | (64 << 16)
		*gp0 = 0
		*gp0 = 64 | (64 << 16)

		if scene ~= 1 then
			for shape = 0, 1 do
				local color = 0x40ffff00
				if shape == 1 then
					color = 0x4000bfff
				end
				for edge = 0, 7 do
					local first<const> = shape * 8 + edge
					local second<const> = shape * 8 + (edge + 1) % 8
					*gp0 = color
					*gp0 = (32 + (pose.world[first].x >> 14))
						| ((64 + (pose.world[first].y >> 14))
							<< 16)
					*gp0 = (32 + (pose.world[second].x >> 14))
						| ((64 + (pose.world[second].y >> 14))
							<< 16)
				end
			end

			-- Yellow bracket: X-projection depth at 4 pixels per unit.
			if pose.sat.hit ~= 0 and pose.sat.depth ~= 0 then
				local left<const> = 32 + translations[pose_index] * 4
				local right<const> = left + ((pose.sat.depth * 4) >> 16)
				*gp0 = 0x4000ffff
				*gp0 = left | (136 << 16)
				*gp0 = right | (136 << 16)
				*gp0 = 0x4000ffff
				*gp0 = left | (133 << 16)
				*gp0 = left | (139 << 16)
				*gp0 = 0x4000ffff
				*gp0 = right | (133 << 16)
				*gp0 = right | (139 << 16)
			end

			-- SAT has no contact point; anchor its green arrow below A.
			-- Fixed length: 24 pixels (6 units), not penetration depth.
			if pose.sat.hit ~= 0 then
				local end_x<const> = 64 + ((pose.sat.nx * 24) >> 16)
				*gp0 = 0x4000ff00
				*gp0 = 64 | (144 << 16)
				*gp0 = end_x | (144 << 16)
				*gp0 = 0x4000ff00
				*gp0 = (end_x - 4) | (140 << 16)
				*gp0 = end_x | (144 << 16)
				*gp0 = 0x4000ff00
				*gp0 = (end_x - 4) | (148 << 16)
				*gp0 = end_x | (144 << 16)
			end

			local contact: *geo_scene_contact = &result.contact_output
			local summary: *geo_scene_summary = &result.return_summary
			if scene ~= 5 then
				contact = &pose.contact
				summary = &pose.summary
			end
			-- Only the completed result count makes a contact slot valid.
			if summary.result_count ~= 0 then
				local x<const> = 32 + contact.px * 4
				local y<const> = 64 + contact.py * 4
				local end_x<const> = x + contact.nx * 24
				local end_y<const> = y + contact.ny * 24
				*gp0 = 0x40ff00ff
				*gp0 = x | (y << 16)
				*gp0 = end_x | (end_y << 16)
				*gp0 = 0x40ff00ff
				*gp0 = (end_x + 4) | ((end_y - 4) << 16)
				*gp0 = end_x | (end_y << 16)
				*gp0 = 0x40ff00ff
				*gp0 = (end_x + 4) | ((end_y + 4) << 16)
				*gp0 = end_x | (end_y << 16)
				*gp0 = 0x40ffffff
				*gp0 = (x - 3) | (y << 16)
				*gp0 = (x + 3) | (y << 16)
				*gp0 = 0x40ffffff
				*gp0 = x | ((y - 3) << 16)
				*gp0 = x | ((y + 3) << 16)
				result.contact_drawn[scene] = 1
			end
		end
	end
end

result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*display_origin = 0x01800000
*display_extent = 0x000bf3ff
*gp1 = 0x09000000
*fault_ack = 1
*irq_ack = 0x1c
*irq_mask = 0x1c

-- Separate F32 polygon storage. No reinterpretation of the Q16 vertex pool.
result.polygon.kind = 3
result.polygon.vertex_count = 8
result.polygon.data_offset = 32
result.polygon.bounds_offset = 16
result.polygon.bounds[0] = 0
result.polygon.bounds[1] = 0
result.polygon.bounds[2] = 16
result.polygon.bounds[3] = 16
for vertex = 0, 7 do
	result.polygon.vertices[vertex].x = local_hull[vertex].x / 65536
	result.polygon.vertices[vertex].y = local_hull[vertex].y / 65536
end

-- Each pose owns matrices, world pool, AABBs, SAT, summary and historical contact.
for pose_index = 0, 2 do
	local pose<const>: *geo_scene_pose = &result.poses[pose_index]
	for shape = 0, 1 do
		pose.transforms[shape].m00 = 65536
		pose.transforms[shape].m01 = 0
		pose.transforms[shape].m10 = 0
		pose.transforms[shape].m11 = 65536
		pose.transforms[shape].ty = 0
		pose.transforms[shape].tx = 0
		pose.instances[shape].shape = &result.polygon
		pose.instances[shape].tx = 0
		pose.instances[shape].ty = 0
		pose.instances[shape].layer = 1
		pose.instances[shape].mask = 1
	end
	pose.transforms[1].tx = translations[pose_index] << 16
	pose.instances[1].tx = translations[pose_index]
	src->src0 = assets.transform_records
	src->src1 = assets.local_hull
	src->src2 = &pose.transforms[0]
	src->dst0 = &pose.world[0]
	src->dst1 = &pose.bounds[0]
	src->count = 2
	param->param0 = 0
	param->param1 = 0
	param->stride0 = sizeof(geo_scene_xform_record)
	param->stride1 = sizeof(geo_scene_vertex)
	param->stride2 = sizeof(geo_scene_transform)
	local before_xform<const> = result.geo_sequence
	*command = 0x20
	while result.geo_sequence == before_xform do
		halt_until_irq
	end
	pose.jobs[0].status = *status
	pose.jobs[0].processed = *processed
	pose.jobs[0].fault = *fault

	-- Only completed XFORM2 output is submitted to SAT2.
	src->src0 = assets.sat_pair
	src->src1 = assets.sat_shapes
	src->src2 = &pose.world[0]
	src->dst0 = &pose.sat
	src->dst1 = 0
	src->count = 1
	param->stride0 = sizeof(geo_scene_sat_pair)
	param->stride1 = sizeof(geo_scene_sat_shape)
	local before_sat<const> = result.geo_sequence
	*command = 0x21
	while result.geo_sequence == before_sat do
		halt_until_irq
	end
	pose.jobs[1].status = *status
	pose.jobs[1].processed = *processed
	pose.jobs[1].fault = *fault

	-- A separate F32 candidate job supplies a point, unlike SAT2.
	src->src0 = &pose.instances[0]
	src->src1 = assets.candidate
	src->src2 = 0
	src->dst0 = &result.contact_output
	src->dst1 = &pose.summary
	src->count = 1
	param->param0 = 1
	param->param1 = 1
	param->stride0 = sizeof(geo_scene_instance)
	param->stride1 = sizeof(geo_scene_candidate)
	param->stride2 = 2
	local before_overlap<const> = result.geo_sequence
	*command = 0x22
	while result.geo_sequence == before_overlap do
		halt_until_irq
	end
	pose.jobs[2].status = *status
	pose.jobs[2].processed = *processed
	pose.jobs[2].fault = *fault
	local contact_source<const>: *word = &result.contact_output
	local contact_snapshot<const>: *word = &pose.contact
	for index = 0, sizeof(geo_scene_contact) // 4 - 1 do
		contact_snapshot[index] = contact_source[index]
	end
	result.prepared_poses = pose_index + 1
end

-- Expand authored art 4x into the actual texture upload's typed RGB555 storage.
for y = 0, 63 do
	for x = 0, 63 do
		pixels[y][x] = palette[indices[y >> 2][x >> 2]]
	end
end
*gp0 = 0xe6000000
*gp0 = 0xa0000000
*gp0 = 640
*gp0 = 64 | (64 << 16)
local texture_words<const>: *word = state.sprite_pixels
for index = 0, sizeof(u16[64][64]) // 4 - 1 do
	*gp0 = texture_words[index]
end

for scene = 0, 5 do
	if scene == 5 then
		-- Reuse the SAME contact output after overlap; misses do not erase it.
		src->src0 = &result.poses[0].instances[0]
		src->dst0 = &result.contact_output
		src->dst1 = &result.return_summary
		local before_return<const> = result.geo_sequence
		*command = 0x22
		while result.geo_sequence == before_return do
			halt_until_irq
		end
		result.return_job.status = *status
		result.return_job.processed = *processed
		result.return_job.fault = *fault
	end
	local buffer_y<const> = (scene & 1) * 256
	draw_scene(scene, buffer_y)
	while (*gp1 & 0x04000000) == 0 do
	end
	-- Idle is NOT publication. Program the display, discard stale pending,
	-- then await a new VBlank callback while owning both GEO/VBlank IRQs.
	*irq_mask = 0
	*framebuffer = 0x000fa000 | ((scene & 1) << 6)
	*pmode = 0x0000ff21
	*irq_ack = 0x04
	result.before_vblank[scene] = result.vblank_sequence
	*irq_mask = 0x1c
	while result.vblank_sequence == result.before_vblank[scene] do
		halt_until_irq
	end
	result.after_vblank[scene] = result.vblank_sequence
	result.programmed_framebuffer[scene] = *framebuffer
	result.completed_phase = scene + 1
	-- Authored demo cadence, not a device latency guarantee.
	local hold<const> = result.vblank_sequence
	while result.vblank_sequence - hold < 8 do
		halt_until_irq
	end
end

while true do
	halt_until_irq
end
