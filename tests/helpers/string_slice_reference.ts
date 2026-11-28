import type { StringPool } from './native_heap/string_pool';
import { hashBytes } from '../../machine/ts/common/hash';
import { isRamStringId, type StringId } from '../../machine/ts/machine/cpu/string_pool';
import { BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_ROM_ADDRESS_MASK } from '../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

// Frozen borrowed-slice entry from 20183c7fc. Do not snapshot its source:
// the reference deliberately tests the original root and allocation order.
export function internStringSliceReference(pool: StringPool, id: StringId, first: number, count: number): StringId {
	const source = pool['storage'](id), inRam = isRamStringId(id);
	const offset = inRam ? id & (MAIN_RAM_SIZE - 1)
		: id < RAM_BASE ? id : (id & BLUA32_STRING_ROM_ADDRESS_MASK) - CART_ROM_BASE;
	const start = offset + BLUA32_STRING_RECORD_HEADER_SIZE + first;
	const at = inRam ? start & (MAIN_RAM_SIZE - 1) : start;
	const wrapped = inRam ? Math.max(0, at + count - MAIN_RAM_SIZE) : 0;
	return pool['internSource'](hashBytes(source, at, count, wrapped), source, at, count, id, wrapped);
}
