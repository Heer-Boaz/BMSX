#include "machine/memory/access_kind.h"

namespace bmsx {

std::optional<MemoryAccessKind> getMemoryAccessKindForName(std::string_view name) {
	if (name == "mem") return MemoryAccessKind::Word;
	if (name == "mem8") return MemoryAccessKind::U8;
	if (name == "mem16le") return MemoryAccessKind::U16LE;
	if (name == "mem32le") return MemoryAccessKind::U32LE;
	if (name == "memf32le") return MemoryAccessKind::F32LE;
	if (name == "memf64le") return MemoryAccessKind::F64LE;
	return std::nullopt;
}

} // namespace bmsx
