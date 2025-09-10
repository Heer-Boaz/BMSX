/**
 * Lightweight ring cursor for typed data (for example, float data written into a GPU-backed buffer).
 *
 * Provides contiguous allocations within a fixed-size capacity measured in items.
 * Allocations return a 0-based start index into the buffer. If an allocation does not
 * fit before the end of the capacity the cursor wraps to index 0 and the allocation
 * is placed there. If the requested allocation count exceeds the total capacity, the
 * cursor is clamped and the allocation is placed at 0.
 *
 * This class does not track live ranges or perform synchronization; callers must
 * ensure allocations are coordinated with consumers (for example, GPU uploads).
 *
 * @remarks
 * - reset() moves the head back to 0.
 * - alloc(count) returns the start index for a contiguous block of `count` items.
 * - capacity getter returns the configured total capacity in items.
 *
 * @example
 * const cursor = new RingCursor(1024);
 * const startIndex = cursor.alloc(256); // startIndex is an index into a typed buffer
 *
 * @param capacityItems - Total number of items the ring cursor can allocate.
 */
export class RingCursor {
    private head = 0;
    constructor(private readonly capacityItems: number) { }
    reset(): void { this.head = 0; }
    alloc(count: number): number {
        if (count > this.capacityItems) {
            // Clamp: caller requested more than total capacity; place at start
            this.head = 0; return 0;
        }
        if (this.head + count > this.capacityItems) {
            // Wrap to start
            this.head = 0;
        }
        const start = this.head;
        this.head += count;
        return start;
    }
    get capacity(): number { return this.capacityItems; }
}

