import { RAM_REFERENCE_MASK } from '../../../machine/ts/spec/bmsx/memory_map';

export const GC_COLOR_OFFSET = 1;
export const GC_COLOR_MASK = 0x03;
export const GC_RECORD_SHIFT = 3;
export const GC_RECORD_ALIGNMENT = 1 << GC_RECORD_SHIFT;
export const GC_RECORD_MASK = RAM_REFERENCE_MASK;
export const GC_RECORD_LINK = 4;
export const GC_OBJECT_PREFIX = GC_RECORD_ALIGNMENT;
export const GC_OBJECT_LINK_BEFORE = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
export const GC_GRAY_INDEX_BITS = 19;
export const GC_GRAY_INDEX_MASK = (1 << GC_GRAY_INDEX_BITS) - 1;

export const CLOSURE_CANONICAL = 4;
