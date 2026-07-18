export const MAPPED_BUS_MASTER_CPU = 0;
export const MAPPED_BUS_MASTER_DMA = 1;
export const MAPPED_BUS_DMA_GRANT_END = 2;

// IO handlers receive the initiating master plus raw bus strobes. DMA asserts
// GRANT_END on the final word of an admitted service grant.
export type MappedBusSignals = number;
