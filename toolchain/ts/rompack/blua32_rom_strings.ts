import { byteStringFromBytes, writeByteString } from '../../../machine/ts/common/byte_string';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashText } from '../../../machine/ts/common/hash';
import { nextPowerOfTwo } from '../../../machine/ts/machine/common/numeric';
import {
	BLUA32_STRING_HASH_OFFSET,
	BLUA32_STRING_LENGTH_OFFSET,
	BLUA32_STRING_NEXT_OFFSET,
	BLUA32_STRING_RECORD_ALIGNMENT,
	BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_RECORD_KIND,
	BLUA32_STRING_RECORD_ROM_FLAG,
} from '../../../machine/ts/spec/blua32/image_format';
import { alignBlua32ImageOffset, type Blua32ImageLayout } from './blua32_image';

/** Enumerates the records, not just the strings referenced by the current code. */
export function* blua32RomStrings(image: Blua32ImageLayout): IterableIterator<{ address: number; value: string }> {
	const { bytes, address: base, header } = image;
	const first = header.stringBucketAddress - base;
	for (let i = 0; i < header.stringBucketCount; ++i) {
		let address = readLE32(bytes, first + 4 * i);
		while (address !== 0) {
			const offset = address - base;
			const length = readLE32(bytes, offset + BLUA32_STRING_LENGTH_OFFSET);
			yield { address, value: byteStringFromBytes(bytes, offset + BLUA32_STRING_RECORD_HEADER_SIZE, length) };
			address = readLE32(bytes, offset + BLUA32_STRING_NEXT_OFFSET);
		}
	}
}

/** Live values carry the installed addresses. A revision keeps the old region
 * and appends new records, even if the edit removed all uses of an old literal. */
export class Blua32RomStringLayout {
	private readonly addresses = new Map<string, number>();
	private firstInstalledAddress = Infinity;
	public endAddress: number;

	public constructor(firstFreeAddress: number, previous: Blua32ImageLayout | undefined) {
		this.endAddress = alignBlua32ImageOffset(firstFreeAddress, 0, BLUA32_STRING_RECORD_ALIGNMENT);
		if (previous !== undefined) {
			for (const { address, value } of blua32RomStrings(previous)) {
				if (address < firstFreeAddress) {
					throw new Error('Hot Resume cannot move installed String records. Rebuild and boot the ROM.');
				}
				this.addresses.set(value, address);
				this.firstInstalledAddress = Math.min(this.firstInstalledAddress, address);
				this.endAddress = Math.max(this.endAddress, alignBlua32ImageOffset(address + BLUA32_STRING_RECORD_HEADER_SIZE + value.length, 0, BLUA32_STRING_RECORD_ALIGNMENT));
			}
		}
	}

	// Keep a cartridge's original table placement when the table still fits.
	// A revision that outgrows this space relocates the table, not live Strings.
	public reservePrefix(endAddress: number): boolean {
		if (endAddress > this.firstInstalledAddress) return false;
		this.endAddress = Math.max(this.endAddress,
			alignBlua32ImageOffset(endAddress, 0, BLUA32_STRING_RECORD_ALIGNMENT));
		return true;
	}

	public add(value: string): void {
		if (this.addresses.has(value)) return;
		this.addresses.set(value, this.endAddress);
		this.endAddress = alignBlua32ImageOffset(this.endAddress + BLUA32_STRING_RECORD_HEADER_SIZE + value.length, 0, BLUA32_STRING_RECORD_ALIGNMENT);
	}

	public addressOf(value: string): number { return this.addresses.get(value)!; }
	public bucketCount(): number { return nextPowerOfTwo(Math.max(1, this.addresses.size)); }

	public write(bytes: Uint8Array, base: number, bucketOffset: number, bucketCount: number): void {
		for (const [value, address] of this.addresses) {
			const record = address - base;
			const hash = hashText(value);
			const bucket = bucketOffset + 4 * (hash & (bucketCount - 1));
			writeLE32(bytes, record, BLUA32_STRING_RECORD_KIND | BLUA32_STRING_RECORD_ROM_FLAG);
			writeLE32(bytes, record + BLUA32_STRING_HASH_OFFSET, hash);
			writeLE32(bytes, record + BLUA32_STRING_LENGTH_OFFSET, value.length);
			writeLE32(bytes, record + BLUA32_STRING_NEXT_OFFSET, readLE32(bytes, bucket));
			writeByteString(bytes, record + BLUA32_STRING_RECORD_HEADER_SIZE, value);
			writeLE32(bytes, bucket, address);
		}
	}
}
