import { readLE32 } from '../../machine/ts/common/endian';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import {
	EXECUTION_IMAGE_BINDING_SPAN_OFFSET,
	executionImageBindingOffset,
	type ExecutionDomainId,
} from '../../machine/ts/spec/blua32/execution_domain';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_PAYLOAD_OFFSET,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_TAG_OFFSET,
	BLUA32_GLOBAL_NAME_ADDRESS_OFFSET,
	BLUA32_GLOBAL_NAME_RECORD_SIZE,
	BLUA32_IMAGE_MAPPED_CODE_FLAG,
	BLUA32_STRING_HASH_OFFSET,
	BLUA32_STRING_NEXT_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import { blua32RomStrings } from '../../toolchain/ts/rompack/blua32_rom_strings';

function sameNameSlots(previous: Blua32ImageLayout, oldTable: number,
	next: Blua32ImageLayout, newTable: number, count: number): boolean {
	const oldOffset = oldTable - previous.address, newOffset = newTable - next.address;
	for (let slot = 0; slot < count; ++slot) {
		const word = slot * BLUA32_GLOBAL_NAME_RECORD_SIZE + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET;
		if (readLE32(previous.bytes, oldOffset + word) !== readLE32(next.bytes, newOffset + word)) return false;
	}
	return true;
}

function nextStringConstant(image: Blua32ImageLayout, slot: number): number {
	const table = image.header.constantTableAddress - image.address;
	while (slot < image.header.constantCount
		&& readLE32(image.bytes, table + slot * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET) !== Blua32ConstantTag.String) {
		++slot;
	}
	return slot;
}

/** Verify the retained operand prefix and report whether firmware must prepare the image. */
export function verifyHotResumeBinding(cpu: CPU, domain: ExecutionDomainId, previous: Blua32ImageLayout, next: Blua32ImageLayout): boolean {
	const old = previous.header, revised = next.header;
	if (((old.flags ^ revised.flags) & BLUA32_IMAGE_MAPPED_CODE_FLAG) !== 0)
		throw new Error('Hot Resume changes the installed instruction addressing mode. Rebuild and boot the ROM.');
	const bssAppend = revised.bssByteCount > old.bssByteCount;
	if (old.dataAddress !== revised.dataAddress || old.dataByteCount !== revised.dataByteCount
		|| old.bssAddress !== revised.bssAddress || revised.bssByteCount < old.bssByteCount
		|| (bssAppend && (domain < 0 || cpu.activeCartridgeSlot() !== domain)))
		throw new Error('Hot Resume changes installed DATA or BSS storage. Rebuild and boot the ROM.');
	if (old.globalNameCount > revised.globalNameCount || old.systemGlobalNameCount > revised.systemGlobalNameCount
		|| !sameNameSlots(previous, old.globalNameTableAddress, next, revised.globalNameTableAddress, old.globalNameCount)
		|| !sameNameSlots(previous, old.systemGlobalNameTableAddress, next, revised.systemGlobalNameTableAddress, old.systemGlobalNameCount))
		throw new Error('Hot Resume changes the installed global-name slots. Rebuild and boot the ROM.');

	// Binding ordinals skip numeric and other immediate constants.
	const oldConstants = old.constantTableAddress - previous.address + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	const newConstants = revised.constantTableAddress - next.address + BLUA32_CONSTANT_PAYLOAD_OFFSET;
	let before = nextStringConstant(previous, 0), after = nextStringConstant(next, 0), stringCount = 0;
	while (before < old.constantCount && after < revised.constantCount) {
		if (readLE32(previous.bytes, oldConstants + before * BLUA32_CONSTANT_RECORD_SIZE)
			!== readLE32(next.bytes, newConstants + after * BLUA32_CONSTANT_RECORD_SIZE)) break;
		++stringCount;
		before = nextStringConstant(previous, before + 1);
		after = nextStringConstant(next, after + 1);
	}
	if (before !== old.constantCount)
		throw new Error('Hot Resume changes installed String literal bindings. Rebuild and boot the ROM.');

	// Firmware can continue reading the old physical directory. The packed
	// ROM size may change: neither it nor the tool/source tail is retained
	// here, only the already accessible bucket and String record spans.
	if (old.stringBucketAddress !== revised.stringBucketAddress || old.stringBucketCount !== revised.stringBucketCount)
		throw new Error('Hot Resume moves the installed ROM String directory. Rebuild and boot the ROM.');
	const installed = new Map<number, string>();
	for (const { address, value } of blua32RomStrings(previous)) installed.set(address, value);
	for (const { address, value } of blua32RomStrings(next)) {
		if (!installed.has(address)) continue;
		if (installed.get(address) !== value
			|| readLE32(previous.bytes, address - previous.address + BLUA32_STRING_HASH_OFFSET)
			!== readLE32(next.bytes, address - next.address + BLUA32_STRING_HASH_OFFSET)
			|| readLE32(previous.bytes, address - previous.address + BLUA32_STRING_NEXT_OFFSET)
			!== readLE32(next.bytes, address - next.address + BLUA32_STRING_NEXT_OFFSET))
			throw new Error('Hot Resume changes immutable ROM String records. Rebuild and boot the ROM.');
		installed.delete(address);
	}
	if (installed.size !== 0)
		throw new Error('Hot Resume changes immutable ROM String records. Rebuild and boot the ROM.');

	const bound = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), domain);
	if (cpu.memory.readRamRecordWord(bound + EXECUTION_IMAGE_BINDING_SPAN_OFFSET)
		!== 4 * (old.globalNameCount + old.systemGlobalNameCount + stringCount))
		throw new Error('Hot Resume requires the firmware-installed operand binding.');
	return old.globalNameCount !== revised.globalNameCount || old.systemGlobalNameCount !== revised.systemGlobalNameCount
		|| after !== revised.constantCount || bssAppend;
}
