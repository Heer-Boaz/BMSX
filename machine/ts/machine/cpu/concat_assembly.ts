import { FNV1A32_OFFSET_BASIS, hashBytes } from '../../common/hash';
import type { StringPool } from './string_pool';
import { ValueTag, valuePayload, valueTag, valueToByteString, type Value } from './value';

export type ConcatAssemblyState = {
	length: number; instructionPc: number; destination: number; source: number; offset: number; hash: number;
	values: Value[]; lengths: number[]; bytes: Uint8Array;
};

// The private byte buffer is not a guest record. Only its consumed prefix
// is part of the machine state; retained host capacity is never serialized.
export class ConcatAssembly {
	length = 0;
	instructionPc = 0;
	destination = 0;
	source = 0;
	offset = 0;
	hash = 0;
	cursor = 0;
	values: Value[] = [];
	lengths: number[] = [];
	bytes = new Uint8Array(0);

	start(length: number, instructionPc: number, destination: number): void {
		if (length > this.bytes.length) this.bytes = new Uint8Array(length);
		this.length = length; this.instructionPc = instructionPc; this.destination = destination;
		this.cursor = this.source = this.offset = 0; this.hash = FNV1A32_OFFSET_BASIS;
	}

	append(strings: StringPool, amount: number): void {
		const start = this.cursor;
		while (amount !== 0) {
			const v = this.values[this.source], size = this.lengths[this.source];
			const n = Math.min(amount, size - this.offset);
			if (valueTag(v) === ValueTag.String) strings.copyBytes(valuePayload(v), this.offset, n, this.bytes, this.cursor);
			else {
				const text = valueToByteString(v, strings);
				for (let i = 0; i < n; ++i) this.bytes[this.cursor + i] = text.charCodeAt(this.offset + i);
			}
			this.cursor += n; this.offset += n; amount -= n;
			if (this.offset === size) { ++this.source; this.offset = 0; }
		}
		this.hash = hashBytes(this.bytes, start, this.cursor - start, 0, this.hash);
	}

	capture(): ConcatAssemblyState | null {
		if (!this.length) return null;
		return { length: this.length, instructionPc: this.instructionPc, destination: this.destination, source: this.source, offset: this.offset,
			hash: this.hash, values: this.values.slice(), lengths: this.lengths.slice(), bytes: this.bytes.slice(0, this.cursor) };
	}

	restore(state: ConcatAssemblyState | null): void {
		if (state === null) { this.length = 0; return; }
		this.start(state.length, state.instructionPc, state.destination);
		this.source = state.source; this.offset = state.offset; this.hash = state.hash;
		this.values = state.values.slice(); this.lengths = state.lengths.slice();
		this.bytes.set(state.bytes); this.cursor = state.bytes.length;
	}
}
