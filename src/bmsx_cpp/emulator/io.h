#pragma once

#include "memory_map.h"

namespace bmsx {

/**
 * Runtime I/O memory layout constants.
 *
 * The runtime exposes a memory-mapped register bank followed by a payload
 * staging area for variable-length submit data.
 */

// I/O command codes
constexpr int IO_CMD_VDP_CLEAR = 0x10;
constexpr int IO_CMD_VDP_FILL_RECT = 0x11;
constexpr int IO_CMD_VDP_BLIT = 0x12;
constexpr int IO_CMD_VDP_DRAW_LINE = 0x13;
constexpr int IO_CMD_VDP_GLYPH_RUN = 0x14;
constexpr int IO_CMD_VDP_TILE_RUN = 0x15;

constexpr uint32_t IO_VDP_TILE_HANDLE_NONE = 0xffffffffu;

constexpr int IO_SYS_BASE_INDEX = 0;

// System flag: should boot cartridge?
constexpr int IO_SYS_BOOT_CART_INDEX = IO_SYS_BASE_INDEX;
constexpr int IO_SYS_CART_BOOTREADY_INDEX = IO_SYS_BASE_INDEX + 1;

// Number of system flag slots
constexpr int IO_SYS_SIZE = 2;
constexpr int IO_VDP_BASE_INDEX = IO_SYS_BASE_INDEX + IO_SYS_SIZE;
constexpr int IO_VDP_DITHER_INDEX = IO_VDP_BASE_INDEX;
constexpr int IO_VDP_PRIMARY_ATLAS_ID_INDEX = IO_VDP_BASE_INDEX + 1;
constexpr int IO_VDP_SECONDARY_ATLAS_ID_INDEX = IO_VDP_BASE_INDEX + 2;
constexpr int IO_VDP_RD_SURFACE_INDEX = IO_VDP_BASE_INDEX + 3;
constexpr int IO_VDP_RD_X_INDEX = IO_VDP_BASE_INDEX + 4;
constexpr int IO_VDP_RD_Y_INDEX = IO_VDP_BASE_INDEX + 5;
constexpr int IO_VDP_RD_MODE_INDEX = IO_VDP_BASE_INDEX + 6;
constexpr int IO_VDP_RD_STATUS_INDEX = IO_VDP_BASE_INDEX + 7;
constexpr int IO_VDP_RD_DATA_INDEX = IO_VDP_BASE_INDEX + 8;
constexpr int IO_VDP_CMD_INDEX = IO_VDP_BASE_INDEX + 9;
constexpr int IO_VDP_CMD_ARG0_INDEX = IO_VDP_BASE_INDEX + 10;
constexpr int IO_VDP_CMD_ARG_COUNT = 18;
constexpr int IO_VDP_SIZE = 10 + IO_VDP_CMD_ARG_COUNT;

constexpr int IO_IRQ_BASE_INDEX = IO_VDP_BASE_INDEX + IO_VDP_SIZE;
constexpr int IO_IRQ_FLAGS_INDEX = IO_IRQ_BASE_INDEX;
constexpr int IO_IRQ_ACK_INDEX = IO_IRQ_BASE_INDEX + 1;
constexpr int IO_IRQ_SIZE = 2;

constexpr int IO_DMA_BASE_INDEX = IO_IRQ_BASE_INDEX + IO_IRQ_SIZE;
constexpr int IO_DMA_SRC_INDEX = IO_DMA_BASE_INDEX;
constexpr int IO_DMA_DST_INDEX = IO_DMA_BASE_INDEX + 1;
constexpr int IO_DMA_LEN_INDEX = IO_DMA_BASE_INDEX + 2;
constexpr int IO_DMA_CTRL_INDEX = IO_DMA_BASE_INDEX + 3;
constexpr int IO_DMA_STATUS_INDEX = IO_DMA_BASE_INDEX + 4;
constexpr int IO_DMA_WRITTEN_INDEX = IO_DMA_BASE_INDEX + 5;
constexpr int IO_DMA_SIZE = 6;

constexpr int IO_IMG_BASE_INDEX = IO_DMA_BASE_INDEX + IO_DMA_SIZE;
constexpr int IO_IMG_SRC_INDEX = IO_IMG_BASE_INDEX;
constexpr int IO_IMG_LEN_INDEX = IO_IMG_BASE_INDEX + 1;
constexpr int IO_IMG_DST_INDEX = IO_IMG_BASE_INDEX + 2;
constexpr int IO_IMG_CAP_INDEX = IO_IMG_BASE_INDEX + 3;
constexpr int IO_IMG_CTRL_INDEX = IO_IMG_BASE_INDEX + 4;
constexpr int IO_IMG_STATUS_INDEX = IO_IMG_BASE_INDEX + 5;
constexpr int IO_IMG_WRITTEN_INDEX = IO_IMG_BASE_INDEX + 6;
constexpr int IO_IMG_SIZE = 7;

constexpr int IO_VDP_STATUS_INDEX = IO_IMG_BASE_INDEX + IO_IMG_SIZE;
constexpr int IO_VDP_STATUS_SIZE = 1;

constexpr int IO_PAYLOAD_WRITE_PTR_INDEX = IO_VDP_STATUS_INDEX + IO_VDP_STATUS_SIZE;
constexpr int IO_PAYLOAD_ALLOC_INDEX = IO_PAYLOAD_WRITE_PTR_INDEX + 1;
constexpr int IO_PAYLOAD_DATA_INDEX = IO_PAYLOAD_ALLOC_INDEX + 1;
constexpr int IO_PAYLOAD_BUFFER_BASE_INDEX = IO_PAYLOAD_DATA_INDEX + 1;
constexpr int IO_PAYLOAD_CAPACITY = 16384;

constexpr int IO_SLOT_COUNT = IO_PAYLOAD_BUFFER_BASE_INDEX + IO_PAYLOAD_CAPACITY;

constexpr uint32_t IO_ARG_STRIDE = IO_WORD_SIZE;
constexpr uint32_t IO_PAYLOAD_WRITE_PTR_ADDR = IO_BASE + IO_PAYLOAD_WRITE_PTR_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_PAYLOAD_ALLOC_ADDR = IO_BASE + IO_PAYLOAD_ALLOC_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_PAYLOAD_DATA_ADDR = IO_BASE + IO_PAYLOAD_DATA_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_PAYLOAD_BUFFER_BASE = IO_BASE + IO_PAYLOAD_BUFFER_BASE_INDEX * IO_WORD_SIZE;

constexpr uint32_t IO_SYS_BASE = IO_BASE + IO_SYS_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_SYS_BOOT_CART = IO_BASE + IO_SYS_BOOT_CART_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_SYS_CART_BOOTREADY = IO_BASE + IO_SYS_CART_BOOTREADY_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_BASE = IO_BASE + IO_VDP_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_DITHER = IO_BASE + IO_VDP_DITHER_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_PRIMARY_ATLAS_ID = IO_BASE + IO_VDP_PRIMARY_ATLAS_ID_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_SECONDARY_ATLAS_ID = IO_BASE + IO_VDP_SECONDARY_ATLAS_ID_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_SURFACE = IO_BASE + IO_VDP_RD_SURFACE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_X = IO_BASE + IO_VDP_RD_X_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_Y = IO_BASE + IO_VDP_RD_Y_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_MODE = IO_BASE + IO_VDP_RD_MODE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_STATUS = IO_BASE + IO_VDP_RD_STATUS_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_RD_DATA = IO_BASE + IO_VDP_RD_DATA_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_CMD = IO_BASE + IO_VDP_CMD_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_CMD_ARG0 = IO_BASE + IO_VDP_CMD_ARG0_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_VDP_STATUS = IO_BASE + IO_VDP_STATUS_INDEX * IO_WORD_SIZE;

constexpr uint32_t IO_IRQ_BASE = IO_BASE + IO_IRQ_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IRQ_FLAGS = IO_BASE + IO_IRQ_FLAGS_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IRQ_ACK = IO_BASE + IO_IRQ_ACK_INDEX * IO_WORD_SIZE;

constexpr uint32_t IO_DMA_BASE = IO_BASE + IO_DMA_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_SRC = IO_BASE + IO_DMA_SRC_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_DST = IO_BASE + IO_DMA_DST_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_LEN = IO_BASE + IO_DMA_LEN_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_CTRL = IO_BASE + IO_DMA_CTRL_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_STATUS = IO_BASE + IO_DMA_STATUS_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_DMA_WRITTEN = IO_BASE + IO_DMA_WRITTEN_INDEX * IO_WORD_SIZE;

constexpr uint32_t IO_IMG_BASE = IO_BASE + IO_IMG_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_SRC = IO_BASE + IO_IMG_SRC_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_LEN = IO_BASE + IO_IMG_LEN_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_DST = IO_BASE + IO_IMG_DST_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_CAP = IO_BASE + IO_IMG_CAP_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_CTRL = IO_BASE + IO_IMG_CTRL_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_STATUS = IO_BASE + IO_IMG_STATUS_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_IMG_WRITTEN = IO_BASE + IO_IMG_WRITTEN_INDEX * IO_WORD_SIZE;

constexpr uint32_t IRQ_DMA_DONE = 1 << 0;
constexpr uint32_t IRQ_DMA_ERROR = 1 << 1;
constexpr uint32_t IRQ_IMG_DONE = 1 << 2;
constexpr uint32_t IRQ_IMG_ERROR = 1 << 3;
constexpr uint32_t IRQ_VBLANK = 1 << 4;
constexpr uint32_t IRQ_REINIT = 1 << 5;
constexpr uint32_t IRQ_NEWGAME = 1 << 6;

constexpr uint32_t VDP_STATUS_VBLANK = 1u << 0u;

constexpr uint32_t DMA_CTRL_START = 1 << 0;
constexpr uint32_t DMA_CTRL_STRICT = 1 << 1;
constexpr uint32_t DMA_STATUS_BUSY = 1 << 0;
constexpr uint32_t DMA_STATUS_DONE = 1 << 1;
constexpr uint32_t DMA_STATUS_ERROR = 1 << 2;
constexpr uint32_t DMA_STATUS_CLIPPED = 1 << 3;

constexpr uint32_t IMG_CTRL_START = 1 << 0;
constexpr uint32_t IMG_STATUS_BUSY = 1 << 0;
constexpr uint32_t IMG_STATUS_DONE = 1 << 1;
constexpr uint32_t IMG_STATUS_ERROR = 1 << 2;
constexpr uint32_t IMG_STATUS_CLIPPED = 1 << 3;

constexpr uint32_t VDP_ATLAS_ID_NONE = 0xffffffffu;
constexpr uint32_t VDP_RD_MODE_RGBA8888 = 0u;
constexpr uint32_t VDP_RD_STATUS_READY = 1u << 0u;
constexpr uint32_t VDP_RD_STATUS_OVERFLOW = 1u << 1u;

} // namespace bmsx
