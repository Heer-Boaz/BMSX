#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"

#include "common/endian.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/jit/source.h"
#include "machine/cpu/jit/source_policy.h"
#endif
#include "machine/memory/memory.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {
namespace {

u16 fixedRegisterExtent(const DecodedInstruction& row) {
	const auto op = static_cast<OpCode>(row.op);
	switch (op) {
		// These owners admit operands after a mode check or as part of a
		// dynamic placement, and are also reached from native exits.
		case OpCode::MFC0: case OpCode::MTC0:
		case OpCode::CLOSURE: case OpCode::CALL:
			return 0;
		case OpCode::ITERN:
			return static_cast<u16>(std::max(row.a + 3, row.b + row.c));
		case OpCode::STORE_MEM: case OpCode::STORE_MEM_D:
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
			// Source values belong to the admitted bus operation, after readiness.
			return static_cast<u16>(std::max(0, row.b + 1));
		case OpCode::MOV:
			if (row.c > static_cast<i16>(ValueMoveKind::FloatFromBits)) return 0;
			break;
		default: break;
	}
	const u8 reads = OPCODE_SCALAR_REGISTER_READS[row.op];
	int extent = ((reads & REGISTER_OPERAND_A) || OPCODE_WRITES_REGISTER_A[row.op]) ? row.a + 1 : 0;
	if (reads & REGISTER_OPERAND_B) extent = std::max(extent, row.b + 1);
	if (reads & REGISTER_OPERAND_C) extent = std::max(extent, row.c + 1);
	switch (op) {
		case OpCode::LOADNIL:
			if (row.b != 0) extent = row.a + row.b;
			break;
		case OpCode::SELF:
			extent = std::max(extent, row.a + 2);
			break;
		case OpCode::CONCATN:
			if (row.c != 0) extent = std::max(extent, row.b + row.c);
			break;
		default: break;
	}
	static_assert(2 * MAX_EXT_REGISTER_BC <= UINT16_MAX);
	return static_cast<u16>(extent);
}

} // namespace

// Source words and their execution image are the decode inputs. This producer
// changes only decoded-cache state; instruction-bus faults belong to the fetch
// path below, not to a speculative native compilation request.
void CPU::decodeInstructionWords(
	Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset, u32 pc,
	u32 sourceWord, u32 bodyWord, bool instructionCacheable,
	DecodedInstructionPage* bodyPage
) {
	DecodedInstruction& destination = page.words[pageOffset];
	const bool wide = instructionOpcode(sourceWord) == static_cast<u8>(OpCode::WIDE);
	const int width = wide ? 2 : 1;
	const u8 wideA = wide ? static_cast<u8>((sourceWord >> 12) & 0x3fu) : 0;
	const u8 wideB = wide ? instructionLowB(sourceWord) : 0;
	const u8 wideC = wide ? static_cast<u8>(sourceWord & 0x3fu) : 0;
	const u8 op = instructionOpcode(bodyWord);
	const u8 ext = static_cast<u8>(bodyWord >> 24);
	const bool unchanged = destination.width != 0u
		&& page.sourceWords[pageOffset] == sourceWord
		&& page.bodyWords[pageOffset] == bodyWord
		&& destination.width == static_cast<uint8_t>(width);
	if (!unchanged) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (destination.op == static_cast<u8>(OpCode::GETFIELD)) page.fieldProofFeedback.forget(pageOffset);
#endif
		DecodedInstruction decoded{};
		const uint8_t aLow = static_cast<uint8_t>((bodyWord >> 12) & 0x3f);
		const uint8_t bLow = instructionLowB(bodyWord);
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
		const uint32_t rawB = (static_cast<uint32_t>(wideB) << bShift)
			| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
			| bLow;
		const uint32_t rawC = (static_cast<uint32_t>(wideC) << cShift)
			| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
			| cLow;
		const uint32_t decodedBx = instructionBx(bodyWord, wideB, usesBx);
		decoded.op = op;
		decoded.width = static_cast<uint8_t>(width);
		decoded.baseCycles = BASE_CYCLES[op];
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
		const size_t constantCount = image.constPool.size();
		bool invalidImageOperand = ((rkOperands & RK_OPERAND_B) != 0u
				&& decoded.b < 0 && static_cast<size_t>(-1 - decoded.b) >= constantCount)
			|| ((rkOperands & RK_OPERAND_C) != 0u
				&& decoded.c < 0 && static_cast<size_t>(-1 - decoded.c) >= constantCount);
		switch (static_cast<OpCode>(op)) {
			case OpCode::ITERN:
				invalidImageOperand = rawC == 0u;
				break;
			case OpCode::GETSYS: case OpCode::SETSYS:
				invalidImageOperand = decodedBx >= image.systemNameCount;
				break;
			case OpCode::GETGL: case OpCode::SETGL:
				invalidImageOperand = decodedBx >= image.globalNameCount;
				break;
			case OpCode::LOADK:
				invalidImageOperand = decodedBx >= constantCount;
				decoded.setBx(decodedBx);
				break;
			case OpCode::ADD:
			case OpCode::SUB:
			case OpCode::MUL:
			case OpCode::CALL:
				break;
			case OpCode::KSMI:
				decoded.setSbx(instructionSignedBx(decodedBx, width));
				break;
			case OpCode::GETFIELD:
			case OpCode::SELF:
				invalidImageOperand |= rawC >= constantCount || image.constPool.tag(rawC) != ValueTag::String;
				decoded.tableCacheSlot() = -1;
				break;
			case OpCode::SETFIELD:
				invalidImageOperand |= rawB >= constantCount || image.constPool.tag(rawB) != ValueTag::String;
				decoded.tableCacheSlot() = -1;
				break;
			case OpCode::GETT:
			case OpCode::SETT:
				decoded.tableCacheSlot() = -1;
				break;
			case OpCode::JMP:
			case OpCode::JMPIF:
			case OpCode::JMPIFNOT:
				decoded.setBx(instructionBranchTarget(pc, width, decodedBx));
				break;
			default:
				decoded.setBx(usesDisp ? ext : decodedBx);
				break;
		}
		if (rawC > static_cast<u32>(MemoryAccessKind::F64LE)
			&& (static_cast<OpCode>(op) == OpCode::LOAD_MEM
				|| static_cast<OpCode>(op) == OpCode::STORE_MEM
				|| static_cast<OpCode>(op) == OpCode::LOAD_MEM_D
				|| static_cast<OpCode>(op) == OpCode::STORE_MEM_D)) {
			decoded.op = static_cast<u8>(DecodedDispatchOp::ReservedMemory);
		} else if (invalidImageOperand) {
			// Fault only on dispatch, retaining the original width and charge.
			decoded.op = static_cast<u8>(DecodedDispatchOp::InvalidImageOperand);
		}
		if (decoded.op == op) decoded.requiredSlots = fixedRegisterExtent(decoded);
		destination = decoded;
		page.sourceWords[pageOffset] = sourceWord;
		page.bodyWords[pageOffset] = bodyWord;
	}
	DecodedInstruction& decoded = destination;
	if (decoded.op >= static_cast<u8>(OpCode::GETSYS) && decoded.op <= static_cast<u8>(OpCode::SETGL)) {
		const bool system = op <= static_cast<u8>(OpCode::SETSYS);
		const u32 index = instructionBx(bodyWord, wideB, true);
		const u32 base = image.globalMapBase + (system ? 4u * image.globalNameCount : 0u);
		decoded.setBx(m_memory.readRamRecordWord(base + 4u * index));
	}
	decoded.dispatchOp = decoded.op;
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
		return;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (instructionCacheable && nativeBlockSupports(decoded.op)
		&& (decoded.op != static_cast<u8>(OpCode::JMP) || decoded.a == 0)) {
		decoded.dispatchOp = static_cast<u8>(DecodedDispatchOp::NativeWarm);
		page.nativeVisits[pageOffset] = 0;
	}
#endif
}

bool CPU::decodeInstruction(
	CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc, bool allowFusion
) {
	DecodedInstruction& decoded = page.words[pageOffset];
	bool instructionCacheable = page.cacheable;
	DecodedInstructionPage* bodyPage = nullptr;
	int width = 1;
	const u32 faultSequence = m_memory.readBusFaultSequence();
	const uint32_t sourceWord = m_memory.readMappedBusU32LE(pc, m_executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
	if (m_memory.readBusFaultSequence() != faultSequence) {
		enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
		return false;
	}
	uint32_t bodyWord = sourceWord;
	if (instructionOpcode(sourceWord) == static_cast<u8>(OpCode::WIDE)) {
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
	}
	decodeInstructionWords(*frame.executionImage, page, pageOffset, pc,
		sourceWord, bodyWord, instructionCacheable, bodyPage);
	if (decoded.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)) return true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (decoded.dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm)) return true;
#endif
	const auto& observed = m_instructionObserver.points[static_cast<size_t>(frame.executionImage->executionDomainId + 1)];
	const bool fusionCandidate = decodedDispatchCanFuse(decoded.op);
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
			m_executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH,
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
	decoded.dispatchOp = decodedDispatchOp(decoded.op, successor.op);
	return true;
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
bool CPU::decodeBackedInstruction(
	Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset,
	u32 pc, MappedBusSignals busSignals, NativeWarmupPages* requested
) {
	MappedPageBinding binding;
	m_memory.bindMappedPage(pc & ~MAPPED_PAGE_BYTE_MASK, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
	if (!binding.cacheable) return false;
	const auto readPublishedWord = [&](u32 address, u32& word) {
		// The verified publication can end in a partially backed physical
		// page. Only a verified head and its body may use the exact ROM view.
		const auto& functions = image.romFunctions;
		const u32 slot = m_memory.cartridgeController().selectedSlot(busSignals);
		if (!functions.instructionHead(pc)
			|| (image.executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID && static_cast<u32>(image.executionDomainId) != slot))
			return false;
		Span<const u8> view;
		if (!m_memory.bindRomByteView(address, INSTRUCTION_BYTES, slot, view)) return false;
		word = readLE32(view.data());
		return true;
	};
	u32 sourceWord;
	if (binding.readBytes) sourceWord = readLE32(binding.readBytes + pageOffset * INSTRUCTION_BYTES);
	else if (!readPublishedWord(pc, sourceWord)) return false;
	u32 bodyWord = sourceWord;
	DecodedInstructionPage* bodyPage = nullptr;
	if (instructionOpcode(sourceWord) == static_cast<u8>(OpCode::WIDE)) {
		if (pageOffset == DECODED_PAGE_WORDS - 1u) {
			const u32 bodyPc = pc + INSTRUCTION_BYTES;
			MappedPageBinding bodyBinding;
			m_memory.bindMappedPage(bodyPc, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, bodyBinding);
			if (!bodyBinding.cacheable) return false;
			if (requested && !requested->include(bodyPc)) return false;
			if (bodyBinding.readBytes) bodyWord = readLE32(bodyBinding.readBytes);
			else if (!readPublishedWord(bodyPc, bodyWord)) return false;
			bodyPage = &image.decodedPages.bind(bodyBinding);
		} else if (binding.readBytes) bodyWord = readLE32(binding.readBytes + (pageOffset + 1u) * INSTRUCTION_BYTES);
		else if (!readPublishedWord(pc + INSTRUCTION_BYTES, bodyWord)) return false;
	}
	decodeInstructionWords(image, page, pageOffset, pc, sourceWord, bodyWord, true, bodyPage);
	return true;
}
#endif

} // namespace bmsx
