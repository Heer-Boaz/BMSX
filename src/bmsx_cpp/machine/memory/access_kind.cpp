#include "machine/memory/access_kind.h"

#include <stdexcept>

namespace bmsx {

const char* memoryAccessKindName(MemoryAccessKind kind) {
	return MEMORY_ACCESS_KIND_NAMES[static_cast<size_t>(kind)].data();
}

MemoryAccessKind memoryAccessKindForName(std::string_view name) {
	if (name == "mem") return MemoryAccessKind::Word;
	if (name == "mem8") return MemoryAccessKind::U8;
	if (name == "mem16le") return MemoryAccessKind::U16LE;
	if (name == "mem32le") return MemoryAccessKind::U32LE;
	if (name == "memf32le") return MemoryAccessKind::F32LE;
	if (name == "memf64le") return MemoryAccessKind::F64LE;
	throw std::runtime_error("[MemoryAccessKind] Unknown memory access kind name.");
}

bool isMemoryAccessKindName(std::string_view name) {
	return name == "mem"
		|| name == "mem8"
		|| name == "mem16le"
		|| name == "mem32le"
		|| name == "memf32le"
		|| name == "memf64le";
}

} // namespace bmsx
