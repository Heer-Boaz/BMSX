#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <new>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <utility>
#include <vector>

#include "common/scratchbuffer.h"
#include "common/primitives.h"
#include "machine/cpu/blua32_image.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/closure.h"
#include "machine/execution_address_space.h"
#include "machine/cpu/errors.h"
#include "machine/cpu/instruction_format.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/cop0.h"
#include "machine/cpu/opcode_info.h"
#include "machine/cpu/table.h"
#include "machine/cpu/value.h"
#include "machine/memory/access_kind.h"

namespace bmsx {

class CPU;
class GcHeap;
class IrqController;
class Memory;

struct Table;
class NativeResultsScratchScope {
public:
	NativeResultsScratchScope(CPU& cpu, NativeResults& out) noexcept;
	NativeResultsScratchScope(const NativeResultsScratchScope&) = delete;
	NativeResultsScratchScope& operator=(const NativeResultsScratchScope&) = delete;
	NativeResultsScratchScope(NativeResultsScratchScope&& other) noexcept;
	NativeResultsScratchScope& operator=(NativeResultsScratchScope&& other) = delete;
	~NativeResultsScratchScope();

	NativeResults& get() noexcept { return *m_out; }

private:
	CPU* m_cpu = nullptr;
	NativeResults* m_out = nullptr;
};

enum class RunResult {
	Halted,
	Yielded,
};

enum class CpuValueStateTag : uint8_t {
	Nil,
	False,
	True,
	Number,
	String,
	Builtin,
	Ref,
};

struct CpuValueState {
	CpuValueStateTag tag = CpuValueStateTag::Nil;
	double numberValue = 0;
	StringId stringId = 0;
	BuiltinFunctionId builtinId = BuiltinFunctionId::Next;
	int refId = -1;
};

struct CpuTableHashNodeSnapshot {
	CpuValueState key;
	CpuValueState value;
	int next = -1;
};

struct CpuObjectState {
	enum class Kind : uint8_t {
		Table,
		Closure,
		Upvalue,
	};

	Kind kind = Kind::Table;
	uint32_t hashId = 0;
	std::vector<CpuValueState> array;
	size_t arrayLength = 0;
	std::vector<CpuTableHashNodeSnapshot> hash;
	int hashFree = -1;
	CpuValueState metatable;
	u32 functionAddress = 0;
	bool closureCanonical = false;
	std::vector<int> upvalues;
	bool upvalueOpen = false;
	int upvalueIndex = 0;
	int frameIndex = -1;
	CpuValueState upvalueValue;
};

struct CpuFrameState {
	u32 functionAddress = 0;
	u32 pc = 0;
	int closureRef = -1;
	std::vector<CpuValueState> registers;
	std::vector<CpuValueState> varargs;
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
	std::string name;
	CpuValueState value;
};

struct CpuRuntimeState {
	int executionCartridgeSlot = -1;
	std::vector<CpuRootValueState> systemGlobals;
	std::vector<CpuRootValueState> globals;
	std::vector<CpuFrameState> frames;
	std::vector<CpuProtectedCallState> protectedCalls;
	std::vector<CpuValueState> completionValues;
	std::vector<CpuObjectState> objects;
	std::vector<int> openUpvalues;
	int lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	u32 lastPc = 0;
	int instructionBudgetRemaining = 0;
	bool haltedUntilIrq = false;
	bool interruptEventPending = false;
	bool memoryWriteBlocked = false;
	uint32_t memoryWriteBlockedAddress = 0;
	u32 statusWord = CPU_STATUS_CART_ENTRY;
	u32 causeWord = 0;
	u32 epcWord = 0;
	u32 badAddressWord = 0;
	u32 luaFaultReasonWord = 0;
	u32 nmiReturnCauseWord = 0;
	u32 nmiReturnEpcWord = 0;
	u32 nmiReturnBadAddressWord = 0;
	u32 nmiReturnLuaFaultReasonWord = 0;
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
	explicit GcHeap(StringPool& stringPool) : m_stringPool(stringPool) {}

	template <typename T, typename... Args>
	T* allocate(ObjType type, Args&&... args) {
		auto* obj = new T(std::forward<Args>(args)...);
		obj->type = type;
		obj->marked = false;
		obj->hashId = allocateHashId();
		obj->next = m_objects;
		m_objects = obj;
		m_bytesAllocated += sizeof(T);
		if (m_bytesAllocated > m_nextGC) {
			m_collectRequested = true;
		}
		return obj;
	}
	Closure* allocateClosure(size_t upvalueCount);

	void requestCollection() { m_collectRequested = true; }
	uint32_t allocateHashId() { return m_nextObjectHashId++; }
	void observeHashId(uint32_t hashId) {
		if (m_nextObjectHashId <= hashId) {
			m_nextObjectHashId = hashId + 1u;
		}
	}
	bool needsCollection() const { return m_collectRequested; }
	void collect();
	void suspendCollection() { m_collectionSuspendDepth += 1; }
	void resumeCollection() {
		if (m_collectionSuspendDepth <= 0) {
			throw std::runtime_error("[GcHeap] Collection resume underflow.");
		}
		m_collectionSuspendDepth -= 1;
		if (m_collectionSuspendDepth == 0 && m_collectRequested) {
			collect();
		}
	}

	void markValue(Value v);
	void markClosure(Closure* closure);
	void markObject(GCObject* obj);

	void setRootMarker(std::function<void(GcHeap&)> marker) { m_rootMarker = std::move(marker); }

private:
	void trace();
	void sweep();

	GCObject* m_objects = nullptr;
	std::vector<GCObject*> m_grayStack;
	size_t m_bytesAllocated = 0;
	size_t m_nextGC = 1024 * 1024;
	uint32_t m_nextObjectHashId = 1;
	bool m_collectRequested = false;
	int m_collectionSuspendDepth = 0;
	std::function<void(GcHeap&)> m_rootMarker;
	StringPool& m_stringPool;
};

class CPU {
public:
	CPU(
		Memory& memory,
		IrqController& irqController,
		ExecutionAddressSpace& executionAddressSpace
	);

	void reset();
	void replaceExecutionImage(Blua32DecodedExecutionImage&& decodedImage);
	bool isExecutionDomainResident(int executionDomainId) const;
	void clearExecutionEnvironment();
	bool isCartridgeExecutionActive() const { return m_activeExecutionImage->executionDomainId >= 0; }
	int activeCartridgeSlot() const { return m_activeExecutionImage->executionDomainId; }
	StringPool& stringPool() { return m_stringPool; }
	const StringPool& stringPool() const { return m_stringPool; }
	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	void setStringIndexTable(Table* table) { m_stringIndexTable = table; }
	void setGlobalByKey(const Value& key, const Value& value);
	void setSystemGlobalByKey(const Value& key, const Value& value);
	Value getGlobalByKey(const Value& key) const;
	void clearGlobalSlots();
	void syncGlobalSlotsToTable();

	Value createBuiltinFunction(BuiltinFunctionId id);
	void callBuiltinFunction(BuiltinFunction& fn, NativeArgsView args, NativeResults& out);
	Value createNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost = std::nullopt);
	Value createNativeObject(
		void* raw,
		std::function<Value(const Value&)> get,
		std::function<void(const Value&, const Value&)> set,
		std::function<int()> len,
		std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry
	);
	Table* createTable(int arraySize = 0, int hashSize = 0);

	void call(Closure& closure, NativeArgsView args = {}, int returnCount = 0);
	void beginCompletionCall(Closure& closure, NativeArgsView args = {});
	CpuRuntimeState captureRuntimeState() const;
	void restoreRuntimeState(const CpuRuntimeState& state);
	void requestYield();
	void haltUntilIrq();
	void clearHaltUntilIrq();
	bool isHaltedUntilIrq() const { return m_haltedUntilIrq; }
	bool isMemoryWriteBlocked() const { return m_memoryWriteBlocked; }
	uint32_t stalledMemoryWriteAddress() const { return m_memoryWriteBlockedAddress; }
	void resumeMemoryWrite(uint32_t address);
	void abortStalledMemoryWrite() { m_memoryWriteBlocked = false; }
	bool isUserMode() const { return (m_statusWord & CPU_STATUS_USER_MODE_CURRENT) != 0u; }
	void requestNonMaskableInterrupt();
	void cancelNonMaskableInterrupt() { m_nonMaskableInterruptPending = false; }
	bool canAcceptMaskableInterruptLine() const;
	AcceptedInterruptKind peekPendingInterrupt() const;
	bool enterPendingInterrupt();
	RunResult runUntilDepth(int targetDepth, int instructionBudget);
	void collectHeap();
	class NativeLocalRootsScope {
	public:
		NativeLocalRootsScope(const NativeLocalRootsScope&) = delete;
		NativeLocalRootsScope& operator=(const NativeLocalRootsScope&) = delete;
		NativeLocalRootsScope(NativeLocalRootsScope&& other) noexcept;
		NativeLocalRootsScope& operator=(NativeLocalRootsScope&& other) = delete;
		~NativeLocalRootsScope();

	private:
		friend class CPU;

		explicit NativeLocalRootsScope(CPU& cpu) noexcept;

		CPU* m_cpu = nullptr;
		size_t m_base = 0;
	};
	NativeLocalRootsScope acquireNativeLocalRoots();

	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	int readFrameExecutionDomain(int frameIndex) const;
	int readLastExecutionDomain() const;
	u32 readFrameFunctionAddress(int frameIndex) const;
	u32 readFramePc(int frameIndex) const;
	u32 readFrameCallSitePc(int childFrameIndex) const;
	bool isExceptionFrame(int frameIndex) const;
	bool isNonMaskableExceptionFrame(int frameIndex) const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;
	int getFrameUpvalueCount(int frameIndex) const;
	Value readFrameUpvalue(int frameIndex, int upvalueIndex) const;
	u32 readEpcWord() const;
	void writeEpcWord(u32 value);
	u32 readNmiReturnEpcWord() const;
	void writeNmiReturnEpcWord(u32 value);
	void writeFrameExecution(int frameIndex, int executionDomainId, u32 functionAddress, u32 pc);
	void writeFrameCallSitePc(int childFrameIndex, u32 pc);

	int instructionBudgetRemaining = 0;
	std::vector<Value> completionValues;
	u32 lastPc = 0;
	Table* globals = nullptr;

private:
	friend class NativeResultsScratchScope;
	template <bool RootBoundary>
	RunResult runLoop(int targetDepth, int instructionBudget);
	void runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, int callBase, int returnCount, int argCount);
	void runBuiltinNextValue(Value target, Value key, NativeResults& out);
	void runBuiltinSetMetatable(NativeArgsView args, NativeResults& out);
	void runBuiltinGetMetatable(NativeArgsView args, NativeResults& out);
	void runBuiltinRawGet(NativeArgsView args, NativeResults& out);
	void runBuiltinRawSet(NativeArgsView args, NativeResults& out);
	void runBuiltinSelect(NativeArgsView args, NativeResults& out);
	void runBuiltinStringByte(NativeArgsView args, NativeResults& out);
	void runBuiltinStringChar(NativeArgsView args, NativeResults& out);
	void runBuiltinError(NativeArgsView args);
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
	void runHousekeeping();
	std::vector<u32> registerGlobalNames(const std::vector<std::string>& names, bool system);
	std::unique_ptr<Blua32ExecutionImage> activateExecutionImage(Blua32DecodedExecutionImage&& decodedImage);
	Blua32ExecutionImage* residentExecutionImage(int executionDomainId) const;
	Blua32ExecutionImage* executionImageForDomain(int executionDomainId);
	void decodeImageText(Blua32ExecutionImage& image);
	Closure* staticClosureAtAddress(u32 address);
	Blua32RuntimeFunction* functionRecordInImage(Blua32ExecutionImage& image, u32 address) const;
	Blua32RuntimeFunction* functionRecordInExecutionDomain(Blua32ExecutionImage& executionImage, u32 address) const;
	Blua32RuntimeFunction* functionRecordOnSelectedBus(u32 address);
	void executeFunctionAddress(u32 functionAddress);
	CallFrame* pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc);
	CallFrame* pushFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch);
	Closure* createTrackedClosure(u32 functionAddress, size_t upvalueCount);
	Closure* createClosure(CallFrame& frame, Blua32RuntimeFunction& functionRecord);
	void closeUpvalues(CallFrame& frame);
	Upvalue* findOpenUpvalue(const CallFrame& frame, int index) const;
	const Value& readUpvalue(Upvalue* upvalue);
	void writeUpvalue(Upvalue* upvalue, const Value& value);
	void writeReturnValues(CallFrame& frame, int base, int count, const Value* values, int valueCount);
	void setRegister(CallFrame& frame, int index, Value value);
	Value* ensureRegisterCapacity(CallFrame& frame, int index);
	void writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount);
	const Value& readRK(CallFrame& frame, int rk);
	template <typename Getter>
	Value resolveTableIndexChain(Table* table, Getter get);
	Value resolveTableIndex(Table* table, const Value& key);
	Value resolveTableIntegerIndex(Table* table, int index);
	Value resolveTableFieldIndex(Table* table, StringId key);
	Value loadTableIndex(const Value& base, const Value& key);
	Value loadTableIntegerIndexCached(Blua32ExecutionImage& image, int cacheIndex, const Value& base, int index);
	Value loadTableIntegerIndex(const Value& base, int index);
	Value loadTableFieldIndexCached(Blua32ExecutionImage& image, int cacheIndex, const Value& base, StringId key);
	Value loadTableFieldIndex(const Value& base, StringId key);
	void storeTableIndex(const Value& base, const Value& key, const Value& value);
	void storeTableIntegerIndex(const Value& base, int index, const Value& value);
	void storeTableFieldIndex(const Value& base, StringId key, const Value& value);

	std::unique_ptr<CallFrame> acquireFrame();
	void releaseFrame(std::unique_ptr<CallFrame> frame);
	void clearCallStack();
	void prepareRootExecution(u32 statusWord);
	void enterRootExecution(u32 functionAddress, NativeArgsView args);
	void ensureStackSize(size_t size);
	void refreshFrameRegisterPointers();
	NativeResultsScratchScope acquireNativeReturnScratch();
	void releaseNativeReturnScratch(NativeResults& out);
	void releaseNativeLocalRoots(size_t base);
	void trackNativeLocalRoot(Value value);

	DecodedInstruction& decodedSlotForWrite(Blua32ExecutionImage& image, size_t wordIndex);
	const DecodedInstruction& decodedAtWordIndex(const Blua32ExecutionImage& image, size_t wordIndex) const {
		return image.decodedPages[wordIndex >> DECODED_PAGE_SHIFT]
			.words[static_cast<size_t>(wordIndex) & DECODED_PAGE_MASK];
	}
	void skipNextInstruction(CallFrame& frame);
	void clearHaltAfterAcceptedInterrupt();
	void enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord);
	void enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address);
	void enterException(Blua32ExecutionImage& image, u32 functionAddress, u32 causeWord, u32 epcWord);
	void enterLuaFaultException(u32 reason);
	void hardHalt();
	void blockMappedWrite(CallFrame& frame, uint32_t address);
	void markRoots(GcHeap& heap);

	std::vector<std::unique_ptr<Blua32ExecutionImage>> m_executionImages;
	Blua32ExecutionImage* m_systemImage = nullptr;
	Blua32ExecutionImage* m_activeExecutionImage = nullptr;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	ScratchBuffer<ProtectedCallContinuation> m_protectedCallContinuations;
	size_t m_protectedCallDepth = 0;
	std::vector<OpenUpvalueSlot> m_openUpvalues;
	bool m_haltedUntilIrq = false;
	bool m_interruptEventPending = false;
	bool m_memoryWriteBlocked = false;
	uint32_t m_memoryWriteBlockedAddress = 0;
	u32 m_currentInstructionPc = 0;
	int m_lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	bool m_hardHalted = false;
	u32 m_statusWord = CPU_STATUS_CART_ENTRY;
	u32 m_causeWord = 0;
	u32 m_epcWord = 0;
	u32 m_badAddressWord = 0;
	u32 m_luaFaultReasonWord = 0;
	u32 m_nmiReturnCauseWord = 0;
	u32 m_nmiReturnEpcWord = 0;
	u32 m_nmiReturnBadAddressWord = 0;
	u32 m_nmiReturnLuaFaultReasonWord = 0;
	bool m_nonMaskableInterruptPending = false;
	u32 m_systemExceptionFunctionAddress = 0;
	bool m_yieldRequested = false;
	Memory& m_memory;
	IrqController& m_irqController;
	ExecutionAddressSpace& m_executionAddressSpace;
	StringPool m_stringPool;
	GcHeap m_heap;
	std::unordered_map<u32, Closure> m_staticClosuresByAddress;
	std::array<BuiltinFunction, BUILTIN_FUNCTION_COUNT> m_builtinFunctions;

	ScratchBuffer<NativeResults> m_nativeReturnScratch;
	size_t m_nativeReturnScratchIndex = 0;
	std::vector<Value> m_nativeLocalRoots;
	int m_nativeLocalRootScopeDepth = 0;

	std::vector<std::unique_ptr<CallFrame>> m_framePool;
	static constexpr int MAX_POOLED_FRAMES = 32;
	std::vector<Value> m_stack;
	int m_stackTop = 0;
	Value m_indexKey = valueNil();
	std::vector<StringId> m_systemGlobalNames;
	std::vector<Value> m_systemGlobalValues;
	std::unordered_map<StringId, size_t> m_systemGlobalSlotByKey;
	std::vector<StringId> m_globalNames;
	std::vector<Value> m_globalValues;
	std::unordered_map<StringId, size_t> m_globalSlotByKey;
	Table* m_stringIndexTable;
};

} // namespace bmsx
