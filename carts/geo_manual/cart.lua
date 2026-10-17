module<entry>

local state<const> = require('results')
local result<const>: *geo_manual_result = state.result
local src<const>: *geo_manual_sources = 0x08000024
local param<const>: *geo_manual_parameters = 0x08000048
local command<const>: *word = 0x0800003c
local status<const>: *word = 0x08000044
local processed<const>: *word = 0x0800005c
local fault<const>: *word = 0x08000060
local fault_ack<const>: *word = 0x08010224
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008

-- XFORM2 and SAT2 use signed Q16.16 words, not floating-point coordinates.
rodata square: geo_manual_vertex[4] = {
	{ x = 0, y = 0 }, { x = 4 << 16, y = 0 },
	{ x = 4 << 16, y = 4 << 16 }, { x = 0, y = 4 << 16 },
}
rodata transforms: geo_manual_transform[2] = {
	{ m00 = 65536, m01 = 0, tx = 0, m10 = 0, m11 = 65536, ty = 0 },
	{ m00 = 65536, m01 = 0, tx = 65536, m10 = 0, m11 = 65536, ty = 65536 },
}
rodata transform_records: geo_manual_xform_record[2] = {
	{ flags = 0, source_index = 0, destination_index = 0,
		matrix_index = 0, vertex_count = 4, bounds_index = 0 },
	{ flags = 0, source_index = 0, destination_index = 4,
		matrix_index = 1, vertex_count = 4, bounds_index = 1 },
}
rodata sat_pair: geo_manual_sat_pair = {
	flags = 0, shape_a = 0, result_index = 0, shape_b = 1, flags2 = 0,
}
rodata sat_shapes: geo_manual_sat_shape[2] = {
	{ flags = 1, vertex_count = 4, vertex_offset = 0, reserved = 0 },
	{ flags = 1, vertex_count = 4, vertex_offset = 32, reserved = 0 },
}

rodata candidate: geo_manual_candidate = {
	instance_a = 0, instance_b = 1, meta = 0x12345678,
}
rodata bad_record: geo_manual_xform_record = {
	flags = 1, source_index = 0, destination_index = 0,
	matrix_index = 0, vertex_count = 4, bounds_index = 0xffffffff,
}

function irq(flags)
	if (flags & 0x00000008) ~= 0 then
		result.done_count = result.done_count + 1
	end
	if (flags & 0x00000010) ~= 0 then
		result.error_count = result.error_count + 1
	end
	if (flags & 0x00000018) ~= 0 then
		result.service_sequence = result.service_sequence + 1
	end
	*irq_ack = flags & 0x00000018
end

-- Own GEO and only its two completion sources; preserve unrelated pending.
*irq_mask = 0
*fault_ack = 1
*irq_ack = 0x00000018
*irq_mask = 0x00000018

-- 1. One source square, two matrices, two output polygons and two AABBs.
src->src0 = transform_records
src->src1 = square
src->src2 = transforms
src->dst0 = &result.vertices[0]
src->dst1 = &result.bounds[0]
src->count = #transform_records
param->param0 = 0
param->param1 = 0
param->stride0 = sizeof(geo_manual_xform_record)
param->stride1 = sizeof(geo_manual_vertex)
param->stride2 = sizeof(geo_manual_transform)
local xform_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == xform_sequence do
	halt_until_irq
end
result.observations[0].status = *status
result.observations[0].processed = *processed
result.observations[0].fault = *fault
result.completed_phase = 1

-- 2. SAT2 reads the transformed Q16.16 output directly.
src->src0 = sat_pair
src->src1 = sat_shapes
src->src2 = &result.vertices[0]
src->dst0 = &result.sat
src->dst1 = 0
src->count = 1
param->stride0 = sizeof(geo_manual_sat_pair)
param->stride1 = sizeof(geo_manual_sat_shape)
local sat_sequence<const> = result.service_sequence
*command = 0x21
while result.service_sequence == sat_sequence do
	halt_until_irq
end
result.observations[1].status = *status
result.observations[1].processed = *processed
result.observations[1].fault = *fault
result.completed_phase = 2

-- 3. Candidate-pair OVERLAP2D: explicit F32 operands, not the Q16 buffer.
result.shape.kind = 1
result.shape.data_count = 4
result.shape.data_offset = 16
result.shape.bounds_offset = 16
result.shape.bounds[0] = 0
result.shape.bounds[1] = 0
result.shape.bounds[2] = 4
result.shape.bounds[3] = 4
result.instances[0].shape = &result.shape
result.instances[0].tx = 0
result.instances[0].ty = 0
result.instances[0].layer = 1
result.instances[0].mask = 1
result.instances[1].shape = &result.shape
result.instances[1].tx = 1
result.instances[1].ty = 1
result.instances[1].layer = 1
result.instances[1].mask = 1
src->src0 = &result.instances[0]
src->src1 = candidate
src->src2 = 0
src->dst0 = &result.contacts[0]
src->dst1 = &result.summaries[0]
src->count = 1
param->param0 = 1
param->param1 = 1
param->stride0 = sizeof(geo_manual_instance)
param->stride1 = sizeof(geo_manual_candidate)
param->stride2 = 2
local candidate_sequence<const> = result.service_sequence
*command = 0x22
while result.service_sequence == candidate_sequence do
	halt_until_irq
end
result.observations[2].status = *status
result.observations[2].processed = *processed
result.observations[2].fault = *fault
result.completed_phase = 3

-- 4. Full pass over the same instances; no candidate stream.
src->src1 = 0
src->dst0 = &result.contacts[1]
src->dst1 = &result.summaries[1]
src->count = 2
param->param0 = 2
param->stride1 = 0
param->stride2 = 0
local full_sequence<const> = result.service_sequence
*command = 0x22
while result.service_sequence == full_sequence do
	halt_until_irq
end
result.observations[3].status = *status
result.observations[3].processed = *processed
result.observations[3].fault = *fault
result.completed_phase = 4

-- 5. A bad XFORM2 record produces ERROR, not an empty successful batch.
src->src0 = bad_record
src->count = 1
param->stride0 = sizeof(geo_manual_xform_record)
local error_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == error_sequence do
	halt_until_irq
end
result.observations[4].status = *status
result.observations[4].processed = *processed
result.observations[4].fault = *fault
*fault_ack = 1
result.acknowledged_status = *status
result.acknowledged_fault = *fault
result.completed_phase = 5

-- 6. After local ACK, a zero-count command completes without reading records.
src->count = 0
local empty_sequence<const> = result.service_sequence
*command = 0x20
while result.service_sequence == empty_sequence do
	halt_until_irq
end
result.observations[5].status = *status
result.observations[5].processed = *processed
result.observations[5].fault = *fault
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 6
while true do
	halt_until_irq
end
