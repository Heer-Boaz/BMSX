export const GC_COLOR_OFFSET = 1;
export const GC_RECORD_SHIFT = 3;
export const GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
export const GC_GRAY_INDEX_BITS = 19;
export const GC_GRAY_INDEX_MASK = (1 << GC_GRAY_INDEX_BITS) - 1;
