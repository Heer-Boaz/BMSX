/// <reference types="w3c-web-hid" />
/**
 * Sony DualSense Edge – vendor‑ & product‑IDs (USB‑modus)
 * 0x054C = Sony Interactive Entertainment
 * 0x0DF2 = DualSense Edge
 */
const DUALSENSE_USB = { vendorId: 0x054c, productId: 0x0df2 } as const;


export interface HidRumbleParams {
    /** 0 – 255, left (strong) motor */
    strong: number;
    /** 0 – 255, right (weak) motor */
    weak: number;
    /** Duration in ms; 0 = continue */
    duration: number;
}

export class DualSenseEdgeHID {
    private device: HIDDevice | null = null;
    private rumbleTimer: number | null = null;

    public get isConnected(): boolean {
        return this.device?.opened ?? false;
    }

    /** Requests the DualSense Edge HID device and initializes it. */
    public async init(): Promise<void> {
        if (!("hid" in navigator)) {
            console.warn("HID API not supported in this browser.");
            return; // HID not supported (e.g. Safari)
        }

        // Devices already known?
        const known = navigator.hid.getDevices
            ? await navigator.hid.getDevices()
            : [];
        this.device =
            known.find(d => d.vendorId === DUALSENSE_USB.vendorId &&
                d.productId === DUALSENSE_USB.productId) ??
            (await navigator.hid.requestDevice({
                filters: [DUALSENSE_USB]
            }))[0];

        if (!this.device) {
            console.warn("DualSense Edge HID device not found or selected.");
            return; // DualSense Edge not selected.
        }

        if (!this.device.opened) await this.device.open(); // Open the device
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

        /**
         * USB‑rapportformat (48 bytes) – simplified:
         * Byte 0   : Report ID 0x02
         * Byte 1‑2 : Always 0xFF 0xFF (enable flags)
         * Byte 3   : Weak (0‑255)  – right motor
         * Byte 4   : Strong(0‑255) – left motor
         * Rest     : 0 standard rumble
         */
        const report = new Uint8Array(48);
        report[0] = 0x02;
        report[1] = 0xFF;
        report[2] = 0xFF;
        report[3] = weak & 0xFF;
        report[4] = strong & 0xFF;

        void this.device.sendReport(report[0], report.subarray(1));

        // Automatically stop after `duration` ms.
        if (duration > 0) {
            if (this.rumbleTimer) clearTimeout(this.rumbleTimer);
            this.rumbleTimer = window.setTimeout(() => this.stop(), duration);
        }
    }
}
