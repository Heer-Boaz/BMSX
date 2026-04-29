#pragma once

#include "machine/bus/io.h"

#include <cstdint>
#include <stdexcept>
#include <string>

namespace bmsx {

enum class VdpPacketWordKind : uint8_t {
	U32 = 0,
	F32 = 1,
};

struct VdpPacketSchema {
	uint32_t cmd;
	const char* name;
	uint32_t argWords;
	const VdpPacketWordKind* argKinds;
};

inline constexpr VdpPacketWordKind VDP_CLEAR_ARG_KINDS[] = {
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
};

inline constexpr VdpPacketWordKind VDP_FILL_RECT_ARG_KINDS[] = {
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
};

inline constexpr VdpPacketWordKind VDP_DRAW_LINE_ARG_KINDS[] = {
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
};

inline constexpr VdpPacketWordKind VDP_BLIT_ARG_KINDS[] = {
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
};

inline constexpr VdpPacketWordKind VDP_GLYPH_RUN_ARG_KINDS[] = {
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::F32,
};

inline constexpr VdpPacketWordKind VDP_TILE_RUN_ARG_KINDS[] = {
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::F32,
	VdpPacketWordKind::U32,
};

inline constexpr VdpPacketWordKind VDP_CONFIG_SURFACE_ARG_KINDS[] = {
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
	VdpPacketWordKind::U32,
};

inline constexpr VdpPacketSchema VDP_CLEAR_PACKET_SCHEMA = {
	IO_CMD_VDP_CLEAR,
	"clear",
	static_cast<uint32_t>(sizeof(VDP_CLEAR_ARG_KINDS) / sizeof(VDP_CLEAR_ARG_KINDS[0])),
	VDP_CLEAR_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_FILL_RECT_PACKET_SCHEMA = {
	IO_CMD_VDP_FILL_RECT,
	"fill_rect",
	static_cast<uint32_t>(sizeof(VDP_FILL_RECT_ARG_KINDS) / sizeof(VDP_FILL_RECT_ARG_KINDS[0])),
	VDP_FILL_RECT_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_DRAW_LINE_PACKET_SCHEMA = {
	IO_CMD_VDP_DRAW_LINE,
	"draw_line",
	static_cast<uint32_t>(sizeof(VDP_DRAW_LINE_ARG_KINDS) / sizeof(VDP_DRAW_LINE_ARG_KINDS[0])),
	VDP_DRAW_LINE_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_BLIT_PACKET_SCHEMA = {
	IO_CMD_VDP_BLIT,
	"blit",
	static_cast<uint32_t>(sizeof(VDP_BLIT_ARG_KINDS) / sizeof(VDP_BLIT_ARG_KINDS[0])),
	VDP_BLIT_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_GLYPH_RUN_PACKET_SCHEMA = {
	IO_CMD_VDP_GLYPH_RUN,
	"glyph_run",
	static_cast<uint32_t>(sizeof(VDP_GLYPH_RUN_ARG_KINDS) / sizeof(VDP_GLYPH_RUN_ARG_KINDS[0])),
	VDP_GLYPH_RUN_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_TILE_RUN_PACKET_SCHEMA = {
	IO_CMD_VDP_TILE_RUN,
	"tile_run",
	static_cast<uint32_t>(sizeof(VDP_TILE_RUN_ARG_KINDS) / sizeof(VDP_TILE_RUN_ARG_KINDS[0])),
	VDP_TILE_RUN_ARG_KINDS,
};

inline constexpr VdpPacketSchema VDP_CONFIG_SURFACE_PACKET_SCHEMA = {
	IO_CMD_VDP_CONFIG_SURFACE,
	"config_surface",
	static_cast<uint32_t>(sizeof(VDP_CONFIG_SURFACE_ARG_KINDS) / sizeof(VDP_CONFIG_SURFACE_ARG_KINDS[0])),
	VDP_CONFIG_SURFACE_ARG_KINDS,
};

inline const VdpPacketSchema* findVdpPacketSchema(uint32_t cmd) {
	switch (cmd) {
		case IO_CMD_VDP_CLEAR:
			return &VDP_CLEAR_PACKET_SCHEMA;
		case IO_CMD_VDP_FILL_RECT:
			return &VDP_FILL_RECT_PACKET_SCHEMA;
		case IO_CMD_VDP_DRAW_LINE:
			return &VDP_DRAW_LINE_PACKET_SCHEMA;
		case IO_CMD_VDP_BLIT:
			return &VDP_BLIT_PACKET_SCHEMA;
		case IO_CMD_VDP_GLYPH_RUN:
			return &VDP_GLYPH_RUN_PACKET_SCHEMA;
		case IO_CMD_VDP_TILE_RUN:
			return &VDP_TILE_RUN_PACKET_SCHEMA;
		case IO_CMD_VDP_CONFIG_SURFACE:
			return &VDP_CONFIG_SURFACE_PACKET_SCHEMA;
		default:
			return nullptr;
	}
}

inline const VdpPacketSchema& getVdpPacketSchema(uint32_t cmd) {
	const VdpPacketSchema* schema = findVdpPacketSchema(cmd);
	if (!schema) {
		throw std::runtime_error("[VDP] Unknown packet command.");
	}
	return *schema;
}

inline VdpPacketWordKind getVdpPacketArgKind(uint32_t cmd, uint32_t index) {
	const VdpPacketSchema& schema = getVdpPacketSchema(cmd);
	if (index >= schema.argWords) {
		throw std::runtime_error(std::string("[VDP] ") + schema.name + " arg index out of range.");
	}
	return schema.argKinds[index];
}

inline void assertVdpPacketArgWords(uint32_t cmd, uint32_t argWords) {
	const VdpPacketSchema& schema = getVdpPacketSchema(cmd);
	if (argWords != schema.argWords) {
		throw std::runtime_error(std::string("[VDP] ") + schema.name + " expects " + std::to_string(schema.argWords) + " arg words, got " + std::to_string(argWords) + ".");
	}
}

} // namespace bmsx
