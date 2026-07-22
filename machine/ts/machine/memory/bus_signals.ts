export const MAPPED_BUS_MASTER_CPU = 0;
export const MAPPED_BUS_MASTER_DMA = 1;
export const MAPPED_BUS_DMA_BLOCK_END = 2;

// IO handlers and write-ready lines receive the initiating master plus raw bus
// strobes. DMA asserts BLOCK_END on the final word of an admitted hardware block.
export type MappedBusSignals = number;
