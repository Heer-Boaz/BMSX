#pragma once

#include <algorithm>
#include <cstdint>
#include <array>

#include "common/primitives.h"
#include "machine/cpu/closure.h"
#include "machine/cpu/value_slots.h"
#include "machine/memory/memory.h"
#include "spec/blua32/execution_domain.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

struct Blua32ExecutionImage;
struct DecodedInstructionPage;
struct NativeBlockExitSite;
struct Thread;

// A hardware vector has a Function and register window but no Closure.
inline u32 frameCaptureCount(const Memory& memory, u32 closure) {
	return closure == 0u ? 0u : ClosureRecord::captureCount(memory, closure);
}

enum class FrameField : u32 { Function = 0, CallSite = 4, OpenHead = 8, RegisterBase = 12, Flags = 16, Pc = 20, VarargBase = 24, ArgumentCount = 28, ReturnBase = 32, ReturnCount = 36, Top = 40, Closure = 44, StackBase = 48, StackCapacity = 52 };
constexpr u32 FRAME_CONTROL_BYTES = 56;

// The stack datapath uses a RAM-word slot index, not a host signed integer.
constexpr u32 FRAME_WINDOW_MASK = (MAIN_RAM_SIZE / sizeof(u32)) - 1;
constexpr u32 FRAME_COMPLETION = 1u;
constexpr u32 FRAME_EXCEPTION = 2u;
constexpr u32 FRAME_NMI = 4u;
constexpr u32 FRAME_BANK_CART = 1u << 3;
constexpr u32 FRAME_BANK_SECOND = 1u << 4;
constexpr u32 FRAME_BANK_MASK = FRAME_BANK_CART | FRAME_BANK_SECOND;
constexpr u32 FRAME_EXTEND_RESULT_TOP = 1u << 5;
constexpr u32 frameBankWord(ExecutionDomainId domain) {
	return domain == SYSTEM_EXECUTION_DOMAIN_ID ? 0u : FRAME_BANK_CART | (static_cast<u32>(domain) << 4);
}

constexpr ExecutionDomainId frameExecutionBank(u32 flags) {
	return (flags & FRAME_BANK_CART) != 0u ? static_cast<ExecutionDomainId>((flags & FRAME_BANK_SECOND) >> 4u) : SYSTEM_EXECUTION_DOMAIN_ID;
}

// The low word still carries CALL's open/fixed result count. An implicit
// invocation writes its receiving slot without truncating the caller's top.
struct CallResultPlacement {
	i32 base;
	u32 word;
	static constexpr u32 extendTopBit = 1u << 31;

	static constexpr CallResultPlacement call(i32 base, i32 requested) {
		return {base, requested < 0 ? 0u : static_cast<u32>(encodeFixedValueCount(requested))};
	}
	static constexpr CallResultPlacement single(i32 base) {
		return {base, static_cast<u32>(encodeFixedValueCount(1)) | extendTopBit};
	}
	static constexpr CallResultPlacement discard() {
		return {0, static_cast<u32>(encodeFixedValueCount(0)) | extendTopBit};
	}
	static constexpr CallResultPlacement frame(i32 base, i32 count, u32 flags) {
		return {base, static_cast<u32>(count) | ((flags & FRAME_EXTEND_RESULT_TOP) != 0u ? extendTopBit : 0u)};
	}
	constexpr u32 countWord() const { return word & ~extendTopBit; }
	constexpr int selected(int available) const { return decodeValueCount(countWord(), available); }
	constexpr bool extendsTop() const { return (word & extendTopBit) != 0u; }
	constexpr i32 topAfter(i32 before, int count) const {
		return extendsTop() ? std::max(before, base + count) : base + count;
	}
};

// Explicit tagged completion at a semantic call or instruction boundary.

// Architectural words for a new activation. The same record is published
// through the RAM port or into a backing already admitted by a native grant.
struct FrameEntryControl {
	u32 function, pc, callSite, flags;
	i32 varargBase, argumentCount;
	CallResultPlacement result;
	i32 top;
	u32 closure;
	i32 stackBase, capacity;
	i32 registerBase = 0;

	template<typename Write> void writeWords(Write&& write) const {
		write(FrameField::Function, function);
		write(FrameField::CallSite, callSite);
		write(FrameField::OpenHead, 0u);
		write(FrameField::RegisterBase, static_cast<u32>(registerBase));
		write(FrameField::Flags, flags | (result.extendsTop() ? FRAME_EXTEND_RESULT_TOP : 0u));
		write(FrameField::Pc, pc);
		write(FrameField::VarargBase, static_cast<u32>(varargBase));
		write(FrameField::ArgumentCount, static_cast<u32>(argumentCount));
		write(FrameField::ReturnBase, static_cast<u32>(result.base));
		write(FrameField::ReturnCount, result.countWord());
		write(FrameField::Top, static_cast<u32>(top));
		write(FrameField::Closure, closure);
		write(FrameField::StackBase, static_cast<u32>(stackBase));
		write(FrameField::StackCapacity, static_cast<u32>(capacity));
	}
};

struct CallFrame {
	Thread* thread = nullptr;
	CallFrame* previous = nullptr;
	CallFrame* next = nullptr;
	Memory* controlMemory = nullptr;
	u32 controlOffset = 0;
	u8* nativeControl = nullptr;
	void bindControl(Memory& memory, u32 offset);
	u32 readControl(FrameField field) const {
		return controlMemory->readRamRecordWord(controlOffset + static_cast<u32>(field));
	}
	i32 readWindow(FrameField field) const {
		return static_cast<i32>(readControl(field) & FRAME_WINDOW_MASK);
	}
	void writeControl(FrameField field, u32 word) {
		controlMemory->writeRamRecordWord(controlOffset + static_cast<u32>(field), word);
	}
	i32 registerBase() const { return m_registerBase; }
	i32 registerTop() const { return readWindow(FrameField::Top) - registerBase(); }
	void setTop(i32 top) {
		top += registerBase();
		writeControl(FrameField::Top, (readControl(FrameField::Top) & ~FRAME_WINDOW_MASK) | static_cast<u32>(top));
	}
	void extendTop(i32 extent) {
		extent += registerBase();
		const u32 top = readControl(FrameField::Top);
		if (extent > static_cast<i32>(top & FRAME_WINDOW_MASK))
			writeControl(FrameField::Top, (top & ~FRAME_WINDOW_MASK) | static_cast<u32>(extent));
	}
	void placeResultTop(CallResultPlacement result, int count) {
		if (result.extendsTop()) extendTop(result.base + count);
		else setTop(result.base + count);
	}
	u32 closureAddress() const { return readControl(FrameField::Closure); }
	u32 captureAddress(u32 index) const {
		return controlMemory->readRamRecordWord(ClosureRecord::captureWordAddress(readControl(FrameField::Closure), index));
	}
	u32 captureCount() const {
		return frameCaptureCount(*controlMemory, readControl(FrameField::Closure));
	}
	ExecutionDomainId savedExecutionBank() const {
		return frameExecutionBank(readControl(FrameField::Flags));
	}
	void saveExecutionBank(ExecutionDomainId domain) {
		writeControl(FrameField::Flags, (readControl(FrameField::Flags) & ~FRAME_BANK_MASK) | frameBankWord(domain));
	}
	void initializeControl(const FrameEntryControl& entry);
	void initializeWindow(u32 pc, u32 issuePc, ExecutionDomainId domain, u32 base, u32 width, u32 top);
	void setRegisterBase(i32 base, i32 width);
	void rebindRegisters();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Only used inside a grant that already admitted the linear frame/stack
	// backing and recorded those ranges for history.
	u32 readAdmittedControl(FrameField field) const {
		return readLE32(nativeControl + static_cast<u32>(field));
	}
	i32 readAdmittedWindow(FrameField field) const {
		return static_cast<i32>(readAdmittedControl(field) & FRAME_WINDOW_MASK);
	}
	void writeAdmittedControl(FrameField field, u32 word) {
		writeLE32(nativeControl + static_cast<u32>(field), word);
	}
	void setAdmittedPhysicalTop(i32 top) {
		writeAdmittedControl(FrameField::Top,
			(readAdmittedControl(FrameField::Top) & ~FRAME_WINDOW_MASK) | static_cast<u32>(top));
	}
#endif
	i32 stackBase() const { return readWindow(FrameField::StackBase) + registerBase(); }
	// A variadic CALL places its working slots after the actual arguments.
	i32 varargCount() const {
		const i32 count = readWindow(FrameField::StackBase) - readWindow(FrameField::VarargBase);
		return count > 0 ? count : 0;
	}
	i32 stackCapacity() const { return readWindow(FrameField::StackCapacity) - registerBase(); }
	void growRegisterWindow(i32 capacity);
	bool hasControlFlag(u32 mask) const;
	void addControlFlags(u32 flags);
	Blua32ExecutionImage* executionImage = nullptr;
	DecodedInstructionPage* decodedPage = nullptr;
	// Host translation admission for the next PC; not architectural state.
	bool compilationEntry = true;
	i32 m_registerBase = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// The native grant owns this activation until return or publication
	// before an observer. Its call site stays live until publication.
	const NativeBlockExitSite* pendingNativeCall = nullptr;
	// Function and Closure are distinct architectural words.
	u32 pendingNativeFunction;
	u32 pendingNativeClosure;
	i32 pendingNativeStackBase;
	// Excess arguments, if any, occupy [varargBase, stackBase).
	i32 pendingNativeVarargBase;
	i32 pendingNativeCallerPhysicalTop;
	// Host translation binding for the suspended caller. Not guest/saved state.
	std::array<void* const*, 2> nativeContinuationCells{};
	u32 nativeContinuationPc = 0;
#endif
	ValueSpan registers;
};

} // namespace bmsx
