/// <reference types="w3c-web-hid" />
/**
 * Sony DualSense Edge – vendor‑ & product‑IDs (USB‑modus)
 * 0x054C = Sony Interactive Entertainment
 * 0x0CE6 = DualSense standard
 * 0x0DF2 = DualSense Edge
 * 0x09cc = DualShock 4
 */
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

type HidPadKind = 'ds5_usb' | 'ds4_usb' | 'ds5_bt' | 'ds4_bt' | null;

export interface HidRumbleParams {
	/** 0 – 255, left (strong) motor */
	strong: number;
	/** 0 – 255, right (weak) motor */
	weak: number;
	/** Duration in ms; 0 = continue */
	duration: number;
}


export class DualSenseHID {
	private device: HIDDevice | null = null;
	private rumbleTimer: number | null = null;
	private kind: HidPadKind | null = null;
	private assignedIndex: number | null = null;

	/** Map of gamepad indices to HID devices that are in use */
	private static assignedDevices = new Map<number, HIDDevice>();

	/** Shared lock to avoid overlapping permission prompts */
	private static pendingRequest: Promise<HIDDevice[]> | null = null;


	private static async requestHidPermission(ids?: { vendorId: number; productId: number }): Promise<HIDDevice[]> {
		if (!DualSenseHID.pendingRequest) {
			// Pause the game while the browser permission dialog is visible
			const g = global as unknown as { $?: { paused?: boolean } };
			const wasPaused = g.$?.paused ?? false;
			if (!wasPaused && g.$) g.$.paused = true;

			const filters = ids
				? [{ vendorId: ids.vendorId, productId: ids.productId }]
				: ACCEPTED_VENDORS_PRODUCTS.map(p => ({ vendorId: p.vendorId, productId: p.productId }));

			DualSenseHID.pendingRequest = navigator.hid.requestDevice({ filters })
				.finally(() => {
					DualSenseHID.pendingRequest = null;
					if (!wasPaused && g.$) g.$.paused = false;
				});
		}
		return DualSenseHID.pendingRequest;
	}

	private matchIds(device: HIDDevice, ids: { vendorId: number; productId: number } | null): boolean {
		return !!ids && device.vendorId === ids.vendorId && device.productId === ids.productId;
	}

	public get isConnected(): boolean {
		return this.device?.opened ?? false;
	}

	/** Type of the connected HID pad */
	public get padKind(): HidPadKind | null {
		return this.kind;
	}

	/** Whether the HID device represents a DualShock 4 */
	public get isDualShock4(): boolean {
		return this.kind === 'ds4_usb' || this.kind === 'ds4_bt';
	}

	private parseGamepadId(id: string): { vendorId: number; productId: number } | null {
		// Enhanced regex to handle more formats, e.g., "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
		// or "054c-0ce6 (STANDARD GAMEPAD)" or variations with extra text
		const vendorReg = /(vendor|vid|idvendor|0x?[0-9a-f]{4})[^0-9a-f]*([0-9a-f]{4})/i;
		const productReg = /(product|pid|idproduct|0x?[0-9a-f]{4})[^0-9a-f]*([0-9a-f]{4})/i;

		let vendorStr = vendorReg.exec(id)?.[2] ?? null;
		let productStr = productReg.exec(id)?.[2] ?? null;

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

	/** Requests the Sony HID device and initializes it. */
	public async init(gamepad?: Gamepad): Promise<void> {
		if (!("hid" in navigator)) {
			console.warn("HID API not supported in this browser.");
			return; // HID not supported (e.g. Safari)
		}

		const known = await navigator.hid.getDevices?.() ?? [];

		let ids: { vendorId: number; productId: number } | null = null;
		if (gamepad) {
			this.assignedIndex = gamepad.index;
			ids = this.parseGamepadId(gamepad.id);
			if (!ids) {
				console.warn(`Failed to parse VID/PID from gamepad.id: "${gamepad.id}"`);
			}
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

		let candidates: HIDDevice[] = [];
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
				console.info(`Multiple HID devices match ${ids ? `VID/PID (${ids.vendorId.toString(16)}:${ids.productId.toString(16)})` : 'accepted Sony devices'}. Prompting user to select.`);
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
				const serial = (d as unknown as { serialNumber?: string }).serialNumber || 'none';
				return `${d.productName} (${d.vendorId.toString(16)}:${d.productId.toString(16)}) serial: ${serial}`;
			}));
			return; // No device found
		}

		console.info(`Found Sony HID device: ${this.device.productName} (${this.device.vendorId.toString(16)}:${this.device.productId.toString(16)}) serial: ${(this.device as unknown as { serialNumber?: string }).serialNumber || 'none'}`);

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

	private detectPadKind(dev: HIDDevice): HidPadKind {
		const has05 = dev.collections.some(c => c.outputReports?.some(r => r.reportId === 0x05)); // DS4-USB
		const has02 = dev.collections.some(c => c.outputReports?.some(r => r.reportId === 0x02)); // DS5-USB
		const has11 = dev.collections.some(c => c.outputReports?.some(r => r.reportId === 0x11)); // DS4-BT
		const has31 = dev.collections.some(c => c.outputReports?.some(r => r.reportId === 0x31)); // DS5-BT

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
	public async correlateWithInput(gamepad: Gamepad, candidates: HIDDevice[], timeoutMs: number = 5000): Promise<HIDDevice | null> {
		if (candidates.length <= 1) return candidates[0] ?? null;

		console.info('Multiple candidates; starting input correlation. Press a button on the target controller.');

		const prevGamepadState = { buttons: gamepad.buttons.map(b => b.pressed), axes: [...gamepad.axes] };
		const hidInputPromises = candidates.map(device => new Promise<{ device: HIDDevice; changed: boolean }>((resolve) => {
			const onInput = (_event: HIDInputReportEvent) => {
				device.removeEventListener('inputreport', onInput);
				resolve({ device, changed: true });
			};
			device.addEventListener('inputreport', onInput);
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
		candidates.forEach(d => d.removeEventListener('inputreport', () => { })); // Clean up

		if (result && result.changed) {
			console.info(`Matched HID device via input: ${result.device.productName} serial: ${(result.device as unknown as { serialNumber?: string }).serialNumber || 'none'}`);
			return result.device;
		}
		console.warn('Input correlation timed out or no match.');
		return null;
	}

	/**
		 * Stops the current rumble effect and resets the device.
		 */
	public stop(): void {
		if (this.rumbleTimer) {
			clearTimeout(this.rumbleTimer);
			this.rumbleTimer = null;
		}
		if (this.device?.opened) {
			// Zero‑out the rumble effect
			this.sendRumble({ strong: 0, weak: 0, duration: 0 });
		}
	}

	/**
	 * Sends a rumble effect to the DualSense Edge HID device.
	 * @param strong The intensity of the strong motor (0-255).
	 * @param weak The intensity of the weak motor (0-255).
	 * @param duration The duration of the rumble effect in milliseconds.
	 */
	public sendRumble({ strong, weak, duration }: HidRumbleParams): void {
		if (!this.device?.opened) {
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
			clearTimeout(this.rumbleTimer);
			this.rumbleTimer = window.setTimeout(() => this.stop(), duration);
		}
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
		if (this.device?.opened) {
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
			clearTimeout(this.rumbleTimer);
			this.rumbleTimer = null;
		}
	}
}
