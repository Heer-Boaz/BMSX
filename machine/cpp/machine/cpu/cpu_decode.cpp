#include "machine/cpu/cpu.h"

#include "common/endian.h"
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

// Source words and their execution image are the decode inputs. This producer
// changes only decoded-cache state; instruction-bus faults belong to the fetch
// path below, not to a speculative native compilation request.
bool CPU::decodeInstructionWords(
	Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset, u32 pc,
	u32 sourceWord, u32 bodyWord, bool instructionCacheable,
	DecodedInstructionPage* bodyPage, bool compilation
) {
	DecodedInstruction& destination = page.words[pageOffset];
	const bool wide = ((sourceWord >> 18) & 0x3fu) == static_cast<u32>(OpCode::WIDE);
	const int width = wide ? 2 : 1;
	const u8 wideA = wide ? static_cast<u8>((sourceWord >> 12) & 0x3fu) : 0;
	const u8 wideB = wide ? static_cast<u8>((sourceWord >> 6) & 0x3fu) : 0;
	const u8 wideC = wide ? static_cast<u8>(sourceWord & 0x3fu) : 0;
	const u8 op = static_cast<u8>((bodyWord >> 18) & 0x3fu);
	const u8 ext = static_cast<u8>(bodyWord >> 24);
	const bool unchanged = destination.width != 0u
		&& page.sourceWords[pageOffset] == sourceWord
		&& page.bodyWords[pageOffset] == bodyWord
		&& destination.width == static_cast<uint8_t>(width);
	if (!unchanged) {
		DecodedInstruction decoded{};
		const uint8_t aLow = static_cast<uint8_t>((bodyWord >> 12) & 0x3f);
		const uint8_t bLow = static_cast<uint8_t>((bodyWord >> 6) & 0x3f);
		const uint8_t cLow = static_cast<uint8_t>(bodyWord & 0x3f);
		const bool usesDisp = OPCODE_USES_DISP[op] != 0u;
		const bool usesBx = !usesDisp && OPCODE_USES_BX[op] != 0u;
		const uint8_t extA = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>((ext >> 6) & 0x3);
		const uint8_t extB = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>((ext >> 3) & 0x7);
		const uint8_t extC = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>(ext & 0x7);
		const int aShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const int bShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + EXT_B_BITS;
		const int cShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + EXT_C_BITS;
		const uint32_t bxLow =
			(static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | cLow;
		const uint32_t rawB = (static_cast<uint32_t>(wideB) << bShift)
			| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
			| bLow;
		const uint32_t rawC = (static_cast<uint32_t>(wideC) << cShift)
			| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
			| cLow;
		const uint32_t decodedBx =
			(static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
			| bxLow;
		const int32_t decodedSbx = signExtend(
			decodedBx,
			MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS)
		);
		decoded.op = op;
		decoded.width = static_cast<uint8_t>(width);
		decoded.a = static_cast<uint16_t>(
			(wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow
		);
		const u8 rkOperands = OPCODE_RK_OPERANDS[op];
		decoded.b = static_cast<int16_t>((rkOperands & RK_OPERAND_B) != 0u
			? signExtend(rawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS))
			: static_cast<int32_t>(rawB));
		decoded.c = static_cast<int16_t>((rkOperands & RK_OPERAND_C) != 0u
			? signExtend(rawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS))
			: static_cast<int32_t>(rawC));
		switch (static_cast<OpCode>(op)) {
			case OpCode::KSMI:
				decoded.sbx = decodedSbx;
				break;
			case OpCode::GETFIELD:
			case OpCode::SETFIELD:
			case OpCode::SELF:
			case OpCode::GETT:
			case OpCode::SETT:
				decoded.tableCacheSlot = -1;
				break;
			case OpCode::GETGL:
			case OpCode::SETGL:
				if (compilation && decodedBx >= image.globalSlots.size()) return false;
				decoded.bx = image.globalSlots[decodedBx];
				break;
			case OpCode::GETSYS:
			case OpCode::SETSYS:
				if (compilation && decodedBx >= image.systemGlobalSlots.size()) return false;
				decoded.bx = image.systemGlobalSlots[decodedBx];
				break;
			case OpCode::JMP:
			case OpCode::JMPIF:
			case OpCode::JMPIFNOT:
				decoded.bx = pc
					+ static_cast<u32>(width * INSTRUCTION_BYTES)
					+ static_cast<u32>(decodedSbx * INSTRUCTION_BYTES);
				break;
			default:
				decoded.bx = decodedBx;
				break;
		}
		decoded.disp = ext;
		if (rawC > static_cast<u32>(MemoryAccessKind::F64LE)
			&& (static_cast<OpCode>(op) == OpCode::LOAD_MEM
				|| static_cast<OpCode>(op) == OpCode::STORE_MEM
				|| static_cast<OpCode>(op) == OpCode::LOAD_MEM_D
				|| static_cast<OpCode>(op) == OpCode::STORE_MEM_D)) {
			decoded.op = static_cast<u8>(DecodedDispatchOp::ReservedMemory);
		}
		destination = decoded;
		page.sourceWords[pageOffset] = sourceWord;
		page.bodyWords[pageOffset] = bodyWord;
	}
	DecodedInstruction& decoded = destination;
	decoded.dispatchOp = decoded.op;
	decoded.baseCycles = DECODED_DISPATCH_BASE_CYCLES[decoded.op];
	decoded.dispatchCycles = decoded.baseCycles;
	page.refreshState[pageOffset] = instructionCacheable ? 0u : DECODED_REFRESH_DECODE;
	if (instructionCacheable && page.writeWatch.groups) {
		page.writeWatch.armWord(pageOffset);
		if (width == 2 && !bodyPage) page.writeWatch.armWord(pageOffset + 1u);
	}
	if (instructionCacheable && bodyPage && bodyPage->writeWatch.groups) {
		bodyPage->writeWatch.armWord(0u);
	}
	const auto& observed = m_instructionObserver.points[static_cast<size_t>(image.executionDomainId + 1)];
	if (observed.contains(pc)) {
		decoded.dispatchOp = static_cast<u8>(DecodedDispatchOp::Observe);
		decoded.dispatchCycles = DECODED_DISPATCH_BASE_CYCLES[decoded.dispatchOp];
		return true;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (instructionCacheable && nativeBlockSupports(decoded.op)) {
		decoded.dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeWarm);
		page.nativeVisits[pageOffset] = 0;
		return true;
	}
#endif
	return true;
}

bool CPU::decodeInstruction(
	CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc, bool allowFusion
) {
	DecodedInstruction& decoded = page.words[pageOffset];
	bool instructionCacheable = page.cacheable;
	DecodedInstructionPage* bodyPage = nullptr;
	int width = 1;
	uint8_t op;
	const u32 faultSequence = m_memory.readBusFaultSequence();
	const uint32_t sourceWord = m_memory.readMappedBusU32LE(pc, m_executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
		return false;
	}
	uint32_t bodyWord = sourceWord;
	op = static_cast<uint8_t>((sourceWord >> 18) & 0x3f);
	if (static_cast<OpCode>(op) == OpCode::WIDE) {
		width = 2;
		if (pageOffset == DECODED_PAGE_WORDS - 1u) {
			bodyPage = &decodedPageForFrame(
				frame,
				pc + INSTRUCTION_BYTES
			);
			instructionCacheable = instructionCacheable && bodyPage->cacheable;
		}
		bodyWord = m_memory.readMappedBusU32LE(
			pc + INSTRUCTION_BYTES,
			m_executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH
		);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
			return false;
		}
		op = static_cast<uint8_t>((bodyWord >> 18) & 0x3f);
	}
	decodeInstructionWords(*frame.executionImage, page, pageOffset, pc,
		sourceWord, bodyWord, instructionCacheable, bodyPage, false);
	if (decoded.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)) return true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (decoded.dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm)) return true;
#endif
	const auto& observed = m_instructionObserver.points[static_cast<size_t>(frame.executionImage->executionDomainId + 1)];
	const bool fusionCandidate = decodedDispatchCanFuse(op);
	if (!allowFusion) {
		if (fusionCandidate && instructionCacheable) {
			page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
		}
		return true;
	}
	if (!fusionCandidate || !instructionCacheable) {
		return true;
	}
	const u32 nextPc = pc + static_cast<u32>(width) * INSTRUCTION_BYTES;
	if (observed.contains(nextPc)) return true;
	DecodedInstructionPage& nextPage = decodedPageForFrame(frame, nextPc);
	if (!nextPage.cacheable) {
		return true;
	}
	const u32 nextOffset = (nextPc & MAPPED_PAGE_BYTE_MASK) >> 2;
	const u8 nextRefreshState = nextPage.refreshState[nextOffset];
	if ((nextRefreshState & DECODED_REFRESH_DECODE) != 0u) {
		if (nextOffset == DECODED_PAGE_WORDS - 1u) {
			page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
			return true;
		}
		// Lookahead may inspect only fully backed memory, never a faulting bus access.
		// The last-word exclusion above keeps a WIDE body in that same backing page.
		MappedPageBinding binding;
		m_memory.bindMappedPage(
			nextPc & ~MAPPED_PAGE_BYTE_MASK,
			m_executionBusSignals,
			binding
		);
		if (!binding.readBytes) {
			return true;
		}
		if (!decodeInstruction(frame, nextPage, nextOffset, nextPc, false)) {
			return false;
		}
		if ((nextPage.refreshState[nextOffset] & DECODED_REFRESH_DECODE) != 0u) {
			return true;
		}
	}
	const DecodedInstruction& successor = nextPage.words[nextOffset];
	decoded.dispatchOp = decodedDispatchOp(op, successor.op);
	decoded.dispatchCycles = DECODED_DISPATCH_BASE_CYCLES[decoded.dispatchOp];
	return true;
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
bool CPU::decodeBackedInstruction(
	Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset,
	u32 pc, MappedBusSignals busSignals
) {
	MappedPageBinding binding;
	m_memory.bindMappedPage(pc & ~MAPPED_PAGE_BYTE_MASK, busSignals, binding);
	if (!binding.cacheable || !binding.readBytes) return false;
	const u32 sourceWord = readLE32(binding.readBytes + pageOffset * INSTRUCTION_BYTES);
	u32 bodyWord = sourceWord;
	DecodedInstructionPage* bodyPage = nullptr;
	if (((sourceWord >> 18) & 0x3fu) == static_cast<u32>(OpCode::WIDE)) {
		if (pageOffset == DECODED_PAGE_WORDS - 1u) {
			MappedPageBinding bodyBinding;
			m_memory.bindMappedPage(pc + INSTRUCTION_BYTES, busSignals, bodyBinding);
			if (!bodyBinding.cacheable || !bodyBinding.readBytes) return false;
			bodyPage = &decodedPageForAddress(image, bodyBinding);
			bodyWord = readLE32(bodyBinding.readBytes);
		} else bodyWord = readLE32(binding.readBytes + (pageOffset + 1u) * INSTRUCTION_BYTES);
	}
	return decodeInstructionWords(image, page, pageOffset, pc,
		sourceWord, bodyWord, true, bodyPage, true);
}
#endif

} // namespace bmsx
