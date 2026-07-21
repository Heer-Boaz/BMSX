export const MAPPED_BUS_MASTER_CPU = 0;
export const MAPPED_BUS_MASTER_DMA = 1;
export const MAPPED_BUS_DMA_BLOCK_END = 2;
export const MAPPED_BUS_DMA_TRANSFER_END = 4;

// IO handlers receive the initiating master plus raw bus strobes. DMA asserts
// BLOCK_END on the final word of an admitted hardware block and TRANSFER_END
// on the final word of the programmed transfer.
export type MappedBusSignals = number;
