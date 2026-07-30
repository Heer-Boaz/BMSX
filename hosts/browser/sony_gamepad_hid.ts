/// <reference types="w3c-web-hid" />

import type { HostClock, TimerHandle } from '../common/clock';

const SONY_VENDOR_ID = 0x054c;
const DUALSHOCK4_2013_PRODUCT_ID = 0x05c4;
const DUALSHOCK4_2016_PRODUCT_ID = 0x09cc;
const DUALSENSE_PRODUCT_ID = 0x0ce6;
const DUALSENSE_EDGE_PRODUCT_ID = 0x0df2;

const LABELLED_GAMEPAD_ID = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i;
const PREFIXED_GAMEPAD_ID = /^([0-9a-f]{4})-([0-9a-f]{4})(?:-|\s|$)/i;
const SONY_OUTPUT_CRC32 = new Uint32Array(256);
for (let value = 0; value < SONY_OUTPUT_CRC32.length; value += 1) {
	let crc = value;
	for (let bit = 0; bit < 8; bit += 1) {
		crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	SONY_OUTPUT_CRC32[value] = crc;
}

type SonyPadKind = 'ds4_usb' | 'ds4_bt' | 'ds5_usb' | 'ds5_bt';

export function sonyGamepadProductId(description: string): number {
	const match = LABELLED_GAMEPAD_ID.exec(description) || PREFIXED_GAMEPAD_ID.exec(description);
	if (!match || parseInt(match[1], 16) !== SONY_VENDOR_ID) {
		return 0;
	}
	const productId = parseInt(match[2], 16);
	switch (productId) {
		case DUALSHOCK4_2013_PRODUCT_ID:
		case DUALSHOCK4_2016_PRODUCT_ID:
		case DUALSENSE_PRODUCT_ID:
		case DUALSENSE_EDGE_PRODUCT_ID:
			return productId;
		default:
			return 0;
	}
}

export class SonyGamepadHID {
	private static readonly assignedDevices = new Map<number, HIDDevice>();
	private static pendingRequest: Promise<HIDDevice[]> = null;

	private device: HIDDevice = null;
	private kind: SonyPadKind = null;
	private reportId = 0;
	private reportPayload: Uint8Array<ArrayBuffer> = null;
	private rumbleTimer: TimerHandle = null;
	private readonly stopRumble = (): void => {
		this.rumbleTimer = null;
		this.setVibration(0, 0);
	};

	public constructor(
		private readonly gamepadIndex: number,
		private readonly productId: number,
		private readonly clock: HostClock,
	) { }

	public get connected(): boolean {
		return this.device !== null && this.device.opened;
	}

	public async initialize(): Promise<void> {
		const knownDevices = await navigator.hid.getDevices();
		const existing = SonyGamepadHID.assignedDevices.get(this.gamepadIndex);
		if (existing && knownDevices.includes(existing) && this.matches(existing)) {
			await this.open(existing);
			return;
		}
		if (existing) {
			SonyGamepadHID.assignedDevices.delete(this.gamepadIndex);
		}

		let device = this.findUnassigned(knownDevices);
		if (!device) {
			const requested = await SonyGamepadHID.requestDevice(this.productId);
			device = this.findUnassigned(requested);
		}
		if (!device) {
			return;
		}
		await this.open(device);
	}

	public setVibration(durationMs: number, intensity: number): void {
		this.cancelStop();
		const strong = intensity > 0.5 ? (intensity * 255) | 0 : 0;
		const weak = intensity <= 0.5 ? (intensity * 255) | 0 : 0;
		switch (this.kind) {
			case 'ds5_usb':
				this.reportPayload[2] = weak;
				this.reportPayload[3] = strong;
				break;
			case 'ds5_bt':
				this.reportPayload[3] = weak;
				this.reportPayload[4] = strong;
				this.writeBluetoothCrc();
				break;
			case 'ds4_usb':
				this.reportPayload[3] = weak;
				this.reportPayload[4] = strong;
				durationMs *= 2;
				break;
			case 'ds4_bt':
				this.reportPayload[5] = weak;
				this.reportPayload[6] = strong;
				this.writeBluetoothCrc();
				durationMs *= 2;
				break;
		}
		void this.device.sendReport(this.reportId, this.reportPayload);
		if (durationMs > 0) {
			this.scheduleStop(durationMs);
		}
	}

	public disconnect(): void {
		const device = this.device;
		this.stop();
		SonyGamepadHID.assignedDevices.delete(this.gamepadIndex);
		this.device = null;
		this.kind = null;
		this.reportId = 0;
		this.reportPayload = null;
		if (device && device.opened) {
			void device.close();
		}
	}

	private async open(device: HIDDevice): Promise<void> {
		if (!device.opened) {
			await device.open();
		}
		this.device = device;
		this.kind = SonyGamepadHID.detectPadKind(device);
		this.initializeReport();
		SonyGamepadHID.assignedDevices.set(this.gamepadIndex, device);
	}

	private findUnassigned(devices: HIDDevice[]): HIDDevice {
		for (let index = 0; index < devices.length; index += 1) {
			const device = devices[index];
			if (this.matches(device) && !SonyGamepadHID.isAssigned(device)) {
				return device;
			}
		}
		return null;
	}

	private static async requestDevice(productId: number): Promise<HIDDevice[]> {
		const pending = SonyGamepadHID.pendingRequest;
		if (pending) {
			return pending;
		}
		const request = navigator.hid.requestDevice({
			filters: [{ vendorId: SONY_VENDOR_ID, productId }],
		});
		SonyGamepadHID.pendingRequest = request;
		try {
			return await request;
		} finally {
			SonyGamepadHID.pendingRequest = null;
		}
	}

	private matches(device: HIDDevice): boolean {
		return device.vendorId === SONY_VENDOR_ID && device.productId === this.productId;
	}

	private static isAssigned(device: HIDDevice): boolean {
		for (const assigned of SonyGamepadHID.assignedDevices.values()) {
			if (assigned === device) {
				return true;
			}
		}
		return false;
	}

	private static detectPadKind(device: HIDDevice): SonyPadKind {
		let ds5Usb = false;
		let ds4Usb = false;
		let ds4Bt = false;
		let ds5Bt = false;
		for (let collectionIndex = 0; collectionIndex < device.collections.length; collectionIndex += 1) {
			const reports = device.collections[collectionIndex].outputReports;
			for (let reportIndex = 0; reportIndex < reports.length; reportIndex += 1) {
				switch (reports[reportIndex].reportId) {
					case 0x02: ds5Usb = true; break;
					case 0x05: ds4Usb = true; break;
					case 0x11: ds4Bt = true; break;
					case 0x31: ds5Bt = true; break;
				}
			}
		}
		if (ds5Usb) return 'ds5_usb';
		if (ds4Usb) return 'ds4_usb';
		if (ds5Bt) return 'ds5_bt';
		if (ds4Bt) return 'ds4_bt';
		throw new Error(`Sony controller ${device.productName} has no supported output report.`);
	}

	private initializeReport(): void {
		switch (this.kind) {
			case 'ds5_usb':
				this.reportId = 0x02;
				this.reportPayload = new Uint8Array(47);
				this.reportPayload[0] = 0x03;
				break;
			case 'ds5_bt':
				this.reportId = 0x31;
				this.reportPayload = new Uint8Array(77);
				this.reportPayload[0] = 0x10;
				this.reportPayload[1] = 0x03;
				break;
			case 'ds4_usb':
				this.reportId = 0x05;
				this.reportPayload = new Uint8Array(31);
				this.reportPayload[0] = 0x01;
				break;
			case 'ds4_bt':
				this.reportId = 0x11;
				this.reportPayload = new Uint8Array(77);
				this.reportPayload[0] = 0xc0;
				this.reportPayload[1] = 0x20;
				this.reportPayload[2] = 0xf1;
				this.reportPayload[3] = 0x04;
				break;
		}
	}

	private stop(): void {
		if (this.connected) {
			this.setVibration(0, 0);
		} else {
			this.cancelStop();
		}
	}

	private scheduleStop(durationMs: number): void {
		this.rumbleTimer = this.clock.scheduleOnce(durationMs, this.stopRumble);
	}

	private cancelStop(): void {
		if (this.rumbleTimer) {
			this.rumbleTimer.cancel();
			this.rumbleTimer = null;
		}
	}

	private writeBluetoothCrc(): void {
		let crc = SONY_OUTPUT_CRC32[(0xffffffff ^ 0xa2) & 0xff] ^ (0xffffffff >>> 8);
		crc = SONY_OUTPUT_CRC32[(crc ^ this.reportId) & 0xff] ^ (crc >>> 8);
		for (let index = 0; index < 73; index += 1) {
			crc = SONY_OUTPUT_CRC32[(crc ^ this.reportPayload[index]) & 0xff] ^ (crc >>> 8);
		}
		crc ^= 0xffffffff;
		this.reportPayload[73] = crc;
		this.reportPayload[74] = crc >>> 8;
		this.reportPayload[75] = crc >>> 16;
		this.reportPayload[76] = crc >>> 24;
	}
}
