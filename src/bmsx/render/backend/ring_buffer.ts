// Lightweight ring-cursor for typed float data written into a GPU-backed buffer.
// Provides contiguous allocations; if not enough space remains, wraps to 0.

export class FloatRingCursor {
    private head = 0;
    constructor(private readonly capacityFloats: number) { }
    reset(): void { this.head = 0; }
    alloc(countFloats: number): number {
        if (countFloats > this.capacityFloats) {
            // Clamp: caller requested more than total capacity; place at start
            this.head = 0; return 0;
        }
        if (this.head + countFloats > this.capacityFloats) {
            // Wrap to start
            this.head = 0;
        }
        const start = this.head;
        this.head += countFloats;
        return start;
    }
    get capacity(): number { return this.capacityFloats; }
}

