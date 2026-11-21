#include "machine/cpu/execution_image.h"

#include "common/endian.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

Blua32RomFunctionDirectory Blua32RomFunctionDirectory::read(const Memory& memory,
	ExecutionDomainId domain, const u8* header) {
	const u32 count = readLE32(header + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	if (count == 0u) return {};

	const u32 table = readLE32(header + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET);
	const u32 text = readLE32(header + BLUA32_IMAGE_TEXT_ADDRESS_OFFSET);
	const u32 textBytes = readLE32(header + BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET);
	const bool system = domain == SYSTEM_EXECUTION_DOMAIN_ID;
	const u32 slot = system ? 0u : static_cast<u32>(domain);
	const u32 romBase = system ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const u32 romSize = system ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;

	Span<const u8> code;
	if (((text | textBytes) & (INSTRUCTION_BYTES - 1u)) != 0u || textBytes == 0u
		|| !ownsAddress(domain, text) || textBytes > romSize - (text - romBase)
		|| !memory.bindRomByteView(text, textBytes, slot, code))
		throw BMSX_RUNTIME_ERROR("BLua32 published TEXT is not backed by the image's ROM.");

	Span<const u8> records;
	if ((table & (BLUA32_FUNCTION_ALIGNMENT - 1u)) != 0u || !ownsAddress(domain, table)
		|| count > (romSize - (table - romBase)) / BLUA32_FUNCTION_RECORD_SIZE
		|| !memory.bindRomByteView(table, count * BLUA32_FUNCTION_RECORD_SIZE, slot, records))
		throw BMSX_RUNTIME_ERROR("BLua32 function directory is not backed by the image's ROM.");

	Blua32RomFunctionDirectory result;
	result.tableAddress = table;
	result.versions.reserve(count);
	const u8* record = records.data();
	for (u32 index = 0; index < count; ++index, record += BLUA32_FUNCTION_RECORD_SIZE) {
		const u32 start = readLE32(record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		const u32 size = readLE32(record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
		const u32 offset = start - text;
		if (start < text || offset >= textBytes || size == 0u || size > textBytes - offset
			|| ((start | size) & (INSTRUCTION_BYTES - 1u)) != 0u)
			throw BMSX_RUNTIME_ERROR("BLua32 published function has an invalid TEXT extent.");
		result.versions.push_back({start, start + size});
	}
	return result;
}

const Blua32RomFunctionVersion* Blua32RomFunctionDirectory::find(u32 record) const {
	const u32 offset = record - tableAddress;
	if (record < tableAddress || offset % BLUA32_FUNCTION_RECORD_SIZE != 0u
		|| offset / BLUA32_FUNCTION_RECORD_SIZE >= versions.size()) return nullptr;
	return &versions[offset / BLUA32_FUNCTION_RECORD_SIZE];
}

} // namespace bmsx
