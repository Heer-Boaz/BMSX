#pragma once

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
#include "machine/cpu/thread.h"
#include "machine/cpu/closure.h"
#include "machine/execution_address_space.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/lua_heap.h"
#include "spec/blua32/instruction_format.h"
#include "machine/cpu/execution_image.h"
#include "spec/blua32/cop0.h"
#include "spec/blua32/opcode.h"
#include "machine/cpu/table.h"
#include "machine/cpu/value.h"
#include "machine/cpu/snapshot.h"
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/execution_domain.h"
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
#include "machine/cpu/diagnostic_gc_profile.h"
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_compilation_profile.h"
#endif

namespace bmsx {

class CPU;
class NativeCompilerWorker;
class GcHeap;
class IrqController;
class Memory;
struct MappedPageBinding;

struct Table;
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
	void (*observe)(void*, ExecutionDomainId, u32, const Value*) = nullptr;
	void* context = nullptr;
};

using ExecutionHook = bool (*)(void*, ExecutionDomainId, u32);

struct ExecutionHookBinding {
	ExecutionHook hook;
	void* context;
	ExecutionDomainMask domainMask;
	ExecutionDomainMask preMaskableInterruptDomainMask;
};

// Saved values are u32 offsets into the snapshot word arena. Object references
// (closureRef/openUpvalues) are ordinals in its object index.
struct CpuFrameState {
	u32 functionAddress = 0;
	u32 pc = 0;
	int closureRef = -1;
	int stackBase = 0;
	int stackCapacity = 0;
	int varargBase = 0;
	int varargCount = 0;
	int returnBase = 0;
	int returnCount = 0;
	int top = 0;
	bool returnToCompletionLatch = false;
	u32 callSitePc = 0;
	bool isExceptionFrame = false;
	bool isNonMaskableExceptionFrame = false;
};

struct CpuProtectedCallState {
	ProtectedCallKind kind = ProtectedCallKind::PCall;
	int callerFrameIndex = -1;
	int targetFrameIndex = -1;
	bool returnsToProtectedParent = false;
	int callBase = 0;
	int returnCount = 0;
	int handlerRegister = -1;
};

struct CpuRootValueState {
	StringId key = 0;
	u32 value = 0;
};

struct CpuThreadState {
	ThreadStatus status = ThreadStatus::New;
	int entryRef = -1;
	int resumerRef = -1;
	int callBase = 0;
	int returnCount = 0;
	size_t stackCapacity = 0;
	std::vector<u32> stack;
	u32 error = 0;
	std::vector<CpuFrameState> frames;
	std::vector<CpuProtectedCallState> protectedCalls;
	std::vector<int> openUpvalues;
};

struct CpuRuntimeState {
	ExecutionDomainId executionCartridgeSlot = SYSTEM_EXECUTION_DOMAIN_ID;
	std::vector<CpuRootValueState> systemGlobals;
	std::vector<CpuRootValueState> globalSlots;
	ExecutionDomainMask executionResidencyMask = 0;
	u32 nextObjectHashId = 1;
	bool hardHalted = false;
	LuaHeapState luaHeap;
	u32 stringIndexTable = 0;
	int rootThreadRef = -1;
	int activeThreadRef = -1;
	int completionThreadRef = -1;
	std::vector<CpuThreadState> threads;
	std::vector<u32> completionValues;
	CpuSnapshot snapshot;
	ExecutionDomainId lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 lastPc = 0;
	int haltedUntilIrqFrameDepth = -1;
	int haltedUntilIrqThreadRef = -1;
	bool interruptEventPending = false;
	bool memoryWriteBlocked = false;
	uint32_t memoryWriteBlockedAddress = 0;
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
};

enum class AcceptedInterruptKind : uint8_t {
	None = 0,
	Maskable = 1,
	NonMaskable = 2,
};

class GcHeap {
public:
	// Strings live in an append-only pool rather than as GC objects, so the heap
	// reclaims their tracked-byte accounting by marking reachable ids during the
	// mark phase and dropping the rest after the sweep. The pool outlives the heap
	// (declared before it in CPU), so a reference is always valid.
	GcHeap(CPU& cpu, LuaHeap& luaHeap, StringPool& stringPool, StringId modeKey)
		: m_cpu(cpu)
		, m_luaHeap(luaHeap)
		, m_modeKey(modeKey)
		, m_stringPool(stringPool) {}
	~GcHeap();

	template <typename T, typename... Args>
	T* allocate(ObjType type, Args&&... args) {
		T* obj;
		if constexpr (std::is_same_v<T, Table>) {
			obj = m_tables.construct(std::forward<Args>(args)...);
		} else {
			obj = new T(std::forward<Args>(args)...);
		}
		obj->type = type;
		obj->marked = false;
		obj->hashId = allocateHashId();
		obj->next = m_objects;
		m_objects = obj;
		return obj;
	}
	Closure* allocateClosure(size_t upvalueCount);
	template <typename Visitor> void visitThreads(Visitor&& visit) {
		for (auto* object = m_objects; object; object = object->next)
			if (object->type == ObjType::Thread) visit(*static_cast<Thread*>(object));
	}

	uint32_t allocateHashId() { return m_nextObjectHashId++; }
	u32 nextObjectHashId() const { return m_nextObjectHashId; }
	void finishRestore(u32 nextObjectHashId);
	size_t collect(
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil()
	);
	bool markValue(Value v);
	bool markClosure(Closure* closure);
	bool markObject(GCObject* obj);

private:
	uint8_t tableWeakMode(const Table& table) const;
	bool valueIsAlive(Value value) const;
	void trace();
	void convergeEphemerons();
	void clearWeakTables();
	size_t sweep();
	void destroyObject(GCObject* object);

	CPU& m_cpu;
	LuaHeap& m_luaHeap;
	GCObject* m_objects = nullptr;
	std::vector<GCObject*> m_grayStack;
	std::vector<Table*> m_weakTables;
	std::vector<uint8_t> m_weakTableModes;
	std::vector<Table*> m_ephemeronTables;
	uint32_t m_nextObjectHashId = 1;
	StringId m_modeKey;
	StringPool& m_stringPool;
	ObjectStoragePool<Table> m_tables;
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
#endif
	void invalidateMappedWords(u64 key, u32 firstWord, u32 endWord) override;
	void invalidateMappedRange(u64 firstKey, u64 endKey) override;

	void reset();
	void installBootPrimitives();
	void replaceExecutionImage(Blua32ExecutionBoot executionBoot);
	bool isExecutionDomainResident(ExecutionDomainId executionDomainId) const;
	void clearExecutionEnvironment();
	bool isCartridgeExecutionActive() const { return m_activeExecutionImage->executionDomainId >= 0; }
	ExecutionDomainId activeCartridgeSlot() const { return m_activeExecutionImage->executionDomainId; }
	MappedBusSignals readExecutionBusSignals() const { return m_executionBusSignals; }
	StringPool& stringPool() { return m_stringPool; }
	const StringPool& stringPool() const { return m_stringPool; }
	LuaHeap& luaHeap() { return m_luaHeap; }
	const LuaHeap& luaHeap() const { return m_luaHeap; }
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	const DiagnosticGcProfile& diagnosticGcProfile() const { return m_diagnosticGcProfile; }
#endif
	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	void setGlobalByKey(StringId key, const Value& value);
	void setSystemGlobalByKey(StringId key, const Value& value);
	Value getSystemGlobalByKey(StringId key) const;
	Value getGlobalByKey(StringId key) const;
	void clearGlobalSlots();
	size_t globalSlotCount() const { return m_globalNames.size(); }

	Value createBuiltinFunction(BuiltinFunctionId id);
	Table* createTable(int arraySize = 0, int hashSize = 0);

	void beginCompletionCall(Closure& closure, BuiltinArgsView args = {});
	void beginCompletionCallInExecutionDomain(
		ExecutionDomainId executionDomainId,
		u32 functionAddress
	);
	void beginCompletionClosureInExecutionDomain(
		ExecutionDomainId executionDomainId,
		Closure& closure,
		BuiltinArgsView args = {}
	);
	// Move an evicted snapshot here to reuse its storage without copying it.
	CpuRuntimeState captureRuntimeState(CpuSnapshot snapshot = {}) const;
	void restoreRuntimeState(const CpuRuntimeState& state);
	void requestYield();
	void haltUntilIrq();
	void clearHaltUntilIrq();
	bool isHaltedUntilIrq() const {
		return m_haltedUntilIrqThread == m_activeThread
			&& m_haltedUntilIrqFrameDepth == static_cast<int>(m_activeThread->frameDepth);
	}
	bool isMemoryWriteBlocked() const { return m_memoryWriteBlocked; }
	uint32_t stalledMemoryWriteAddress() const { return m_memoryWriteBlockedAddress; }
	void resumeMemoryWrite(uint32_t address);
	void abortStalledMemoryWrite() { m_memoryWriteBlocked = false; }
	bool isUserMode() const { return (m_cop0Words[COP0_STATUS] & CPU_STATUS_USER_MODE_CURRENT) != 0u; }
	void requestNonMaskableInterrupt();
	void cancelNonMaskableInterrupt() { m_nonMaskableInterruptPending = false; }
	bool canAcceptMaskableInterruptLine() const;
	AcceptedInterruptKind peekPendingInterrupt() const;
	bool enterPendingInterrupt();
	void setInstructionObserver(InstructionObserverBinding binding);

	void setExecutionHook(ExecutionHookBinding binding);
	RunResult runUntilDepth(int targetDepth, int instructionBudget, const Thread* target = nullptr);
	void collectHeap();
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
	Thread* rootThread() const { return m_rootThread; }
	int getFrameDepth() const { return static_cast<int>(m_activeThread->frameDepth); }
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
	auto readCompletionValues() const -> std::span<const Value>;
	bool isExceptionFrame(int frameIndex) const;
	int readExceptionReturnFrameDepth() const;
	bool isNonMaskableExceptionFrame(int frameIndex) const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;
	int getFrameUpvalueCount(int frameIndex) const;
	Value readFrameUpvalue(int frameIndex, int upvalueIndex) const;
	Value readClosureUpvalue(const Closure* closure, int upvalueIndex) const;
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
	void runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, int callBase, int returnCount, int argCount);
	void callBuiltinFunction(BuiltinFunction& fn, BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinNextValue(Value target, Value key, BuiltinResults& out);
	void runBuiltinSetMetatable(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinGetMetatable(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinRawGet(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinRawSet(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinSelect(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinStringByte(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinStringChar(BuiltinArgsView args, BuiltinResults& out);
	void runBuiltinError(BuiltinArgsView args);
	void startProtectedCall(BuiltinFunctionId id, CallFrame& caller, int callBase, int returnCount,
		int argumentBase, int argumentCount, bool returnsToProtectedParent);
	void invokeProtectedTarget(size_t continuationIndex, Value target, int argumentBase, int argumentCount);
	void finishProtectedCall(size_t continuationIndex, const Value* values, int valueCount);
	void finishProtectedCall(size_t continuationIndex, CallFrame& source, int sourceBase, int sourceCount);
	void finishProtectedCallWithError(size_t continuationIndex, Value errorValue);
	int writeProtectedResults(ProtectedCallContinuation& continuation, bool prefix, const Value* values, int valueCount);
	int writeProtectedResults(ProtectedCallContinuation& continuation, bool prefix, CallFrame& source, int sourceBase, int sourceCount);
	void finishProtectedContinuation(size_t continuationIndex, int resultCount);
	bool handleProtectedCallError(Value errorValue);
	void unwindToDepth(int targetDepth);
	void collectHeap(Value root0, Value root1, Value root2);
	StringId internExecutionString(
		ExecutionDomainId executionDomainId,
		u32 address,
		u32 byteCount
	);
	std::vector<Value> decodeConstantPool(
		ExecutionDomainId executionDomainId,
		u32 tableAddress,
		u32 constantCount
	);
	std::vector<u32> registerGlobalNames(
		ExecutionDomainId executionDomainId,
		u32 tableAddress,
		u32 nameCount,
		bool system
	);
	std::unique_ptr<Blua32ExecutionImage> activateExecutionImage(Blua32ExecutionBoot executionBoot);
	Blua32ExecutionImage* executionImageForDomain(ExecutionDomainId executionDomainId);
	static MappedBusSignals executionBusSignalsForDomain(ExecutionDomainId executionDomainId);
	void latchActiveExecutionImage(Blua32ExecutionImage& image);
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
	Closure* staticClosureAtAddress(u32 address);
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
	CallFrame* pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc);
	CallFrame* pushFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch);
	CallFrame* pushLatchedFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch);
	Closure* allocateTrackedClosure(u32 functionAddress, size_t upvalueCount);
	Closure* createClosure(CallFrame& frame);
	void executeClosure(CallFrame& frame, int destination, u32 operand, int flags);
	void executeConcat(CallFrame& frame, int destination, int left, int right);
	void executeConcatRange(CallFrame& frame, int destination, int base, int count);
	void closeUpvalues(CallFrame& frame);
	bool executeCall(CallFrame& frame, int a, int b, int c);
	bool executeReturn(CallFrame& frame, int a, int b);
	void executeVararg(CallFrame& frame, int a, int b);
	Upvalue* findOpenUpvalue(const CallFrame& frame, int index) const;
	void linkOpenUpvalue(CallFrame& frame, Upvalue* upvalue);
	const Value& readUpvalue(Upvalue* upvalue) const;
	void writeUpvalue(Upvalue* upvalue, const Value& value);
	void writeReturnValuesFromRegisters(CallFrame& frame, int base, int count, const CallFrame& source, int sourceBase, int sourceCount);
	void writeReturnValuesFromBuiltinResults(CallFrame& frame, int base, int count, const BuiltinResults& values);
	void setRegister(CallFrame& frame, int index, Value value);
	Value* ensureRegisterCapacity(CallFrame& frame, int index);
	bool executeWordStores(CallFrame& frame, u32 address, int source, int count);
	void executeMemoryLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address);
	bool executeMemoryStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address);
	static const Value& readRK(Blua32ExecutionImage& image, Value* registers, int rk) {
		if (rk < 0) {
			return image.constPool[static_cast<size_t>(-1 - rk)];
		}
		return registers[static_cast<size_t>(rk)];
	}
	Value resolveTableIndex(Table* table, const Value& key);
	Value resolveTableIntegerIndex(Table* table, int index);
	Value resolveTableFieldIndex(Table* table, StringId key);
	Value loadTableIndex(const Value& base, const Value& key);
	Value loadTableIntegerIndex(const Value& base, int index);
	Value loadTableFieldIndexCached(int& predictedSlot, const Value& base, StringId key);
	Value loadTableFieldIndex(const Value& base, StringId key);
	void storeTableIndex(const Value& base, const Value& key, const Value& value);
	void storeTableIntegerIndex(const Value& base, int index, const Value& value);
	void storeTableFieldIndexCached(int& predictedSlot, const Value& base, StringId key, const Value& value);

	void clearCallStack();
	void ensureStackSize(size_t size);
	void refreshFrameRegisterPointers();
	BuiltinResultsScratchScope acquireBuiltinResultScratch();
	void releaseLocalRoots(size_t base);
	void trackLocalRoot(Value value);

	void skipNextInstruction(CallFrame& frame);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	friend class NativeBlockGate;
	struct NativeFrameOffsets { size_t haltedThread, haltedDepth, activeImage; };
	static NativeFrameOffsets nativeFrameOffsets();
	static void* dispatchNativeExit(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept;
	void prepareNativeBlock(CallFrame& frame, DecodedInstructionPage& page, u32 word);
	void installNativeRegion(Blua32ExecutionImage& image, DecodedInstructionPage& page, u32 pagePc, u32 slot,
		std::span<const u32> entries, std::vector<std::unique_ptr<NativeBlock>> blocks, u32 instructionCount);
	static NativeBlockTransition compiledReadFieldExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledWriteFieldExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledReadIndexExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledWriteIndexExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledReadIntegerExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledWriteIntegerExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledReadMemoryExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledWriteMemoryExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
	static NativeBlockTransition compiledWriteWordsExit(CPU* cpu, CallFrame* frame, const NativeBlockExitSite* exit);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	void publishNativeCompilation();
	void discardNativeCompilation();
	std::unique_ptr<NativeCompilerWorker> m_nativeCompilerWorker;
	struct PendingNativeCompilation {
		Blua32ExecutionImage* image = nullptr;
		DecodedInstructionPage* page = nullptr;
		u64 key = 0;
		u32 pagePc = 0, slot = 0;
		u32 instructionCount = 0;
		bool invalidated = false;
		std::vector<u32> entries;
		std::vector<const NativeCodeRegion*> merged;
	} m_pendingNativeCompilation;
#endif
	size_t m_nativeCodeBytes = 0;
	bool m_nativeCompilationProfiling = false;
	NativeCompilationProfile m_nativeCompilationProfile;
#endif
	void clearHaltAfterAcceptedInterrupt();
	void enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord);
	void returnFromException(CallFrame& frame);
	void enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address);
	void enterInstructionFetchException(CallFrame& interruptedFrame, u32 causeWord, u32 pc);
	void enterException(u32 functionAddress, u32 causeWord, u32 epcWord);
	void enterLuaFaultException(u32 reason, Value errorValue);
	void hardHalt();
	void blockMappedWrite(CallFrame& frame, uint32_t address);
	void markRoots(GcHeap& heap);

	std::array<
		std::unique_ptr<Blua32ExecutionImage>,
		EXECUTION_DOMAIN_COUNT
	> m_executionImagesByDomain;
	Blua32ExecutionImage* m_systemImage = nullptr;
	Blua32ExecutionImage* m_activeExecutionImage = nullptr;
	MappedBusSignals m_executionBusSignals = MAPPED_BUS_MASTER_CPU;
	int m_haltedUntilIrqFrameDepth = -1;
	Thread* m_haltedUntilIrqThread = nullptr;
	bool m_interruptEventPending = false;
	bool m_memoryWriteBlocked = false;
	uint32_t m_memoryWriteBlockedAddress = 0;
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
	Thread* m_rootThread = nullptr;
	Thread* m_activeThread = nullptr;
	Thread* m_completionThread = nullptr;
	Thread* createThread(Closure* entry);
	bool coroutineYieldable(const Thread& thread) const;
	void returnToResumer(const Value* source, int count, bool succeeded);
	void runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, int base, int count, int argc);
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
	LuaHeap m_luaHeap;
	StringPool m_stringPool;
	Value m_indexKey;
	GcHeap m_heap;
	std::array<Value, LUA_FAULT_REASON_INVALID_ARGUMENT + 1u> m_luaFaultErrorValues;
	Value m_errorInErrorHandlingValue;
	std::unordered_map<u32, Closure> m_staticClosuresByAddress;
	std::array<BuiltinFunction, BUILTIN_FUNCTION_COUNT> m_builtinFunctions;

	ScratchBuffer<BuiltinResults> m_builtinResultScratch;
	size_t m_builtinResultScratchIndex = 0;
	std::vector<Value> m_completionValues;
	std::vector<Value> m_localRoots;
	int m_localRootScopeDepth = 0;

	std::vector<Upvalue*> m_closureUpvalueScratch;
	std::vector<u32> m_closureUpvalueWordScratch;
	std::vector<StringId> m_systemGlobalNames;
	std::vector<Value> m_systemGlobalValues;
	std::unordered_map<StringId, size_t> m_systemGlobalSlotByKey;
	std::vector<StringId> m_globalNames;
	std::vector<Value> m_globalValues;
	std::unordered_map<StringId, size_t> m_globalSlotByKey;
	Table* m_stringIndexTable = nullptr;
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
	DiagnosticGcProfile m_diagnosticGcProfile;
#endif
};

} // namespace bmsx
