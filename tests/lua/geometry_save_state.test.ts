import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_LUA_BUILTIN_NAMES } from '../../src/bmsx/machine/firmware/builtin_descriptors';
import { SYSTEM_ROM_GLOBAL_NAME_SET } from '../../src/bmsx/machine/firmware/system_globals';
import {
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_FAULT_ACK,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
	IO_GEO_REGISTER_ADDRS,
	IO_GEO_SRC0,
	IO_GEO_SRC1,
	IO_GEO_SRC2,
	IO_GEO_STATUS,
	IO_GEO_STRIDE0,
	IO_GEO_STRIDE1,
	IO_GEO_STRIDE2,
	IO_IRQ_FLAGS,
	IRQ_GEO_DONE,
} from '../../src/bmsx/machine/bus/io';
import {
	GEO_CTRL_ABORT,
	GEO_CTRL_START,
	GEOMETRY_CONTROLLER_PHASE_BUSY,
	GEOMETRY_CONTROLLER_PHASE_DONE,
	GEOMETRY_CONTROLLER_PHASE_ERROR,
	GEOMETRY_CONTROLLER_PHASE_IDLE,
	GEOMETRY_CONTROLLER_PHASE_REJECTED,
	GEOMETRY_CONTROLLER_REGISTER_COUNT,
	GEO_INDEX_NONE,
	GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB,
	GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE,
	GEO_OVERLAP2D_INSTANCE_BYTES,
	GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET,
	GEO_OVERLAP2D_INSTANCE_MASK_OFFSET,
	GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TX_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TY_OFFSET,
	GEO_OVERLAP2D_MODE_FULL_PASS,
	GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_DESC_BYTES,
	GEO_OVERLAP2D_SHAPE_KIND_OFFSET,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_VERTEX2_BYTES,
	GEO_XFORM2_MATRIX_BYTES,
	GEO_XFORM2_RECORD_AUX_INDEX_OFFSET,
	GEO_XFORM2_RECORD_BYTES,
	GEO_XFORM2_RECORD_DST1_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST_INDEX_OFFSET,
	GEO_XFORM2_RECORD_FLAGS_OFFSET,
	GEO_XFORM2_RECORD_SRC_INDEX_OFFSET,
	GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_XFORM2_BATCH,
} from '../../src/bmsx/machine/devices/geometry/contracts';
import { Machine } from '../../src/bmsx/machine/machine';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { RAM_BASE } from '../../src/bmsx/machine/memory/map';
import type { GeometryController, GeometryControllerState } from '../../src/bmsx/machine/devices/geometry/controller';


function makeMachine(): Machine {
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	const input = {
		getPlayerInput: () => ({
			checkActionTriggered: () => false,
			consumeAction: () => {},
			popContext: () => {},
			pushContext: () => {},
		}),
		beginFrame: () => {},
	};
	const soundMaster = {
		addEndedListener: () => () => {},
		stopAllVoices: () => {},
	};
	const machine = new Machine(
		memory,
		{ x: 256, y: 212 },
		input as never,
		soundMaster as never,
	);
	machine.initializeSystemIo();
	machine.resetDevices();
	return machine;
}

test('GEO registerfile address bank is bus-owned and matches the device contract', () => {
	assert.equal(GEOMETRY_CONTROLLER_REGISTER_COUNT, 16);
	assert.equal(IO_GEO_REGISTER_ADDRS.length, GEOMETRY_CONTROLLER_REGISTER_COUNT);
	assert.equal(IO_GEO_REGISTER_ADDRS[0], IO_GEO_SRC0);
	assert.equal(IO_GEO_REGISTER_ADDRS[15], IO_GEO_FAULT);
	assert.equal(GEOMETRY_CONTROLLER_PHASE_IDLE, 0);
	assert.equal(GEOMETRY_CONTROLLER_PHASE_BUSY, 1);
	assert.equal(GEOMETRY_CONTROLLER_PHASE_DONE, 2);
	assert.equal(GEOMETRY_CONTROLLER_PHASE_ERROR, 3);
	assert.equal(GEOMETRY_CONTROLLER_PHASE_REJECTED, 4);
});

function writeNoopXform2Record(memory: Memory, addr: number): void {
	memory.writeU32(addr + GEO_XFORM2_RECORD_FLAGS_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_SRC_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_DST_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_AUX_INDEX_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 0);
	memory.writeU32(addr + GEO_XFORM2_RECORD_DST1_INDEX_OFFSET, GEO_INDEX_NONE);
}

function writeXform2BatchRegisters(memory: Memory, jobBase: number, count: number): void {
	memory.writeValue(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH);
	memory.writeValue(IO_GEO_SRC0, jobBase);
	memory.writeValue(IO_GEO_SRC1, jobBase + 0x100);
	memory.writeValue(IO_GEO_SRC2, jobBase + 0x200);
	memory.writeValue(IO_GEO_DST0, jobBase + 0x300);
	memory.writeValue(IO_GEO_DST1, 0);
	memory.writeValue(IO_GEO_COUNT, count);
	memory.writeValue(IO_GEO_PARAM0, 0);
	memory.writeValue(IO_GEO_PARAM1, 0);
	memory.writeValue(IO_GEO_STRIDE0, GEO_XFORM2_RECORD_BYTES);
	memory.writeValue(IO_GEO_STRIDE1, GEO_VERTEX2_BYTES);
	memory.writeValue(IO_GEO_STRIDE2, GEO_XFORM2_MATRIX_BYTES);
}

const OVERLAP2D_FULL_PASS_PARAM0 = GEO_OVERLAP2D_MODE_FULL_PASS
	| GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB
	| GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE
	| GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW;

function writeOverlap2dFullPassRegisters(memory: Memory, instanceBase: number, instanceCount: number, src2: number, dst0: number, resultCapacity: number): void {
	memory.writeValue(IO_GEO_CMD, IO_CMD_GEO_OVERLAP2D_PASS);
	memory.writeValue(IO_GEO_SRC0, instanceBase);
	memory.writeValue(IO_GEO_SRC1, 0);
	memory.writeValue(IO_GEO_SRC2, src2);
	memory.writeValue(IO_GEO_DST0, dst0);
	memory.writeValue(IO_GEO_DST1, instanceBase + 0x200);
	memory.writeValue(IO_GEO_COUNT, instanceCount);
	memory.writeValue(IO_GEO_PARAM0, OVERLAP2D_FULL_PASS_PARAM0);
	memory.writeValue(IO_GEO_PARAM1, resultCapacity);
	memory.writeValue(IO_GEO_STRIDE0, GEO_OVERLAP2D_INSTANCE_BYTES);
	memory.writeValue(IO_GEO_STRIDE1, 0);
	memory.writeValue(IO_GEO_STRIDE2, 0);
}

function writeOverlap2dInstance(memory: Memory, addr: number, shapeAddr: number): void {
	memory.writeU32(addr + GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, shapeAddr);
	memory.writeU32(addr + GEO_OVERLAP2D_INSTANCE_TX_OFFSET, 0);
	memory.writeU32(addr + GEO_OVERLAP2D_INSTANCE_TY_OFFSET, 0);
	memory.writeU32(addr + GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET, 1);
	memory.writeU32(addr + GEO_OVERLAP2D_INSTANCE_MASK_OFFSET, 1);
}

function writeOversizeOverlapPoly(memory: Memory, shapeAddr: number): void {
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_KIND_OFFSET, GEO_PRIMITIVE_CONVEX_POLY);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 0x4000_0000);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET, GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET, 0);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET, 0);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET, 0x3f80_0000);
	memory.writeU32(shapeAddr + GEO_OVERLAP2D_SHAPE_DESC_BYTES + GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET, 0x3f80_0000);
}

function startGeometryCommand(memory: Memory, geometry: GeometryController): GeometryControllerState {
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	const capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_BUSY);
	return capturedGeometry;
}

function assertGeometryFaultLatch(
	memory: Memory,
	geometry: GeometryController,
	status: number,
	fault: number,
	phase: GeometryControllerState['phase'],
): GeometryControllerState {
	assert.equal(memory.readIoU32(IO_GEO_STATUS), status);
	assert.equal(memory.readIoU32(IO_GEO_FAULT), fault);
	const capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, phase);
	return capturedGeometry;
}

test('GEO save-state restores in-flight command latch instead of aborting BUSY work', () => {
	const machine = makeMachine();
	const memory = machine.memory;
	const geometry = machine.geometryController;
	const jobBase = RAM_BASE;

	geometry.setTiming(1, 1, 0);
	for (let record = 0; record < 3; record += 1) {
		writeNoopXform2Record(memory, jobBase + record * GEO_XFORM2_RECORD_BYTES);
	}
	writeXform2BatchRegisters(memory, jobBase, 3);
	let capturedGeometry = startGeometryCommand(memory, geometry);

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_BUSY);

	memory.writeValue(IO_GEO_CMD, 0xffff);
	memory.writeValue(IO_GEO_COUNT, 1);
	const saved = machine.captureSaveState();

	geometry.accrueCycles(8, 9);
	geometry.onService(9);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_DONE);

	machine.restoreSaveState(saved);
	geometry.setTiming(1, 1, machine.scheduler.nowCycles);
	assert.equal(memory.readIoU32(IO_GEO_CMD), 0xffff);
	assert.equal(memory.readIoU32(IO_GEO_COUNT), 1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_GEO_FAULT), 0);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_BUSY);

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 2);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_BUSY);

	geometry.accrueCycles(1, 2);
	geometry.onService(2);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 3);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_DONE);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GEO_DONE) !== 0, true);
});

test('GEO execution fault ack preserves completed command status', () => {
	const machine = makeMachine();
	const memory = machine.memory;
	const geometry = machine.geometryController;
	const jobBase = RAM_BASE + 0x600;
	const executionFaultStatus = GEO_STATUS_DONE | GEO_STATUS_ERROR;

	geometry.setTiming(1, 1, 0);
	writeNoopXform2Record(memory, jobBase);
	memory.writeU32(jobBase + 0, 1);
	writeXform2BatchRegisters(memory, jobBase, 1);
	let capturedGeometry = startGeometryCommand(memory, geometry);

	geometry.accrueCycles(1, 1);
	geometry.onService(1);

	assert.equal(memory.readIoU32(IO_GEO_STATUS), executionFaultStatus);
	assert.notEqual(memory.readIoU32(IO_GEO_FAULT), 0);
	const executionFault = memory.readIoU32(IO_GEO_FAULT);
	capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		executionFaultStatus,
		executionFault,
		GEOMETRY_CONTROLLER_PHASE_ERROR,
	);

	writeNoopXform2Record(memory, jobBase);
	writeXform2BatchRegisters(memory, jobBase, 1);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		executionFaultStatus,
		executionFault,
		GEOMETRY_CONTROLLER_PHASE_ERROR,
	);

	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_ABORT);
	capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		executionFaultStatus,
		executionFault,
		GEOMETRY_CONTROLLER_PHASE_ERROR,
	);

	memory.writeValue(IO_GEO_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE);
	assert.equal(memory.readIoU32(IO_GEO_FAULT), 0);
	assert.equal(memory.readIoU32(IO_GEO_FAULT_ACK), 0);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_DONE);
});

test('GEO rejected command is explicit controller phase state', () => {
	const machine = makeMachine();
	const memory = machine.memory;
	const geometry = machine.geometryController;
	const jobBase = RAM_BASE;

	memory.writeValue(IO_GEO_CMD, 0xffff);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);

	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_REJECTED);
	assert.notEqual(memory.readIoU32(IO_GEO_FAULT), 0);
	const rejectedFault = memory.readIoU32(IO_GEO_FAULT);
	let capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		GEO_STATUS_REJECTED,
		rejectedFault,
		GEOMETRY_CONTROLLER_PHASE_REJECTED,
	);

	writeNoopXform2Record(memory, jobBase);
	writeXform2BatchRegisters(memory, jobBase, 1);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		GEO_STATUS_REJECTED,
		rejectedFault,
		GEOMETRY_CONTROLLER_PHASE_REJECTED,
	);

	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_ABORT);
	capturedGeometry = assertGeometryFaultLatch(
		memory,
		geometry,
		GEO_STATUS_REJECTED,
		rejectedFault,
		GEOMETRY_CONTROLLER_PHASE_REJECTED,
	);

	memory.writeValue(IO_GEO_FAULT_ACK, 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), 0);
	assert.equal(memory.readIoU32(IO_GEO_FAULT), 0);
	assert.equal(memory.readIoU32(IO_GEO_FAULT_ACK), 0);
	capturedGeometry = geometry.captureState();
	assert.equal(capturedGeometry.phase, GEOMETRY_CONTROLLER_PHASE_IDLE);
});

test('GEO overlap2d submit rejects reserved src2 and non-RAM result base', () => {
	const machine = makeMachine();
	const memory = machine.memory;
	const geometry = machine.geometryController;
	const jobBase = RAM_BASE + 0x900;

	writeOverlap2dFullPassRegisters(memory, jobBase, 0, jobBase + 0x100, jobBase + 0x300, 1);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	let rejectedFault = memory.readIoU32(IO_GEO_FAULT);
	assert.notEqual(rejectedFault, 0);
	assertGeometryFaultLatch(
		memory,
		geometry,
		GEO_STATUS_REJECTED,
		rejectedFault,
		GEOMETRY_CONTROLLER_PHASE_REJECTED,
	);

	memory.writeValue(IO_GEO_FAULT_ACK, 1);
	writeOverlap2dFullPassRegisters(memory, jobBase, 0, 0, 0, 0);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	rejectedFault = memory.readIoU32(IO_GEO_FAULT);
	assert.notEqual(rejectedFault, 0);
	assertGeometryFaultLatch(
		memory,
		geometry,
		GEO_STATUS_REJECTED,
		rejectedFault,
		GEOMETRY_CONTROLLER_PHASE_REJECTED,
	);

	memory.writeValue(IO_GEO_FAULT_ACK, 1);
	const shapeA = jobBase + 0x400;
	const shapeB = jobBase + 0x500;
	writeOverlap2dInstance(memory, jobBase, shapeA);
	writeOverlap2dInstance(memory, jobBase + GEO_OVERLAP2D_INSTANCE_BYTES, shapeB);
	writeOversizeOverlapPoly(memory, shapeA);
	writeOversizeOverlapPoly(memory, shapeB);
	writeOverlap2dFullPassRegisters(memory, jobBase, 2, 0, jobBase + 0x300, 1);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE | GEO_STATUS_ERROR);
	assert.notEqual(memory.readIoU32(IO_GEO_FAULT), 0);
});

test('GEO cart-visible ABI names are system ROM globals and builtins', () => {
	for (const name of [
		'sys_geo_cmd_overlap2d_pass',
		'sys_geo_primitive_aabb',
		'sys_geo_primitive_circle',
		'sys_geo_primitive_convex_poly',
		'sys_geo_vertex2_bytes',
		'sys_geo_xform2_record_bytes',
		'sys_geo_xform2_record_vertex_count_offset',
		'sys_geo_xform2_matrix_bytes',
		'sys_geo_xform2_aabb_bytes',
		'sys_geo_sat2_pair_bytes',
		'sys_geo_sat2_desc_bytes',
		'sys_geo_sat2_result_bytes',
		'sys_geo_overlap_mode_candidate_pairs',
		'sys_geo_overlap_mode_full_pass',
		'sys_geo_overlap_broadphase_none',
		'sys_geo_overlap_broadphase_local_bounds_aabb',
		'sys_geo_overlap_contact_clipped_feature',
		'sys_geo_overlap_output_stop_on_overflow',
		'sys_geo_overlap_instance_bytes',
		'sys_geo_overlap_instance_shape_offset',
		'sys_geo_overlap_pair_bytes',
		'sys_geo_overlap_pair_meta_offset',
		'sys_geo_overlap_result_bytes',
		'sys_geo_overlap_result_pair_meta_offset',
		'sys_geo_overlap_summary_bytes',
		'sys_geo_overlap_summary_result_count_offset',
		'sys_geo_overlap_summary_flag_overflow',
		'sys_geo_overlap_shape_desc_bytes',
		'sys_geo_overlap_shape_kind_compound',
		'sys_geo_overlap_shape_bounds_bytes',
		'sys_geo_overlap_shape_bounds_left_offset',
		'sys_geo_overlap_shape_bounds_bottom_offset',
		'sys_geo_overlap_aabb_data_count',
		'sys_geo_overlap_aabb_shape_bytes',
		'sys_geo_overlap_pair_meta_instance_a_shift',
		'sys_geo_overlap_pair_meta_instance_a_mask',
		'sys_geo_overlap_pair_meta_instance_b_mask',
		'sys_geo_fault_ack',
		'sys_geo_fault_code_shift',
		'sys_geo_fault_code_mask',
		'sys_geo_fault_record_index_mask',
		'sys_geo_fault_record_index_none',
	]) {
		assert.equal(SYSTEM_ROM_GLOBAL_NAME_SET.has(name), true);
		assert.equal(DEFAULT_LUA_BUILTIN_NAMES.includes(name), true);
	}
});
