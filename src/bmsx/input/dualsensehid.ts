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
const DUALSHOCK4_PID = 0x09cc; // DualShock 4
const ACCEPTED_VENDORS_PRODUCTS = [
    { vendorId: SONY_VID, productId: DUALSENSE_EDGE_PID },
    { vendorId: SONY_VID, productId: DUALSENSE_STANDARD_PID },
    { vendorId: SONY_VID, productId: DUALSHOCK4_PID },
] as const;

type HidPadKind = "dualsense" | "ds4"; // DualSense Edge, DualSense standard, or DualShock 4

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

    /** Requests the DualSense Edge HID device and initializes it. */
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
            console.warn("DualSense Edge HID device not found or selected.");
            return; // DualSense Edge not selected.
        }

        switch (this.device.productId) {
            case DUALSENSE_EDGE_PID:
            case DUALSENSE_STANDARD_PID:
                this.kind = "dualsense";
                break;
            case DUALSHOCK4_PID:
                this.kind = "ds4";
                break;
            default:
                console.warn(`Unsupported DualSense HID device: "${this.device.productId}", cannot set the "kind" property to determine how to sent the HID report.`);
                break;
        }

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
            case "dualsense":
                report = this.buildDualSenseReport(strong, weak);
                break;
            case "ds4":
                report = this.buildDs4Report(strong, weak);
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

    /** DualShock 4 USB – report 0x05 (32 B) */
    private buildDs4Report(strong: number, weak: number): Uint8Array {
        const r = new Uint8Array(32);
        r[0] = 0x05;
        r[1] = 0xFF;                  // constant according to docs
        r[4] = weak & 0xFF;           // R motor
        r[5] = strong & 0xFF;         // L motor
        // Others: nul → led, audio, etc. off
        return r;
    }
}
