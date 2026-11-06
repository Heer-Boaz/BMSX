import { readI64LE, readLE64, writeLE64 } from '../endian';
import { utf8ByteLength } from '../utf8';

// Typed storage streams. Field order and widths belong to the consuming codec;
// there are no property names, type tags, object identities or migration rules.
export interface BinarySink {
	u8(value: number): void;
	u16(value: number): void;
	i16(value: number): void;
	u32(value: number): void;
	i32(value: number): void;
	u64(value: number): void;
	i64(value: number): void;
	f64(value: number): void;
	bool(value: boolean): void;
	bytes(value: Uint8Array): void;
	u8s(value: ArrayLike<number>): void;
	u32s(value: ArrayLike<number>): void;
	i32s(value: ArrayLike<number>): void;
	string(value: string): void;
}

export class BinarySize implements BinarySink {
	public length = 0;
	public u8(_value: number): void { this.length += 1; }
	public u16(_value: number): void { this.length += 2; }
	public i16(_value: number): void { this.length += 2; }
	public u32(_value: number): void { this.length += 4; }
	public i32(_value: number): void { this.length += 4; }
	public u64(_value: number): void { this.length += 8; }
	public i64(_value: number): void { this.length += 8; }
	public f64(_value: number): void { this.length += 8; }
	public bool(_value: boolean): void { this.length += 1; }
	public bytes(value: Uint8Array): void { this.length += value.byteLength; }
	public u8s(value: ArrayLike<number>): void { this.length += value.length; }
	public u32s(value: ArrayLike<number>): void { this.length += value.length * 4; }
	public i32s(value: ArrayLike<number>): void { this.length += value.length * 4; }
	public string(value: string): void { this.length += 4 + utf8ByteLength(value); }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class BinaryWriter implements BinarySink {
	private readonly view: DataView;
	public length = 0;
	public constructor(private readonly output: Uint8Array) {
		this.view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	}
	public u8(value: number): void { this.view.setUint8(this.length, value); this.length += 1; }
	public u16(value: number): void { this.view.setUint16(this.length, value, true); this.length += 2; }
	public i16(value: number): void { this.view.setInt16(this.length, value, true); this.length += 2; }
	public u32(value: number): void { this.view.setUint32(this.length, value, true); this.length += 4; }
	public i32(value: number): void { this.view.setInt32(this.length, value, true); this.length += 4; }
	public u64(value: number): void { writeLE64(this.output, this.length, value); this.length += 8; }
	public i64(value: number): void { writeLE64(this.output, this.length, value); this.length += 8; }
	public f64(value: number): void { this.view.setFloat64(this.length, value, true); this.length += 8; }
	public bool(value: boolean): void { this.u8(value ? 1 : 0); }
	public bytes(value: Uint8Array): void { this.output.set(value, this.length); this.length += value.byteLength; }
	public u8s(value: ArrayLike<number>): void {
		for (let index = 0; index < value.length; ++index) this.u8(value[index]);
	}
	public u32s(value: ArrayLike<number>): void {
		for (let index = 0; index < value.length; ++index) this.u32(value[index]);
	}
	public i32s(value: ArrayLike<number>): void {
		for (let index = 0; index < value.length; ++index) this.i32(value[index]);
	}
	public string(value: string): void {
		// encodeInto writes into the final buffer, not a temporary UTF-8 payload.
		const lengthOffset = this.length;
		this.length += 4;
		const { written } = encoder.encodeInto(value, this.output.subarray(this.length));
		this.view.setUint32(lengthOffset, written, true);
		this.length += written;
	}
}

export class BinaryReader {
	private readonly view: DataView;
	private offset = 0;
	public constructor(private readonly input: Uint8Array) {
		this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	}
	private take(count: number): number {
		const offset = this.offset;
		if (count > this.input.byteLength - offset) throw new RangeError('Truncated binary payload.');
		this.offset += count;
		return offset;
	}
	public u8(): number { return this.view.getUint8(this.take(1)); }
	public u16(): number { return this.view.getUint16(this.take(2), true); }
	public i16(): number { return this.view.getInt16(this.take(2), true); }
	public u32(): number { return this.view.getUint32(this.take(4), true); }
	public i32(): number { return this.view.getInt32(this.take(4), true); }
	public u64(): number { return readLE64(this.input, this.take(8)); }
	public i64(): number { return readI64LE(this.input, this.take(8)); }
	public f64(): number { return this.view.getFloat64(this.take(8), true); }
	public bool(): boolean { return this.u8() !== 0; }
	public bytes(count: number): Uint8Array {
		const offset = this.take(count);
		return new Uint8Array(this.input.subarray(offset, offset + count));
	}
	public u8s(count: number): number[] {
		const offset = this.take(count);
		const values = new Array<number>(count);
		for (let index = 0; index < count; ++index) values[index] = this.view.getUint8(offset + index);
		return values;
	}
	public u32s(count: number): number[] {
		const offset = this.take(count * 4);
		const values = new Array<number>(count);
		for (let index = 0; index < count; ++index) values[index] = this.view.getUint32(offset + index * 4, true);
		return values;
	}
	public i32s(count: number): number[] {
		const offset = this.take(count * 4);
		const values = new Array<number>(count);
		for (let index = 0; index < count; ++index) values[index] = this.view.getInt32(offset + index * 4, true);
		return values;
	}
	public u32Array(count: number): Uint32Array {
		const offset = this.take(count * 4);
		const values = new Uint32Array(count);
		for (let index = 0; index < count; ++index) values[index] = this.view.getUint32(offset + index * 4, true);
		return values;
	}
	public string(): string {
		const count = this.u32();
		const offset = this.take(count);
		return decoder.decode(this.input.subarray(offset, offset + count));
	}
	public array<T>(readValue: (reader: BinaryReader) => T): T[] {
		const count = this.u32();
		const values = new Array<T>(count);
		for (let index = 0; index < count; ++index) values[index] = readValue(this);
		return values;
	}
	public finish(): void {
		if (this.offset !== this.input.byteLength) throw new RangeError('Trailing binary payload.');
	}
}
