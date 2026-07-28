export const IMGDEC_CONTROL_START = 1 << 0;

export const IMGDEC_STATUS_BUSY = 1 << 0;
export const IMGDEC_STATUS_DONE = 1 << 1;
export const IMGDEC_STATUS_INPUT_REQUEST = 1 << 2;
export const IMGDEC_STATUS_OUTPUT_REQUEST = 1 << 3;
export const IMGDEC_STATUS_FORMAT_FAULT = 1 << 4;

export const IMGDEC_INPUT_FIFO_WORD_CAPACITY = 32;
export const IMGDEC_OUTPUT_FIFO_WORD_CAPACITY = 64;
export const IMGDEC_DMA_BLOCK_WORDS = 16;
