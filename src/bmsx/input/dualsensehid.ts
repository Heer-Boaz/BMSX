/// <reference types="w3c-web-hid" />
/**
 * Sony DualSense Edge – vendor‑ & product‑IDs (USB‑modus)
 * 0x054C = Sony Interactive Entertainment
 * 0x0CE6 = DualSense standard
 * 0x0DF2 = DualSense Edge
 * 0x09cc = DualShock 4
 */
import { $ } from '../core/engine_core';
import type { PlatformHIDDevice, PlatformHIDInputReportEvent } from '../platform';
import { formatNumberAsHex } from '../common/byte_hex_string';


const SONY_VID = 0x054C;
const DUALSENSE_EDGE_PID = 0x0DF2; // DualSense Edge
const DUALSENSE_STANDARD_PID = 0x0CE6; // DualSense standard
const DUALSHOCK4_PID_2013 = 0x05C4 // DualShock 4
const DUALSHOCK4_PID_2016 = 0x09CC; // DualShock 4
const ACCEPTED_VENDORS_PRODUCTS = [
	{ vendorId: SONY_VID, productId: DUALSENSE_EDGE_PID },
	{ vendorId: SONY_VID, productId: DUALSENSE_STANDARD_PID },
	{ vendorId: SONY_VID, productId: DUALSHOCK4_PID_2013 },
	{ vendorId: SONY_VID, productId: DUALSHOCK4_PID_2016 },
] as const;

type HidPadKind = 'ds5_usb' | 'ds4_usb' | 'ds5_bt' | 'ds4_bt';

export interface HidRumbleParams {
	/** 0 – 255, left (strong) motor */
	strong: number;
	/** 0 – 255, right (weak) motor */
	weak: number;
	/** Duration in ms; 0 = continue */
	duration: number;
}


export class DualSenseHID {
	private device: PlatformHIDDevice = null;
	private rumbleTimer: { stop(): void } = null;
	private kind: HidPadKind = null;
	private assignedIndex: number = null;

	/** Map of gamepad indices to HID devices that are in use */
	private static assignedDevices = new Map<number, PlatformHIDDevice>();

	/** Shared lock to avoid overlapping permission prompts */
	private static pendingRequest: Promise<PlatformHIDDevice[]> = null;


	private static async requestHidPermission(ids?: { vendorId: number; productId: number }): Promise<PlatformHIDDevice[]> {
		const hid = $.platform.hid;
		if (!hid?.isSupported()) {
			throw new Error('[DualSenseHID] HID API not available on this platform.');
		}
		if (!DualSenseHID.pendingRequest) {
			// Pause the game while the browser permission dialog is visible
			if (!$) {
				throw new Error('[DualSenseHID] Global game state not initialised when requesting HID permissions.');
			}
			const wasPaused = !!$.paused;
			if (!wasPaused) {
				$.paused = true;
			}

			const filters = ids
				? [{ vendorId: ids.vendorId, productId: ids.productId }]
				: ACCEPTED_VENDORS_PRODUCTS.map(p => ({ vendorId: p.vendorId, productId: p.productId }));

			DualSenseHID.pendingRequest = hid.requestDevice({ filters })
				.finally(() => {
					DualSenseHID.pendingRequest = null;
					if (!wasPaused) {
						$.paused = false;
					}
				});
		}
		return DualSenseHID.pendingRequest;
	}

	private matchIds(device: PlatformHIDDevice, ids: { vendorId: number; productId: number }): boolean {
		return !!ids && device.vendorId === ids.vendorId && device.productId === ids.productId;
	}

	public get isConnected(): boolean {
		return this.device !== null && this.device.opened;
	}

	/** Type of the connected HID pad */
	public get padKind(): HidPadKind {
		return this.kind;
	}

	/** Whether the HID device represents a DualShock 4 */
	public get isDualShock4(): boolean {
		return this.kind === 'ds4_usb' || this.kind === 'ds4_bt';
	}

	private parseGamepadId(id: string): { vendorId: number; productId: number } {
		// Enhanced regex to handle more formats, e.g., "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
		// or "054c-0ce6 (STANDARD GAMEPAD)" or variations with extra text
		const vendorReg = /(vendor|vid|idvendor|0x?[0-9a-f]{4})[^0-9a-f]*([0-9a-f]{4})/i;
		const productReg = /(product|pid|idproduct|0x?[0-9a-f]{4})[^0-9a-f]*([0-9a-f]{4})/i;

		const vendorMatch = vendorReg.exec(id);
		const productMatch = productReg.exec(id);
		let vendorStr = vendorMatch ? vendorMatch[2] : null;
		let productStr = productMatch ? productMatch[2] : null;

		if (!vendorStr || !productStr) {
			// Broader fallback: capture any two hex groups separated by non-hex
			const alt = /([0-9a-f]{4})[^0-9a-f]+([0-9a-f]{4})/i.exec(id);
			if (alt) {
				vendorStr ??= alt[1];
				productStr ??= alt[2];
			}
		}

		if (!vendorStr || !productStr) return null;

		const vendorId = parseInt(vendorStr, 16);
		const productId = parseInt(productStr, 16);

		if (Number.isNaN(vendorId) || Number.isNaN(productId)) return null;
		return { vendorId, productId };
	}

	public inferIsDs4(description: string): boolean {
		const ids = this.parseGamepadId(description);
		if (!ids) return false;
		return ids.vendorId === SONY_VID &&
			(ids.productId === DUALSHOCK4_PID_2013 || ids.productId === DUALSHOCK4_PID_2016);
	}

	/** Requests the Sony HID device and initializes it. */
	public async initForDevice(gamepadIndex: number, description: string): Promise<void> {
		const hid = $.platform.hid;
		if (!hid?.isSupported()) {
			console.warn("HID API not supported on this platform.");
			return; // HID not supported (e.g. Safari)
		}

		const known = await hid.getDevices();

		this.assignedIndex = gamepadIndex;
		const ids = this.parseGamepadId(description);
		if (!ids) {
			console.warn(`Failed to parse VID/PID from gamepad description: "${description}"`);
		}

		// Reuse previously assigned device if still available and matching
		if (this.assignedIndex !== null) {
			const existing = DualSenseHID.assignedDevices.get(this.assignedIndex);
			if (existing && known.includes(existing) && (!ids || this.matchIds(existing, ids))) {
				this.device = existing;
				// Early return if reused
				if (this.device.opened) {
					this.kind = this.detectPadKind(this.device);
					return;
				}
			} else if (existing) {
				DualSenseHID.assignedDevices.delete(this.assignedIndex);
			}
		}

		const used = new Set(DualSenseHID.assignedDevices.values());

		let candidates: PlatformHIDDevice[] = [];
		if (ids) {
			candidates = known.filter(d => this.matchIds(d, ids) && !used.has(d));
		} else {
			candidates = known.filter(d => d.vendorId === SONY_VID && ACCEPTED_VENDORS_PRODUCTS.some(p => p.productId === d.productId) && !used.has(d));
		}

		if (candidates.length === 1) {
			this.device = candidates[0];
		} else {
			// For multiple or zero candidates, prompt the user with appropriate filters
			const promptFilters = ids ? ids : undefined;
			if (candidates.length > 1) {
				console.info(`Multiple HID devices match ${ids ? `VID/PID (${formatNumberAsHex(ids.vendorId)}:${formatNumberAsHex(ids.productId)})` : 'accepted Sony devices'}. Prompting user to select.`);
			} else {
				console.info(`No matching HID device found in known devices. Prompting user to select.`);
			}
			const requested = await DualSenseHID.requestHidPermission(promptFilters);
			if (requested.length) {
				// Prefer a matching unused device, or the first one
				this.device = requested.find(d => !used.has(d) && (ids ? this.matchIds(d, ids) : true)) ?? requested[0];
			} else {
				console.warn('User did not select a device.');
			}
		}

		// Fallback only if no specific ids (general init), try any unused Sony device
		if (!this.device && !ids) {
			this.device = known.find(d => d.vendorId === SONY_VID && !used.has(d));
			if (this.device) {
				console.info('Fallback to any unrecognized Sony device.');
			}
		}

		if (!this.device) {
			console.info('Did not find any suitable controller device.');
			console.info('Known devices:', known.map(d => {
				const serial = (d as { serialNumber?: string }).serialNumber || 'none';
				return `${d.productName} (${formatNumberAsHex(d.vendorId)}:${formatNumberAsHex(d.productId)}) serial: ${serial}`;
			}));
			return; // No device found
		}

		console.info(`Found Sony HID device: ${this.device.productName} (${formatNumberAsHex(this.device.vendorId)}:${formatNumberAsHex(this.device.productId)}) serial: ${(this.device as { serialNumber?: string }).serialNumber || 'none'}`);

		this.kind = this.detectPadKind(this.device);
		console.info(`Detected Sony HID device kind: ${this.kind ?? 'unknown'}`);
		if (!this.device.opened) {
			try {
				await this.device.open();
			} catch (error) {
				console.error('Failed to open HID device:', error);
				this.device = null;
				this.kind = null;
				return;
			}
		}

		if (this.assignedIndex !== null) {
			DualSenseHID.assignedDevices.set(this.assignedIndex, this.device);
		}
	}

	private detectPadKind(dev: PlatformHIDDevice): HidPadKind {
		const collectionHasReport = (reportId: number): boolean => {
			return dev.collections.some((collection: any) => {
				const reports = collection.outputReports ?? [];
				return reports.some((report: any) => report.reportId === reportId);
			});
		};
		const has05 = collectionHasReport(0x05); // DS4-USB
		const has02 = collectionHasReport(0x02); // DS5-USB
		const has11 = collectionHasReport(0x11); // DS4-BT
		const has31 = collectionHasReport(0x31); // DS5-BT

		if (has02) return 'ds5_usb';
		if (has05) return 'ds4_usb';
		if (has31) return 'ds5_bt';
		if (has11) return 'ds4_bt';

		// Fallback based on product ID and possible BT/USB hint (e.g., if no USB reports, assume BT)
		if (dev.productId === DUALSENSE_EDGE_PID || dev.productId === DUALSENSE_STANDARD_PID) {
			return has31 || !has02 ? 'ds5_bt' : 'ds5_usb';
		} else if (dev.productId === DUALSHOCK4_PID_2013 || dev.productId === DUALSHOCK4_PID_2016) {
			return has11 || !has05 ? 'ds4_bt' : 'ds4_usb';
		}
		return null;
	}

	/**
	 * Optional advanced matching: Correlate HID input reports with Gamepad state changes.
	 * Requires user to interact (e.g., press buttons on the target gamepad).
	 * @param gamepad The Gamepad to match against.
	 * @param candidates Array of candidate HIDDevices (must be opened).
	 * @param timeoutMs Max time to wait for input (default 5000ms).
	 * @returns The matching HIDDevice or null if no match.
	 */
	public async correlateWithInput(gamepad: Gamepad, candidates: PlatformHIDDevice[], timeoutMs: number = 5000): Promise<PlatformHIDDevice> {
		if (candidates.length <= 1) return candidates[0] ;

		console.info('Multiple candidates; starting input correlation. Press a button on the target controller.');

		const prevGamepadState = { buttons: gamepad.buttons.map(b => b.pressed), axes: [...gamepad.axes] };
		const listeners = new Map<PlatformHIDDevice, (event: PlatformHIDInputReportEvent) => void>();
		const hidInputPromises = candidates.map(device => new Promise<{ device: PlatformHIDDevice; changed: boolean }>((resolve) => {
			const onInput = (_event: PlatformHIDInputReportEvent) => {
				const listener = listeners.get(device);
				if (listener && typeof device.removeEventListener === 'function') {
					device.removeEventListener('inputreport', listener);
				}
				resolve({ device, changed: true });
			};
			listeners.set(device, onInput);
			if (typeof device.addEventListener === 'function') {
				device.addEventListener('inputreport', onInput);
			}
		}));

		const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));

		// Poll gamepad for changes (Gamepad API requires manual polling)
		const pollInterval = setInterval(() => {
			const current = navigator.getGamepads()[gamepad.index];
			if (!current) return;
			const changed = current.buttons.some((b, i) => b.pressed !== prevGamepadState.buttons[i]) ||
				current.axes.some((a, i) => Math.abs(a - prevGamepadState.axes[i]) > 0.1);
			if (changed) {
				// Update prev for next poll, but we don't need it here
				prevGamepadState.buttons = current.buttons.map(b => b.pressed);
				prevGamepadState.axes = [...current.axes];
			}
		}, 50);

		const result = await Promise.race([...hidInputPromises, timeout]);
		clearInterval(pollInterval);
		for (const [device, listener] of listeners) {
			if (typeof device.removeEventListener === 'function') {
				device.removeEventListener('inputreport', listener);
			}
		}

		if (result && result.changed) {
			console.info(`Matched HID device via input: ${result.device.productName} serial: ${(result.device as { serialNumber?: string }).serialNumber || 'none'}`);
			return result.device;
		}
		console.warn('Input correlation timed out or no match.');
		return null;
	}

	/**
		 * Stops the current rumble effect and resets the device.
		 */
	public stop(): void {
		this.clearRumbleTimer();
		if (this.device && this.device.opened) {
			// Zero‑out the rumble effect
			this.sendRumble({ strong: 0, weak: 0, duration: 0 });
		}
	}

	public disconnect(): void {
		this.stop();
		if (this.device && this.device.opened) {
			try {
				this.device.close();
			} catch (err) {
				console.warn('Failed to close HID device:', err);
			}
		}
		if (this.assignedIndex !== null) {
			DualSenseHID.assignedDevices.delete(this.assignedIndex);
		}
		this.device = null;
		this.kind = null;
	}

	/**
	 * Sends a rumble effect to the DualSense Edge HID device.
	 * @param strong The intensity of the strong motor (0-255).
	 * @param weak The intensity of the weak motor (0-255).
	 * @param duration The duration of the rumble effect in milliseconds.
	 */
	public sendRumble({ strong, weak, duration }: HidRumbleParams): void {
		if (!this.device || !this.device.opened) {
			console.warn("DualSense Edge HID device is not opened.");
			return;
		}

		let report: Uint8Array;
		switch (this.kind) {
			case 'ds5_usb':
				report = this.buildDualSenseReport(strong, weak);
				break;
			case 'ds5_bt':
				report = this.buildDs5BtReport(strong, weak);
				break;
			case 'ds4_usb':
				duration *= 2; // DS4 takes more time to spin up the motors
				report = this.buildDs4Report(strong, weak);
				break;
			case 'ds4_bt':
				duration *= 2; // DS4 takes more time to spin up the motors
				report = this.buildDs4BtReport(strong, weak);
				break;
			default:
				console.warn(`Unknown pad type: "${this.kind}"`);
				return;
		}

		try {
			// Create a copied Uint8Array slice so the underlying buffer is a plain ArrayBuffer
			// (ensures compatibility with the sendReport BufferSource typing).
			this.device.sendReport(report[0], report.slice(1));
		} catch (error) {
			console.error('Failed to send rumble report:', error);
		}

		// Automatically stop after `duration` ms.
		if (duration > 0) {
			this.scheduleRumbleStop(duration);
		}
	}

	private clearRumbleTimer(): void {
		if (this.rumbleTimer) {
			this.rumbleTimer.stop();
			this.rumbleTimer = null;
		}
	}

	private scheduleRumbleStop(duration: number): void {
		this.clearRumbleTimer();
		const start = $.platform.clock.now();
		const handle = $.platform.frames.start(() => {
			if ($.platform.clock.now() - start >= duration) {
				handle.stop();
				this.rumbleTimer = null;
				this.stop();
			}
		});
		this.rumbleTimer = { stop: () => handle.stop() };
	}

	/** DualSense USB – report 0x02 (48 B) */
	private buildDualSenseReport(strong: number, weak: number): Uint8Array {
		const r = new Uint8Array(48);
		r[0] = 0x02;
		r[1] = 0x03; // valid_flag0: bit0 (compatible vibration), bit1 (haptics select for rumble)
		r[2] = 0x00; // valid_flag1: no other features
		r[3] = weak & 0xFF; // right motor (weak, high-freq)
		r[4] = strong & 0xFF; // left motor (strong, low-freq)
		// Remaining bytes zero-initialized
		return r;
	}

	/** DualShock 4 USB – report 0x05 (32 B) */
	private buildDs4Report(strong: number, weak: number): Uint8Array {
		const r = new Uint8Array(32);
		r[0] = 0x05;          // Report-ID
		r[1] = 0x01;          // Enable rumble only
		r[2] = 0x00;
		r[4] = weak & 0xFF;   // right motor (weak, high-freq)
		r[5] = strong & 0xFF; // left motor (strong, low-freq)
		// Remaining bytes zero-initialized
		return r;
	}

	private crc32_bt(data: Uint8Array): number {
		// CRC-32 implementation for Sony BT reports, prefixed with 0xa2 (HID output header)
		let crc = 0xFFFFFFFF;

		// Prefix byte 0xa2
		crc ^= 0xa2;
		for (let j = 0; j < 8; j++) {
			if ((crc & 1) === 1) {
				crc = (crc >>> 1) ^ 0xEDB88320;
			} else {
				crc >>>= 1;
			}
		}

		// Process the data bytes
		for (let i = 0; i < data.length; i++) {
			crc ^= data[i];
			for (let j = 0; j < 8; j++) {
				if ((crc & 1) === 1) {
					crc = (crc >>> 1) ^ 0xEDB88320;
				} else {
					crc >>>= 1;
				}
			}
		}
		return crc ^ 0xFFFFFFFF;
	}

	/** DualShock 4 BT – report 0x11 (78 B with CRC) */
	private buildDs4BtReport(strong: number, weak: number): Uint8Array {
		const r = new Uint8Array(78);
		r[0] = 0x11;
		r[1] = 0xC0;          // Unknown, used by Sony
		r[2] = 0x20;          // Unknown
		r[3] = 0xF1;          // Motor-only flags
		r[4] = 0x04;          // Unknown
		r[6] = weak;          // right motor (weak, high-freq)
		r[7] = strong;        // left motor (strong, low-freq)
		// Compute CRC over the first 74 bytes
		const crc = this.crc32_bt(r.subarray(0, 74));
		r[74] = crc & 0xFF;
		r[75] = (crc >> 8) & 0xFF;
		r[76] = (crc >> 16) & 0xFF;
		r[77] = (crc >> 24) & 0xFF;
		return r;
	}

	/** DualSense BT – report 0x31 (78 B with CRC) */
	private buildDs5BtReport(strong: number, weak: number): Uint8Array {
		const r = new Uint8Array(78);
		r[0] = 0x31;
		r[1] = 0x10; // Tag for BT output
		r[2] = 0x03; // valid_flag0: bit0 (compatible vibration), bit1 (haptics select for rumble)
		r[3] = 0x00; // valid_flag1: no other features
		r[4] = weak; // right motor (weak, high-freq)
		r[5] = strong; // left motor (strong, low-freq)
		// Compute CRC over the first 74 bytes
		const crc = this.crc32_bt(r.subarray(0, 74));
		r[74] = crc & 0xFF;
		r[75] = (crc >> 8) & 0xFF;
		r[76] = (crc >> 16) & 0xFF;
		r[77] = (crc >> 24) & 0xFF;
		return r;
	}

	/**
	 * Closes the HID device.
	 */
	public async close(): Promise<void> {
		if (this.device && this.device.opened) {
			try {
				await this.device.close();
			} catch (error) {
				console.error('Failed to close HID device:', error);
			}
		}
		this.device = null;
		this.kind = null;
		if (this.assignedIndex !== null) {
			DualSenseHID.assignedDevices.delete(this.assignedIndex);
			this.assignedIndex = null;
		}
		if (this.rumbleTimer) {
			// The rumbleTimer is an object { stop(): void } returned by platform.frames.start().
			// Calling clearTimeout here is incorrect — call stop() instead.
			try {
				this.rumbleTimer.stop();
			} catch (err) {
				console.warn('Failed to stop rumble timer:', err);
			}
			this.rumbleTimer = null;
		}
	}
}
