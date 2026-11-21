#pragma once

#include "machine/cpu/gc_heap.h"
#include "machine/cpu/builtin_values.h"

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <span>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "common/scratchbuffer.h"
#include "common/object_storage_pool.h"
#include "common/primitives.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/memory_operation.h"
#include "machine/cpu/thread.h"
#include "machine/cpu/closure.h"
#include "machine/execution_address_space.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/global_bank.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/lua_heap.h"
#include "spec/blua32/instruction_format.h"
#include "machine/cpu/execution_image.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/opcode.h"
#include "machine/cpu/table.h"
#include "machine/cpu/value.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/execution_domain.h"
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
#include "machine/cpu/diagnostic_gc_profile.h"
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_execution_profile.h"
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_compilation_profile.h"
#endif
#if defined(BMSX_NATIVE_GATE_PROFILE)
#include "machine/cpu/native_gate_profile.h"
#endif

namespace bmsx {

class CPU;
class NativeCompilerWorker;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
enum class NativeBuiltinCallOutcome : u32;
#endif
struct NativeCompilationSource;
class GcHeap;
class IrqController;
class Memory;
struct MappedPageBinding;

class TableRecord;
class BuiltinResultsScratchScope {
public:
	BuiltinResultsScratchScope(CPU& cpu, BuiltinResults& out) noexcept;
	BuiltinResultsScratchScope(const BuiltinResultsScratchScope&) = delete;
	BuiltinResultsScratchScope& operator=(const BuiltinResultsScratchScope&) = delete;
	BuiltinResultsScratchScope(BuiltinResultsScratchScope&& other) noexcept;
	BuiltinResultsScratchScope& operator=(BuiltinResultsScratchScope&& other) = delete;
	~BuiltinResultsScratchScope();

	BuiltinResults& get() noexcept { return *m_out; }

private:
	CPU* m_cpu = nullptr;
	BuiltinResults* m_out = nullptr;
};

enum class RunResult {
	Halted,
	Yielded,
	ExecutionStopped,
};

// Host-only configuration. Registers are borrowed; never retain them or execute guest code.
struct InstructionObserverBinding {
	std::array<std::unordered_set<u32>, EXECUTION_DOMAIN_COUNT> points;
	void (*observe)(void*, ExecutionDomainId, u32, ConstValueSpan) = nullptr;
	void* context = nullptr;
};

using ExecutionHook = bool (*)(void*, ExecutionDomainId, u32);

struct ExecutionHookBinding {
	ExecutionHook hook;
	void* context;
	ExecutionDomainMask domainMask;
	ExecutionDomainMask preMaskableInterruptDomainMask;
};

// Main RAM owns language heap and stack records. Only CPU latches live here.
struct CpuRuntimeState {
	ExecutionDomainId executionCartridgeSlot = SYSTEM_EXECUTION_DOMAIN_ID;
	ExecutionDomainId programExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	GlobalBankState systemGlobals;
	GlobalBankState globals;
	ExecutionDomainMask executionResidencyMask = 0;
	std::array<u32, EXECUTION_DOMAIN_COUNT> constantPoolBases{}, globalMapBases{};
	bool hardHalted = false;
	Value stringIndexTable = valueNil();
	u32 rootThreadAddress = 0;
	u32 activeThreadAddress = 0;
	u32 completionThreadAddress = 0;
	std::vector<Value> completionValues;
	ExecutionDomainId lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 lastPc = 0;
	int haltedUntilIrqFrameDepth = -1;
	u32 haltedUntilIrqThreadAddress = 0;
	bool interruptEventPending = false;
	bool memoryWriteBlocked = false;
	uint32_t memoryWriteBlockedAddress = 0;
	PendingMemoryOperation pendingMemory;
	u32 statusWord = CPU_STATUS_CART_ENTRY;
	u32 causeWord = 0;
	u32 epcWord = 0;
	u32 badAddressWord = 0;
	u32 luaFaultReasonWord = 0;
	u32 exceptionDomainWord = 0;
	u32 nmiReturnCauseWord = 0;
	u32 nmiReturnEpcWord = 0;
	u32 nmiReturnBadAddressWord = 0;
	u32 nmiReturnLuaFaultReasonWord = 0;
	u32 nmiReturnExceptionDomainWord = 0;
	bool nonMaskableInterruptPending = false;
	bool yieldRequested = false;
	bool operator==(const CpuRuntimeState&) const = default;
};

enum class AcceptedInterruptKind : uint8_t {
	None = 0,
	Maskable = 1,
	NonMaskable = 2,
};


class CPU : public MappedPageInvalidator {
public:
	CPU(
		Memory& memory,
		IrqController& irqController,
		ExecutionAddressSpace& executionAddressSpace
	);
	~CPU() override;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	void setNativeCompilationProfiling(bool enabled);
	NativeCompilationProfile readNativeCompilationProfile() const;
	// Host-only preparation after boot/reset and before guest execution.
	void prepareSystemNativeCode();
#endif
	void invalidateMappedWords(u64 key, u32 firstWord, u32 endWord) override;
	void bindPhysicalFrames(Thread& thread);
	void invalidateMappedRange(u64 firstKey, u64 endKey) override;

	void reset();
	void installBootPrimitives();
	void replaceExecutionImage(Blua32ExecutionBoot executionBoot);
	bool isExecutionDomainResident(ExecutionDomainId executionDomainId) const;
	void clearExecutionEnvironment();
	bool isCartridgeExecutionActive() const { return m_activeExecutionDomainId >= 0; }
	ExecutionDomainId activeCartridgeSlot() const { return m_activeExecutionDomainId; }
	MappedBusSignals readExecutionBusSignals() const { return m_executionBusSignals; }
	StringPool& stringPool() { return m_stringPool; }
	const StringPool& stringPool() const { return m_stringPool; }
	LuaHeap& luaHeap() { return m_luaHeap; }
	const LuaHeap& luaHeap() const { return m_luaHeap; }
	HeapAllocator& heapAllocator() { return m_heapAllocator; }
	const HeapAllocator& heapAllocator() const { return m_heapAllocator; }
	GcHeap& gcHeap() { return m_heap; }
	const GcHeap& gcHeap() const { return m_heap; }
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	const DiagnosticGcProfile& diagnosticGcProfile() const { return m_diagnosticGcProfile; }
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const DiagnosticExecutionProfile& diagnosticExecutionProfile() const { return m_diagnosticExecutionProfile; }
#endif
#if defined(BMSX_NATIVE_GATE_PROFILE)
	const NativeGateProfile& nativeGateProfile() const { return m_nativeGateProfile; }
#endif
	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	void setGlobalByKey(StringId key, const Value& value);
	void setSystemGlobalByKey(StringId key, const Value& value);
	Value getSystemGlobalByKey(StringId key) const;
	Value getGlobalByKey(StringId key) const;
	size_t globalSlotCount() const { return m_globalBank.count(); }

	Value createBuiltinFunction(BuiltinFunctionId id);
	TableRecord createTable(int arraySize = 0, int hashSize = 0);

	void beginCompletionCall(u32 closure, BuiltinArgsView args = {});
	void beginCompletionCallInExecutionDomain(
		ExecutionDomainId executionDomainId,
		u32 functionAddress
	);
	// Move an evicted snapshot here to reuse its storage without copying it.
	CpuRuntimeState captureRuntimeState(std::vector<Value> completionStorage = {}) const;
	void restoreRuntimeState(const CpuRuntimeState& state);
	void requestYield();
	void haltUntilIrq();
	void clearHaltUntilIrq();
	bool isHaltedUntilIrq() const {
		return m_haltedUntilIrqThreadAddress == m_activeThread->address
			&& m_haltedUntilIrqFrameDepth == static_cast<int>(m_activeThread->frameDepth());
	}
	bool isMemoryWriteBlocked() const { return m_memoryWriteBlocked; }
	uint32_t stalledMemoryWriteAddress() const { return m_memoryWriteBlockedAddress; }
	void resumeMemoryWrite(uint32_t address);
	void abortStalledMemoryWrite() { m_memoryWriteBlocked = false; m_pendingMemory.kind = PendingMemoryKind::None; }
	bool isUserMode() const { return (m_cop0Words[COP0_STATUS] & CPU_STATUS_USER_MODE_CURRENT) != 0u; }
	void requestNonMaskableInterrupt();
	void cancelNonMaskableInterrupt() { m_nonMaskableInterruptPending = false; }
	bool canAcceptMaskableInterruptLine() const;
	AcceptedInterruptKind peekPendingInterrupt() const;
	bool enterPendingInterrupt();
	void setInstructionObserver(InstructionObserverBinding binding);

	void setExecutionHook(ExecutionHookBinding binding);
	RunResult runUntilDepth(int targetDepth, int instructionBudget, u32 target = 0u);
	size_t collectHeap(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	size_t stepHeap(Value root0, Value root1, Value root2, u32 growingThread = 0u);
	bool collecting() const { return m_heap.active(); }
	class LocalRootsScope {
	public:
		LocalRootsScope(const LocalRootsScope&) = delete;
		LocalRootsScope& operator=(const LocalRootsScope&) = delete;
		LocalRootsScope(LocalRootsScope&& other) noexcept;
		LocalRootsScope& operator=(LocalRootsScope&& other) = delete;
		~LocalRootsScope();

	private:
		friend class CPU;

		explicit LocalRootsScope(CPU& cpu);

		CPU* m_cpu = nullptr;
		size_t m_base = 0;
	};
	LocalRootsScope acquireLocalRoots();

	Thread* activeThread() const { return m_activeThread; }
	Thread* rootThread() { return &m_rootView; }
	const Thread* rootThread() const { return &m_rootView; }
	int getFrameDepth() const { return static_cast<int>(m_activeThread->frameDepth()); }
	ExecutionDomainId readFrameExecutionDomain(int frameIndex) const;
	ExecutionDomainId readLastExecutionDomain() const;
	// Instruction start (including WIDE), inspected only during CPU execution.
	u32 readCurrentInstructionPc() const;
	u32 readFrameFunctionAddress(int frameIndex) const;
	u32 readFramePc(int frameIndex) const;
	u32 readFrameCallSitePc(int childFrameIndex) const;
	bool completionCallPending() const;
	bool readFrameReturnsToCompletionLatch(int frameIndex) const;
	void abortCompletionCall(int frameIndex);
	auto readCompletionValues() const -> ConstValueSpan;
	bool isExceptionFrame(int frameIndex) const;
	int readExceptionReturnFrameDepth() const;
	bool isNonMaskableExceptionFrame(int frameIndex) const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;
	int getFrameUpvalueCount(int frameIndex) const;
	Value readFrameUpvalue(int frameIndex, int upvalueIndex) const;
	Value readClosureUpvalue(u32 closure, int upvalueIndex) const;
	u32 readEpcWord() const;
	u32 readCauseWord() const;
	u32 readBadAddressWord() const;
	u32 readLuaFaultReasonWord() const;
	u32 readExceptionDomainWord() const;
	void writeEpcWord(u32 value);
	u32 readNmiReturnEpcWord() const;
	void writeNmiReturnEpcWord(u32 value);
	void writeFrameExecution(
		int frameIndex,
		ExecutionDomainId executionDomainId,
		u32 functionAddress,
		u32 pc
	);
	void writeFrameCallSitePc(int childFrameIndex, u32 pc);

	// Current runUntilDepth grant; consumed by the caller, not checkpoint state.
	int instructionBudgetRemaining = 0;
	u32 lastPc = 0;

private:
	friend class BuiltinResultsScratchScope;
	friend class GcHeap;
	friend class LuaHeap;
	using RunUntilDepthEntry = RunResult (*)(CPU&, int, int);

	static RunResult runUntilDepthNormal(CPU& cpu, int targetDepth, int instructionBudget);
	static RunResult runUntilDepthInstrumented(CPU& cpu, int targetDepth, int instructionBudget);
	template <bool RootBoundary, bool Instrumented>
	RunResult runLoop(
		int targetDepth,
		int instructionBudget
	);
	// Ordinary CALL arguments borrow frame slots by index so backing growth can
	// rebind them. Detached implicit calls carry complete Values until admission.
	struct CallArguments {
		CallFrame* frame;
		const Value* detached;
		int base, count;
		BuiltinArgsView values() const {
			return frame ? BuiltinArgsView(frame->registers.subspan(base, count)) : BuiltinArgsView(detached, count);
		}
		CallArguments tail(int skip) const {
			return frame ? CallArguments{frame, nullptr, base + skip, std::max(count - skip, 0)}
				: CallArguments{nullptr, detached + std::min(skip, count), 0, std::max(count - skip, 0)};
		}
	};
	void runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, CallResultPlacement, const CallArguments&);
	void callBuiltinFunction(BuiltinFunction& fn, BuiltinArgsView args, BuiltinResults& out, int resultLimit);
	void runBuiltinNextValue(Value target, Value key, BuiltinResults& out);
	bool executeBuiltinLeaf(BuiltinFunctionId id, BuiltinArgsView args, Value& result) noexcept;
	void runBuiltinRawGet(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinRawSet(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinSelect(BuiltinArgsView args, BuiltinResults& out, int resultLimit);
	void runBuiltinStringChar(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinError(BuiltinArgsView args);
	void startProtectedCall(BuiltinFunctionId id, CallResultPlacement, const CallArguments&, bool returnsToProtectedParent);
	void invokeProtectedTarget(u32 continuationIndex, Value target, const CallArguments&);
	void finishProtectedCall(u32 continuationIndex, const Value* values, int valueCount);
	void finishProtectedCall(u32 continuationIndex, CallFrame& source, int sourceBase, int sourceCount);
	void finishProtectedCallWithError(u32 continuationIndex, Value errorValue);
	CallFrame& protectedCaller(u32 continuationIndex);
	int writeProtectedResults(u32 continuationIndex, bool prefix, const Value* values, int valueCount);
	int writeProtectedResults(u32 continuationIndex, bool prefix, CallFrame& source, int sourceBase, int sourceCount);
	void finishProtectedContinuation(u32 continuationIndex, int resultCount);
	bool handleProtectedCallError(Value errorValue);
	void unwindToDepth(int targetDepth, bool chargeCaptures);
	size_t collectionRootWordCount() const;
	void decodeConstantPool(ExecutionDomainId executionDomainId, u32 tableAddress, ValueSpan constants);
	void releaseImageData(Blua32ExecutionImage& image);
	void registerGlobalNames(ExecutionDomainId domain, u32 tableAddress, u32 nameCount, GlobalBank& bank, u32 destination);
	std::unique_ptr<Blua32ExecutionImage> activateExecutionImage(Blua32ExecutionBoot boot,
		std::optional<std::array<u32, 2>> restoredBases = std::nullopt);
	Blua32ExecutionImage* executionImageForDomain(ExecutionDomainId executionDomainId);
	static MappedBusSignals executionBusSignalsForDomain(ExecutionDomainId executionDomainId);
	void latchActiveExecutionImage(ExecutionDomainId domain, Blua32ExecutionImage* image);
	void resumeFrameBank();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	void clearNativeContinuationBindings();
#endif
	DecodedInstructionPage& decodedPageForAddress(
		Blua32ExecutionImage& image,
		const MappedPageBinding& binding
	);
	void invalidateDecodedWords(u64 key, u32 firstWord, u32 endWord);
	DecodedInstructionPage& decodedPageForFrame(CallFrame& frame, u32 pc);
	bool decodeInstruction(CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc, bool allowFusion);
	bool decodeInstructionWords(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset,
		u32 pc, u32 sourceWord, u32 bodyWord, bool instructionCacheable, DecodedInstructionPage* bodyPage, bool compilation);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	bool decodeBackedInstruction(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pageOffset,
		u32 pc, MappedBusSignals busSignals);
#endif
	u32 staticClosureForRecord(const FunctionPrototype& record);
	FunctionPrototype decodePrototype(const Blua32FunctionRecordLatch& record) const;
	bool readFunctionRecord(
		Blua32ExecutionImage& image,
		u32 address,
		MappedBusSignals busSignals
	);
	bool readFunctionRecordOnBus(
		Blua32ExecutionImage& ambientExecutionImage,
		u32 address,
		MappedBusSignals busSignals
	);
	void executeFunctionAddress(u32 functionAddress);
	bool setProgramHeapFloor(u32 staticEnd);
	void executeControlWrite(CallFrame& frame, int source, int field);
	bool retargetsHaltedFrame(const Thread& thread, int depth) const {
		return m_haltedUntilIrqThreadAddress == thread.address && m_haltedUntilIrqFrameDepth == depth;
	}
	CallFrame* pushFrame(CallFrame& caller, u32 closure, int argBase, int argCount,
		CallResultPlacement result, u32 callSitePc);
	CallFrame* pushFrame(u32 closure, BuiltinArgsView args,
		CallResultPlacement result, u32 flags = 0u, std::optional<u32> callSitePc = {});
	u32 allocateClosure(const FunctionPrototype&, u32 count, bool canonical, std::span<u32> cells = {});
	u32 createClosure(CallFrame& frame);
	void executeClosure(CallFrame& frame, int destination, u32 operand, int flags);
	void executeConcat(CallFrame& frame, int destination, int left, int right);
	void executeConcatRange(CallFrame& frame, int destination, int base, int count);
	int closeUpvalues(CallFrame& frame, u32 firstSlot = 0);
	bool executeCall(CallFrame& frame, int callee, int supplied, int requested);
	bool executeReturn(CallFrame& frame, int first, int produced);
	void executeVararg(CallFrame& frame, int first, int requested);
	u32 findOpenUpvalue(const CallFrame& frame, int index) const;
	void linkOpenUpvalue(CallFrame& frame, u32 cell, u32 slot);
	void writeReturnValuesFromRegisters(CallFrame& frame, CallResultPlacement, const CallFrame& source, int sourceBase, int sourceCount);
	void writeReturnValues(CallFrame& frame, CallResultPlacement, BuiltinArgsView values);
	void setRegister(CallFrame& frame, int index, Value value);
	ValueSpan ensureRegisterCapacity(CallFrame& frame, int index);
	bool executeWordStores(CallFrame& frame, u32 address, int source, int count);
	bool continueWordStores(CallFrame& frame, u32 address, int source, int count);
	void executeMemoryLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address);
	bool executeMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address);
	bool continueMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address);
	static Value readRK(Blua32ExecutionImage& image, ConstValueSpan registers, int rk) {
		if (rk < 0) {
			return image.constPool.get(static_cast<size_t>(-1 - rk));
		}
		return registers.get(static_cast<size_t>(rk));
	}
	u32 tableIndexAddress(Value base) const;
	bool finishTableRead(CallFrame& frame, int destination, Value base, Value key, const TableLookupResult& result);
	bool loadTableIndex(CallFrame& frame, int destination, Value base, Value key);
	bool loadTableIntegerIndex(CallFrame& frame, int destination, Value base, int index);
	bool loadTableFieldIndexCached(CallFrame& frame, int destination, int& predictedSlot, Value base, StringId key);
	bool loadNativeTableField(CallFrame& frame, int destination, TableStringReadCache& cache, Value base, StringId key);
	void storeTableIndex(const Value& base, const Value& key, const Value& value);
	void storeTableIntegerIndex(const Value& base, int index, const Value& value);
	void storeTableFieldIndexCached(int& predictedSlot, const Value& base, StringId key, const Value& value);

	void clearCallStack();
	void ensureStackSize(size_t size, Value root = valueNil(), bool frameEntry = false, bool exception = false);
	BuiltinResultsScratchScope acquireBuiltinResultScratch();
	void releaseLocalRoots(size_t base);
	void trackLocalRoot(Value value);

	void skipNextInstruction(CallFrame& frame);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	friend class NativeBlockGate;
	static void* tryCallNativeFrame(NativeCpuRunState*, const NativeBlockExitSite*) noexcept;
	static void* tryReturnNativeFrame(NativeCpuRunState*, const NativeBlockExitSite*) noexcept;
	static u32 readNativeLength(NativeBlockRunState*, const StringPool*, Value* operand) noexcept;
	static int placeNativeVarargs(NativeBlockRunState*, int first, int requested) noexcept;
	friend class NativeLowering;
	static void* dispatchNativeExit(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept;
	static NativeBuiltinCallOutcome runNativeBuiltinLeaf(CPU* cpu, NativeBlockRunState* state, const NativeBlockExitSite* exit, u32 builtinWord) noexcept;
	NativeRomCallBinding* bindNativeRomFunction(Blua32ExecutionImage& image, u32 functionAddress) const noexcept;
	static void* tryRunNativeBuiltinLeaf(NativeCpuRunState* run, const NativeBlockExitSite* exit, u32 builtinWord) noexcept;
	void prepareNativeBlock(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pc, MappedBusSignals busSignals);
	void prepareNativeImageCode(Blua32ExecutionImage& image, const Blua32ExecutionBoot& boot);
	void discoverNativeSource(NativeCompilationSource& source, std::vector<u32>* outgoing);
	void prepareNativeSource(NativeCompilationSource& source, bool coldImage);
	void installNativeRegion(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pagePc, u32 slot,
		std::vector<std::unique_ptr<NativeBlock>> blocks);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	void publishNativeCompilation();
	void discardNativeCompilation();
	std::unique_ptr<NativeCompilerWorker> m_nativeCompilerWorker;
	struct PendingNativeCompilation {
		Blua32ExecutionImage* image = nullptr;
		DecodedInstructionPage* page = nullptr;
		u64 key = 0;
		u32 pagePc = 0, slot = 0;
		bool invalidated = false;
	} m_pendingNativeCompilation;
#endif
	size_t m_nativeCodeBytes = 0;
	bool m_nativeCompilationProfiling = false;
	NativeCompilationProfile m_nativeCompilationProfile;
#endif
	void clearHaltAfterAcceptedInterrupt();
	CallFrame* enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord);
	void returnFromException(CallFrame& frame);
	void enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address);
	void enterInstructionFetchException(CallFrame& interruptedFrame, u32 causeWord, u32 pc);
	CallFrame* enterException(Blua32ExecutionImage& vectorImage, u32 functionAddress, u32 causeWord, u32 epcWord);
	void enterLuaFaultException(u32 reason, Value errorValue);
	void hardHalt();
	void blockMappedWrite(CallFrame& frame, uint32_t address);
	void resumePendingMemoryOperation();
	void markRoots(GcHeap& heap);
	void pruneStaticClosures();
	void retireStaticClosure(u32 address);

	std::array<
		std::unique_ptr<Blua32ExecutionImage>,
		EXECUTION_DOMAIN_COUNT
	> m_executionImagesByDomain;
	Blua32ExecutionImage* m_systemImage = nullptr;
	Blua32ExecutionImage* m_activeExecutionImage = nullptr;
	ExecutionDomainId m_activeExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	ExecutionDomainId m_programExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	MappedBusSignals m_executionBusSignals = MAPPED_BUS_MASTER_CPU;
	int m_haltedUntilIrqFrameDepth = -1;
	u32 m_haltedUntilIrqThreadAddress = 0u;
	bool m_interruptEventPending = false;
	bool m_memoryWriteBlocked = false;
	uint32_t m_memoryWriteBlockedAddress = 0;
	PendingMemoryOperation m_pendingMemory;
	u32 m_currentInstructionPc = 0;
	ExecutionDomainId m_lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	bool m_hardHalted = false;
	std::array<u32, COP0_EXEC + 1u> m_cop0Words{};
	u32 m_exceptionDomainWord = 0;
	u32 m_nmiReturnCauseWord = 0;
	u32 m_nmiReturnEpcWord = 0;
	u32 m_nmiReturnBadAddressWord = 0;
	u32 m_nmiReturnLuaFaultReasonWord = 0;
	u32 m_nmiReturnExceptionDomainWord = 0;
	bool m_nonMaskableInterruptPending = false;
	u32 m_systemExceptionFunctionAddress = 0;
	bool m_yieldRequested = false;
	bool m_threadSwitchRequested = false;
	bool m_activeStackRebound = false;
	Thread* m_activeThread = nullptr;
	u32 m_completionThreadAddress = 0u;
	u32 createThread(u32 entry);
	Thread& bindThread(u32 address);
	void retireThreadView(u32 address);
	void rebindRelocatedThread(u32 address);
	template<class Visitor> void visitThreadViews(Visitor&& visitor) {
		if (m_rootView.address != 0u) visitor(m_rootView);
		for (auto& view : m_transferViews) if (view.address != 0u) visitor(view);
	}
	bool coroutineYieldable(u32 address) const;
	void returnToResumer(BuiltinArgsView values, bool succeeded);
	void runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, CallResultPlacement, const CallArguments&);
	bool handleThreadError(Value error);
	void closeThread(Thread& thread);

	ExecutionHookBinding m_executionHookBinding{nullptr, nullptr, 0u, 0u};
	InstructionObserverBinding m_instructionObserver;
	RunUntilDepthEntry m_runUntilDepthEntry = &CPU::runUntilDepthNormal;
	Memory& m_memory;
	IrqController& m_irqController;
	ExecutionAddressSpace& m_executionAddressSpace;
	Span<const u8> m_executionReadView;
	Span<const u8> m_executionTableView;
	Blua32FunctionRecordLatch m_functionRecordLatch;
	HeapAllocator m_heapAllocator;
	LuaHeap m_luaHeap;
	StringPool m_stringPool;
	Value m_indexKey;
	GcHeap m_heap;
	Thread m_rootView;
	std::array<Thread, 2> m_transferViews;
	std::array<Value, LUA_FAULT_REASON_INVALID_NEXT_KEY + 1u> m_luaFaultErrorValues;
	Value m_errorInErrorHandlingValue;
	std::unordered_map<u32, std::vector<u32>> m_staticClosuresByAddress;
	std::array<BuiltinFunction, BUILTIN_FUNCTION_COUNT> m_builtinFunctions;

	ScratchBuffer<BuiltinResults> m_builtinResultScratch;
	size_t m_builtinResultScratchIndex = 0;
	ValueSlots m_completionValues{8};
	size_t m_completionValueCount = 0;
	std::vector<Value> m_localRoots;
	int m_localRootScopeDepth = 0;

	std::vector<u32> m_closureCellScratch;
	std::vector<u32> m_closureUpvalueWordScratch;
	std::vector<u32> m_captureAddressScratch;
	GlobalBank m_systemGlobalBank;
	GlobalBank m_globalBank;
	Value m_stringIndexTable = valueNil();
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES) || defined(BMSX_NATIVE_GATE_PROFILE) || defined(BMSX_DIAGNOSTIC_CPU_TIMING)
	DiagnosticGcProfile m_diagnosticGcProfile;
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	DiagnosticExecutionProfile m_diagnosticExecutionProfile;
#endif
#if defined(BMSX_NATIVE_GATE_PROFILE)
	NativeGateProfile m_nativeGateProfile;
#endif
};

} // namespace bmsx
