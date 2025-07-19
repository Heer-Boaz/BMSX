/// <reference types="w3c-web-hid" />
/**
 * Sony DualSense Edge – vendor‑ & product‑IDs (USB‑modus)
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

    public get isConnected(): boolean {
        return this.device?.opened ?? false;
    }

    /** Requests the Sony HID device and initializes it. */
    public async init(): Promise<void> {
        if (!("hid" in navigator)) {
            console.warn("HID API not supported in this browser.");
            return; // HID not supported (e.g. Safari)
        }

        // Are there devices for which we already granted permission?
        const known = await navigator.hid.getDevices?.() ?? [];

        // Find a known DualSense Edge HID device or request a new one
        this.device =
            known.find(d => d.vendorId === SONY_VID &&
                ACCEPTED_VENDORS_PRODUCTS.some(p => p.productId === d.productId)) ??
            (await navigator.hid.requestDevice({
                filters: ACCEPTED_VENDORS_PRODUCTS.map(p => ({ vendorId: p.vendorId, productId: p.productId }))
            }))?.[0];

        if (!this.device) {
            console.info('Did not find any recognized controller device.');
            console.info('Known devices:', known.map(d => `${d.productName} (${d.vendorId.toString(16)}:${d.productId.toString(16)})`));
            console.info('Trying to open any Sony device...');

            // No device found, but we might have a Sony device that we can try to open.
            this.device = known.find(d => d.vendorId === SONY_VID);
            if (!this.device) {
                console.info('No Sony HID device found.');
                return; // No device found
            }

            return;
        }

        console.info(`Found Sony HID device and will attempt to determine its kind: ${this.device.productName} (${this.device.vendorId.toString(16)}:${this.device.productId.toString(16)})`);

        function detectPadKind(dev: HIDDevice): HidPadKind {
            const has05 = dev.collections.some(c =>
                c.outputReports?.some(r => r.reportId === 0x05));   // DS4‑USB

            const has02 = dev.collections.some(c =>
                c.outputReports?.some(r => r.reportId === 0x02));   // DS5‑USB

            const has11 = dev.collections.some(c =>
                c.outputReports?.some(r => r.reportId === 0x11));   // DS4‑BT

            const has31 = dev.collections.some(c =>
                c.outputReports?.some(r => r.reportId === 0x31));   // DS5‑BT

            if (has02) return 'ds5_usb';
            if (has05) return 'ds4_usb';
            if (has31) return 'ds5_bt';
            if (has11) return 'ds4_bt';
            return null;
        }

        this.kind = detectPadKind(this.device);
        console.info(`Detected Sony HID device: ${this.kind ?? 'but it is unknown :-('}`);
        if (!this.device.opened) await this.device.open(); // Open the device
    }

    /**
     * Stops the current rumble effect and resets the device.
     */
    public stop(): void {
        if (this.rumbleTimer) {
            clearTimeout(this.rumbleTimer ?? 0);
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
                report = this.buildDs4Report(strong, weak);
                break;
            case 'ds4_bt':
                report = this.buildDs4BtReport(strong, weak);
                break;
            default:
                console.warn(`Unknown pad type: "${this.kind}"`);
                return;
        }

        this.device.sendReport(report[0], report.subarray(1));

        // Automatically stop after `duration` ms.
        if (duration > 0) {
            clearTimeout(this.rumbleTimer ?? 0);
            this.rumbleTimer = window.setTimeout(() => this.stop(), duration);
        }
    }

    /** DualSense USB – report 0x02 (48 B) */
    private buildDualSenseReport(strong: number, weak: number): Uint8Array {
        const r = new Uint8Array(48);
        r[0] = 0x02;
        r[1] = 0xFF; r[2] = 0xFF;      // enable flags
        r[3] = weak & 0xFF;            // R motor
        r[4] = strong & 0xFF;          // L motor
        return r;
    }

    /** DualShock 4 USB – report 0x05 (32 B) */
    private buildDs4Report(strong: number, weak: number): Uint8Array {
        const r = new Uint8Array(32);
        r[0] = 0x05;          // Report‑ID
        r[1] = 0x01;          // 0x01 = Enable rumble only (was 0x07 which also enabled LED and blinking)
        r[2] = 0x00;          // Setting control flags should be 0x00 for rumble
        r[4] = weak & 0xFF;   // RumbleRight (weak motor) - index corrected
        r[5] = strong & 0xFF; // RumbleLeft (strong motor) - index corrected
        // Initialize remaining bytes to ensure compatibility
        for (let i = 6; i < 32; i++) {
            r[i] = 0x00;
        }
        return r;
    }

    private crc32_bt(data: Uint8Array): number {
        // CRC-32 implementation for the BT report
        let crc = 0xFFFFFFFF;
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

    /** DualShock 4 USB – report 0x05 (32 B) */
    /** 78-byte BT report 0x11 + CRC-32 */
    private buildDs4BtReport(strong: number, weak: number): Uint8Array {
        const r = new Uint8Array(78);
        r[0] = 0x11;
        r[1] = 0xC0;          // onbekend, door Sony zo gebruikt
        r[2] = 0x20;          // idem
        r[3] = 0xF1;          // motor-only
        r[4] = 0x04;          // idem
        r[6] = weak;          // R-motor
        r[7] = strong;        // L-motor
        // … vul evt. audio- & LED-velden (r[21]–r[25]) …
        // 4 CRC-bytes op het einde:
        const crc = this.crc32_bt(r.subarray(0, 74));   // A2-header + report
        r[74] = crc & 0xFF;
        r[75] = (crc >> 8) & 0xFF;
        r[76] = (crc >> 16) & 0xFF;
        r[77] = (crc >> 24) & 0xFF;
        return r;
    }

    private buildDs5BtReport(strong: number, weak: number): Uint8Array {
        // The DualSense Edge BT report is similar to the DS4 BT report, but with
        // different report ID and structure.
        const r = new Uint8Array(78);
        r[0] = 0x11;          // Report ID for DualSense Edge BT
        r[1] = 0xC0;          // Unknown, used by Sony
        r[2] = 0x20;          // Same as DS4
        r[3] = 0xF1;          // Motor-only
        r[4] = 0x04;          // Same as DS4
        r[6] = weak;          // R-motor
        r[7] = strong;        // L-motor
        // Fill in audio & LED fields if needed (r[21]–r[25])
        // 4 CRC bytes at the end:
        const crc = this.crc32_bt(r.subarray(0, 74));   // A2-header + report
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
            await this.device.close();
        }
        this.device = null;
        this.kind = null;
        if (this.rumbleTimer) {
            clearTimeout(this.rumbleTimer);
            this.rumbleTimer = null;
        }
    }
}
