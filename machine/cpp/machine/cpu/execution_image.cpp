#include "machine/cpu/execution_image.h"

#include "common/endian.h"
#include "machine/memory/memory.h"
#include "spec/blua32/image_format.h"
#include "spec/blua32/instruction_format.h"
#include "spec/blua32/opcode.h"

#include <algorithm>
#include <numeric>

namespace bmsx {

Blua32RomFunctionDirectory Blua32RomFunctionDirectory::read(const Memory& memory,
	ExecutionDomainId domain, const u8* header) {
	Blua32RomFunctionDirectory result;
	result.mappedCode = (readLE32(header + BLUA32_IMAGE_FLAGS_OFFSET) & BLUA32_IMAGE_MAPPED_CODE_FLAG) != 0u;
	const u32 count = readLE32(header + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	if (count == 0u) {
		if (!result.mappedCode) throw BMSX_RUNTIME_ERROR("A BLua32 function image has no function directory.");
		return result;
	}

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

	result.tableAddress = table;
	result.textAddress = text;
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
	if (result.mappedCode) return result;

	// Validate each distinct body once. The record index keeps its original
	// identity; the sorted index is for span ownership, not prototype lookup.
	auto& order = result.codeOrder;
	order.resize(count);
	std::iota(order.begin(), order.end(), 0u);
	const auto& versions = result.versions;
	std::ranges::sort(order, [&](u32 a, u32 b) {
		const auto& x = versions[a];
		const auto& y = versions[b];
		return x.firstPc == y.firstPc ? x.endPc < y.endPc : x.firstPc < y.firstPc;
	});
	order.erase(std::ranges::unique(order, [&](u32 a, u32 b) {
		return versions[a].firstPc == versions[b].firstPc && versions[a].endPc == versions[b].endPc;
	}).begin(), order.end());
	result.instructionHeads.resize((textBytes / INSTRUCTION_BYTES + 31u) / 32u);
	u32 previousEnd = text;
	for (u32 index : order) {
		const auto& version = versions[index];
		if (version.firstPc < previousEnd)
			throw BMSX_RUNTIME_ERROR("BLua32 function TEXT extents overlap.");
		previousEnd = version.endPc;
		auto read = [&](u32 pc) { return readLE32(code.data() + (pc - text)); };
		for (u32 pc = version.firstPc; pc < version.endPc;) {
			const u32 word = (pc - text) / INSTRUCTION_BYTES;
			result.instructionHeads[word >> 5u] |= u32{1} << (word & 31u);
			const bool wide = instructionOpcode(read(pc)) == static_cast<u8>(OpCode::WIDE);
			pc += INSTRUCTION_BYTES;
			if (wide) {
				if (pc == version.endPc || instructionOpcode(read(pc)) == static_cast<u8>(OpCode::WIDE))
					throw BMSX_RUNTIME_ERROR("BLua32 function has an incomplete WIDE instruction.");
				pc += INSTRUCTION_BYTES;
			}
		}
		for (u32 pc = version.firstPc; pc < version.endPc;) {
			const u32 source = read(pc);
			const bool wide = instructionOpcode(source) == static_cast<u8>(OpCode::WIDE);
			const int width = wide ? 2 : 1;
			const u32 body = wide ? read(pc + INSTRUCTION_BYTES) : source;
			const auto op = static_cast<OpCode>(instructionOpcode(body));
			const u32 next = pc + width * INSTRUCTION_BYTES;
			if (op == OpCode::JMP || op == OpCode::JMPIF || op == OpCode::JMPIFNOT) {
				const u32 target = instructionBranchTarget(pc, width, instructionBx(body, wide ? instructionLowB(source) : 0u, true));
				if (!version.contains(target) || !result.instructionHead(target))
					throw BMSX_RUNTIME_ERROR("BLua32 branch target is not an instruction in its function.");
			}
			if (op != OpCode::JMP && op != OpCode::RET && op != OpCode::RFE && op <= OpCode::HALT) {
				if (!version.contains(next))
					throw BMSX_RUNTIME_ERROR("BLua32 function falls through the end of its TEXT extent.");
				if (op == OpCode::EQ || op == OpCode::LT || op == OpCode::LE) {
					const u32 skipped = instructionOpcode(read(next)) == static_cast<u8>(OpCode::WIDE) ? 2 : 1;
					if (!version.contains(next + skipped * INSTRUCTION_BYTES))
						throw BMSX_RUNTIME_ERROR("BLua32 comparison skips past the end of its function.");
				}
			}
			pc = next;
		}
	}
	return result;
}

const Blua32RomFunctionVersion* Blua32RomFunctionDirectory::find(u32 record) const {
	const u32 offset = record - tableAddress;
	if (record < tableAddress || offset % BLUA32_FUNCTION_RECORD_SIZE != 0u
		|| offset / BLUA32_FUNCTION_RECORD_SIZE >= versions.size()) return nullptr;
	return &versions[offset / BLUA32_FUNCTION_RECORD_SIZE];
}

const Blua32RomFunctionVersion* Blua32RomFunctionDirectory::atPc(u32 pc) const {
	const auto it = std::ranges::upper_bound(codeOrder, pc, {}, [&](u32 index) { return versions[index].firstPc; });
	if (it == codeOrder.begin()) return nullptr;
	const auto& version = versions[*(it - 1)];
	return version.contains(pc) ? &version : nullptr;
}

bool Blua32RomFunctionDirectory::instructionHead(u32 pc) const {
	const u32 offset = pc - textAddress;
	if ((offset & (INSTRUCTION_BYTES - 1u)) != 0u) return false;
	const u32 word = offset / INSTRUCTION_BYTES;
	return (word >> 5u) < instructionHeads.size() && (instructionHeads[word >> 5u] & (u32{1} << (word & 31u))) != 0u;
}

bool Blua32ExecutionImage::admitsFunctionPc(u32 record, u32 pc) const {
	if (romFunctions.mappedCode) return true;
	if (const auto* version = romFunctions.find(record))
		return version->contains(pc) && romFunctions.instructionHead(pc);
	// A mapped prototype can address mapped code. It cannot claim addresses
	// in the installed image for which it has no published function body.
	return pc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE && pc - CART_ROM_BASE >= CART_ROM_SIZE;
}

} // namespace bmsx
