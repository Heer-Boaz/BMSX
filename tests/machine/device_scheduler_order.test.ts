import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU } from '../../machine/ts/machine/cpu/cpu';
import { IrqController } from '../../machine/ts/machine/devices/irq/controller';
import { ExecutionAddressSpace } from '../../machine/ts/machine/execution_address_space';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { DeviceScheduler, DEVICE_SERVICE_DMA, DEVICE_SERVICE_GEO, DEVICE_SERVICE_GPU, DEVICE_SERVICE_IMGDEC } from '../../machine/ts/machine/scheduler/device';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../helpers/cartridge';

test('device deadlines use fixed equal-cycle priority independently of insertion and cancellation', () => {
	const memory = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const cpu = new CPU(memory, new IrqController(memory), new ExecutionAddressSpace(memory));
	const scheduler = new DeviceScheduler(cpu);
	const orders = [
		[DEVICE_SERVICE_IMGDEC, DEVICE_SERVICE_DMA, DEVICE_SERVICE_GPU, DEVICE_SERVICE_GEO],
		[DEVICE_SERVICE_GEO, DEVICE_SERVICE_GPU, DEVICE_SERVICE_DMA, DEVICE_SERVICE_IMGDEC],
		[DEVICE_SERVICE_DMA, DEVICE_SERVICE_IMGDEC, DEVICE_SERVICE_GEO, DEVICE_SERVICE_GPU],
	];
	for (const order of orders) {
		scheduler.reset();
		for (const kind of order) scheduler.scheduleDeviceService(kind, 10);
		scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, 5); // makes the old DMA timer stale
		scheduler.cancelDeviceService(DEVICE_SERVICE_DMA);
		scheduler.scheduleDeviceService(DEVICE_SERVICE_DMA, 10);
		scheduler.advanceTo(10);
		const fired: number[] = [];
		while (scheduler.hasDueTimer()) fired.push(scheduler.popDueTimer());
		assert.deepEqual(fired, [DEVICE_SERVICE_GEO, DEVICE_SERVICE_DMA, DEVICE_SERVICE_GPU, DEVICE_SERVICE_IMGDEC]);
	}
});
