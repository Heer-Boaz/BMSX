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
		case OpCode::CALL: case OpCode::SVC:
			return 0;
		case OpCode::JREG:
			return static_cast<u16>(row.c == static_cast<int>(RegisterJumpMode::Link) ? std::max<int>(row.a, row.b) + 1 : row.a + 1);
		case OpCode::ITERN:
			return static_cast<u16>(std::max(row.a + 3, row.b + row.c));
		case OpCode::STORE_MEM: case OpCode::STORE_MEM_D:
			if (row.c == static_cast<u8>(MemoryAccessKind::Value))
				return static_cast<u16>(std::max(row.a + 1, row.b + 1));
			[[fallthrough]];
		case OpCode::STORE_MEM_WORDS: case OpCode::STORE_MEM_WORDS_D:
			// Source values belong to the admitted bus operation, after readiness.
			return static_cast<u16>(std::max(0, row.b + 1));
		case OpCode::MOV:
			if (row.c > static_cast<i16>(ValueMoveKind::Tag) && row.c != static_cast<i16>(ValueMoveKind::Payload)) return 0;
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
		decoded.a = static_cast<uint16_t>((wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow);
		const u8 rkOperands = OPCODE_RK_OPERANDS[op];
		const bool signedBase = op == static_cast<u8>(OpCode::MOV) && rawC == static_cast<u32>(ValueMoveKind::AddBase);
		decoded.b = static_cast<int16_t>(((rkOperands & RK_OPERAND_B) != 0u || signedBase)
			? signExtend(rawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS))
			: static_cast<int32_t>(rawB));
		decoded.c = static_cast<int16_t>((rkOperands & RK_OPERAND_C) != 0u
			? signExtend(rawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS))
			: static_cast<int32_t>(rawC));
		const size_t constantCount = image.constPool.size();
		bool invalidImageOperand = ((rkOperands & RK_OPERAND_B) != 0u
				&& decoded.b < 0 && (static_cast<size_t>(-1 - decoded.b) >= constantCount
					|| image.constPool.tag(-1 - decoded.b) == ValueTag::UnboundStringLiteral))
			|| ((rkOperands & RK_OPERAND_C) != 0u
				&& decoded.c < 0 && (static_cast<size_t>(-1 - decoded.c) >= constantCount
					|| image.constPool.tag(-1 - decoded.c) == ValueTag::UnboundStringLiteral));
		switch (static_cast<OpCode>(op)) {
			case OpCode::ITERN:
				invalidImageOperand = rawC == 0u;
				break;
			case OpCode::GETSYS: case OpCode::SETSYS:
				invalidImageOperand = resetBankSelected() || decodedBx >= image.systemNameCount;
				break;
			case OpCode::GETGL: case OpCode::SETGL:
				invalidImageOperand = resetBankSelected() || decodedBx >= image.globalNameCount;
				break;
			case OpCode::LOADK:
				invalidImageOperand = decodedBx >= constantCount || image.constPool.tag(decodedBx) == ValueTag::UnboundStringLiteral;
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
			case OpCode::JAL:
				decoded.setBx(instructionBranchTarget(pc, width, decodedBx));
				break;
			default:
				decoded.setBx(usesDisp ? ext : decodedBx);
				break;
		}
		if ((op == static_cast<u8>(OpCode::JREG) && rawC > static_cast<u32>(RegisterJumpMode::Link))
			|| (rawC > static_cast<u32>(MemoryAccessKind::Value)
				&& ((static_cast<OpCode>(op) == OpCode::LOAD_MEM && rawC != static_cast<u32>(MemoryAccessKind::ContextWord))
					|| static_cast<OpCode>(op) == OpCode::STORE_MEM
					|| static_cast<OpCode>(op) == OpCode::LOAD_MEM_D
					|| static_cast<OpCode>(op) == OpCode::STORE_MEM_D))) {
			decoded.op = static_cast<u8>(DecodedDispatchOp::ReservedInstruction);
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
		const u32 binding = executionImageBindingOffset(image.executionDomainId);
		const u32 base = m_memory.readRamRecordWord(binding + (system ? EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET : EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET));
		decoded.setBx(m_memory.readRamRecordWord(base + 4u * index));
	}
	decoded.dispatchOp = decoded.op;
	page.refreshState[pageOffset] = instructionCacheable ? 0u : DECODED_REFRESH_DECODE;
	if (instructionCacheable && page.mapping.writeWatch.groups) {
		page.mapping.writeWatch.armWord(pageOffset);
		if (width == 2 && !bodyPage) page.mapping.writeWatch.armWord(pageOffset + 1u);
	}
	if (instructionCacheable && bodyPage && bodyPage->mapping.writeWatch.groups) {
		bodyPage->mapping.writeWatch.armWord(0u);
	}
	const auto& observed = m_instructionObserver.points[static_cast<size_t>(image.executionDomainId + 1)];
	if (observed.contains(pc)) {
		decoded.dispatchOp = static_cast<u8>(DecodedDispatchOp::Observe);
		return;
	}
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (instructionCacheable && nativeBlockSupports(decoded.op) && (decoded.op != static_cast<u8>(OpCode::JMP) || decoded.a == 0)
		&& (decoded.op != static_cast<u8>(OpCode::LOAD_MEM) || decoded.c != static_cast<int>(MemoryAccessKind::ContextWord))) {
		decoded.dispatchOp = nativeWarmDispatch(decoded);
		page.nativeVisits[pageOffset] = 0;
	}
#endif
}

bool CPU::decodeInstruction(
	CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc, bool allowFusion
) {
	if (page.refreshState[pageOffset] == DECODED_REFRESH_FUSION) {
		refreshDecodedFusion(frame, page, pageOffset, pc);
		return true;
	}
	DecodedInstruction& decoded = page.words[pageOffset];
	bool instructionCacheable = page.mapping.cacheable;
	DecodedInstructionPage* bodyPage = nullptr;
	const auto fetchWord = [&](const DecodedInstructionPage& source, u32 address, u32& word) {
		if (const auto* bytes = source.mapping.readBytes) {
			word = readLE32(bytes + (address & MAPPED_PAGE_BYTE_MASK));
			return true;
		}
		const auto sequence = m_memory.readBusFaultSequence();
		word = m_memory.readMappedBusU32LE(address, m_executionBusSignals | MAPPED_BUS_INSTRUCTION_FETCH);
		if (m_memory.readBusFaultSequence() == sequence) return true;
		enterInstructionFetchException(frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
		return false;
	};
	u32 sourceWord;
	if (!fetchWord(page, pc, sourceWord)) return false;
	u32 bodyWord = sourceWord;
	if (instructionOpcode(sourceWord) == static_cast<u8>(OpCode::WIDE)) {
		const u32 bodyPc = pc + INSTRUCTION_BYTES;
		if (pageOffset == DECODED_PAGE_WORDS - 1u) {
			bodyPage = &decodedPageForFrame(frame, bodyPc);
			instructionCacheable &= bodyPage->mapping.cacheable;
		}
		if (!fetchWord(bodyPage ? *bodyPage : page, bodyPc, bodyWord)) return false;
	}
	decodeInstructionWords(*frame.executionImage, page, pageOffset, pc,
		sourceWord, bodyWord, instructionCacheable, bodyPage);
	if (instructionCacheable && decoded.dispatchOp == decoded.op && decodedDispatchCanFuse(decoded.op)) {
		page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
		if (allowFusion) refreshDecodedFusion(frame, page, pageOffset, pc);
	}
	return true;
}

// Fusion is dispatch metadata, not an instruction fetch. Use a cached
// successor or inspect a fully backed encoding without touching the bus.
void CPU::refreshDecodedFusion(CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc) {
	auto& head = page.words[pageOffset];
	page.refreshState[pageOffset] = 0;
	if (head.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)) return;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (isNativeWarmDispatch(head.dispatchOp)
		|| head.dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock)) return;
#endif
	head.dispatchOp = head.op;
	auto& image = *frame.executionImage;
	const u32 nextPc = pc + head.width * INSTRUCTION_BYTES;
	if (m_instructionObserver.points[static_cast<size_t>(image.executionDomainId + 1)].contains(nextPc)) return;
	const u32 nextOffset = (nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto& nextPage = nextOffset > pageOffset ? page : decodedPageForFrame(frame, nextPc);
	if (!nextPage.mapping.cacheable) return;
	if (nextPage.refreshState[nextOffset] & DECODED_REFRESH_DECODE) {
		const auto& binding = nextPage.mapping;
		if (!binding.readBytes) return;
		const auto* bytes = binding.readBytes + nextOffset * INSTRUCTION_BYTES;
		const u32 source = readLE32(bytes);
		u32 body = source;
		if (instructionOpcode(source) == static_cast<u8>(OpCode::WIDE)) {
			if (nextOffset + 1u == DECODED_PAGE_WORDS) {
				page.refreshState[pageOffset] = DECODED_REFRESH_FUSION;
				return;
			}
			body = readLE32(bytes + INSTRUCTION_BYTES);
		}
		decodeInstructionWords(image, nextPage, nextOffset, nextPc, source, body, true, nullptr);
		const auto& next = nextPage.words[nextOffset];
		if (next.dispatchOp == next.op && decodedDispatchCanFuse(next.op))
			nextPage.refreshState[nextOffset] = DECODED_REFRESH_FUSION;
	}
	head.dispatchOp = decodedDispatchOp(head.op, nextPage.words[nextOffset].op);
}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
bool CPU::decodeBackedInstruction(
	Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset,
	u32 pc, MappedBusSignals busSignals, NativeWarmupPages* requested
) {
	const auto& binding = page.mapping;
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
