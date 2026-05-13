import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GEO_CTRL_START,
	GEO_INDEX_NONE,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	IO_CMD_GEO_XFORM2_BATCH,
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
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
import { Machine } from '../../src/bmsx/machine/machine';
import { Memory } from '../../src/bmsx/machine/memory/memory';
import { RAM_BASE } from '../../src/bmsx/machine/memory/map';

const XFORM2_JOB_BYTES = 24;
const XFORM2_VERTEX_BYTES = 8;
const XFORM2_MATRIX_BYTES = 24;

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

function writeNoopXform2Record(memory: Memory, addr: number): void {
	memory.writeU32(addr + 0, 0);
	memory.writeU32(addr + 4, 0);
	memory.writeU32(addr + 8, 0);
	memory.writeU32(addr + 12, 0);
	memory.writeU32(addr + 16, 0);
	memory.writeU32(addr + 20, GEO_INDEX_NONE);
}

test('GEO save-state restores in-flight command latch instead of aborting BUSY work', () => {
	const machine = makeMachine();
	const memory = machine.memory;
	const geometry = machine.geometryController;
	const jobBase = RAM_BASE;

	geometry.setTiming(1, 1, 0);
	for (let record = 0; record < 3; record += 1) {
		writeNoopXform2Record(memory, jobBase + record * XFORM2_JOB_BYTES);
	}
	memory.writeValue(IO_GEO_CMD, IO_CMD_GEO_XFORM2_BATCH);
	memory.writeValue(IO_GEO_SRC0, jobBase);
	memory.writeValue(IO_GEO_SRC1, jobBase + 0x100);
	memory.writeValue(IO_GEO_SRC2, jobBase + 0x200);
	memory.writeValue(IO_GEO_DST0, jobBase + 0x300);
	memory.writeValue(IO_GEO_DST1, 0);
	memory.writeValue(IO_GEO_COUNT, 3);
	memory.writeValue(IO_GEO_PARAM0, 0);
	memory.writeValue(IO_GEO_PARAM1, 0);
	memory.writeValue(IO_GEO_STRIDE0, XFORM2_JOB_BYTES);
	memory.writeValue(IO_GEO_STRIDE1, XFORM2_VERTEX_BYTES);
	memory.writeValue(IO_GEO_STRIDE2, XFORM2_MATRIX_BYTES);
	memory.writeValue(IO_GEO_CTRL, GEO_CTRL_START);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);

	memory.writeValue(IO_GEO_CMD, 0xffff);
	memory.writeValue(IO_GEO_COUNT, 1);
	const saved = machine.captureSaveState();

	geometry.accrueCycles(8, 9);
	geometry.onService(9);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE);

	machine.restoreSaveState(saved);
	geometry.setTiming(1, 1, machine.scheduler.nowCycles);
	assert.equal(memory.readIoU32(IO_GEO_CMD), 0xffff);
	assert.equal(memory.readIoU32(IO_GEO_COUNT), 1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 1);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);
	assert.equal(memory.readIoU32(IO_GEO_FAULT), 0);

	geometry.accrueCycles(1, 1);
	geometry.onService(1);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 2);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_BUSY);

	geometry.accrueCycles(1, 2);
	geometry.onService(2);
	assert.equal(memory.readIoU32(IO_GEO_PROCESSED), 3);
	assert.equal(memory.readIoU32(IO_GEO_STATUS), GEO_STATUS_DONE);
	assert.equal((memory.readIoU32(IO_IRQ_FLAGS) & IRQ_GEO_DONE) !== 0, true);
});
