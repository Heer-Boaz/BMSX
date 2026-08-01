#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <span>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#include "common/scratchbuffer.h"
#include "common/primitives.h"
#include "machine/cpu/call_state.h"
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
#include "spec/blua32/memory_access_kind.h"
#include "spec/blua32/execution_domain.h"

namespace bmsx {

class CPU;
class GcHeap;
class IrqController;
class Memory;

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
};

enum class CpuValueStateTag : uint8_t {
	Nil,
	False,
	True,
	Number,
	String,
	Builtin,
	Table,
	Closure,
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
	ExecutionDomainId executionCartridgeSlot = SYSTEM_EXECUTION_DOMAIN_ID;
	std::vector<CpuRootValueState> systemGlobals;
	std::vector<CpuRootValueState> globals;
	CpuValueState stringIndexTable;
	std::vector<CpuFrameState> frames;
	std::vector<CpuProtectedCallState> protectedCalls;
	std::vector<CpuValueState> completionValues;
	std::vector<CpuObjectState> objects;
	std::vector<int> openUpvalues;
	ExecutionDomainId lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
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
		auto* obj = new T(std::forward<Args>(args)...);
		obj->type = type;
		obj->marked = false;
		obj->hashId = allocateHashId();
		obj->next = m_objects;
		m_objects = obj;
		return obj;
	}
	Closure* allocateClosure(size_t upvalueCount);

	uint32_t allocateHashId() { return m_nextObjectHashId++; }
	void observeHashId(uint32_t hashId) {
		if (m_nextObjectHashId <= hashId) {
			m_nextObjectHashId = hashId + 1u;
		}
	}
	void collect(
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
	void sweep();
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
};

class CPU {
public:
	CPU(
		Memory& memory,
		IrqController& irqController,
		ExecutionAddressSpace& executionAddressSpace
	);

	void reset();
	void installBootPrimitives();
	void replaceExecutionImage(Blua32ExecutionBoot executionBoot);
	bool isExecutionDomainResident(ExecutionDomainId executionDomainId) const;
	void clearExecutionEnvironment();
	bool isCartridgeExecutionActive() const { return m_activeExecutionImage->executionDomainId >= 0; }
	ExecutionDomainId activeCartridgeSlot() const { return m_activeExecutionImage->executionDomainId; }
	StringPool& stringPool() { return m_stringPool; }
	const StringPool& stringPool() const { return m_stringPool; }
	LuaHeap& luaHeap() { return m_luaHeap; }
	const LuaHeap& luaHeap() const { return m_luaHeap; }
	Memory& memory() { return m_memory; }
	const Memory& memory() const { return m_memory; }
	void setGlobalByKey(StringId key, const Value& value);
	void setSystemGlobalByKey(StringId key, const Value& value);
	Value getSystemGlobalByKey(StringId key) const;
	Value getGlobalByKey(StringId key) const;
	void clearGlobalSlots();
	void syncGlobalSlotsToTable();

	Value createBuiltinFunction(BuiltinFunctionId id);
	Table* createTable(int arraySize = 0, int hashSize = 0);

	void beginCompletionCall(Closure& closure, BuiltinArgsView args = {});
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
	class LocalRootsScope {
	public:
		LocalRootsScope(const LocalRootsScope&) = delete;
		LocalRootsScope& operator=(const LocalRootsScope&) = delete;
		LocalRootsScope(LocalRootsScope&& other) noexcept;
		LocalRootsScope& operator=(LocalRootsScope&& other) = delete;
		~LocalRootsScope();

	private:
		friend class CPU;

		explicit LocalRootsScope(CPU& cpu) noexcept;

		CPU* m_cpu = nullptr;
		size_t m_base = 0;
	};
	LocalRootsScope acquireLocalRoots();

	int getFrameDepth() const { return static_cast<int>(m_frames.size()); }
	ExecutionDomainId readFrameExecutionDomain(int frameIndex) const;
	ExecutionDomainId readLastExecutionDomain() const;
	u32 readFrameFunctionAddress(int frameIndex) const;
	u32 readFramePc(int frameIndex) const;
	u32 readFrameCallSitePc(int childFrameIndex) const;
	bool completionCallPending() const;
	auto readCompletionValues() const -> std::span<const Value>;
	bool isExceptionFrame(int frameIndex) const;
	bool isNonMaskableExceptionFrame(int frameIndex) const;
	int getFrameRegisterCount(int frameIndex) const;
	Value readFrameRegister(int frameIndex, int registerIndex) const;
	int getFrameUpvalueCount(int frameIndex) const;
	Value readFrameUpvalue(int frameIndex, int upvalueIndex) const;
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

	int instructionBudgetRemaining = 0;
	u32 lastPc = 0;
	Table* globals = nullptr;

private:
	friend class BuiltinResultsScratchScope;
	friend class GcHeap;
	friend class LuaHeap;
	template <bool RootBoundary>
	RunResult runLoop(int targetDepth, int instructionBudget);
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
	Blua32ExecutionImage* residentExecutionImage(ExecutionDomainId executionDomainId) const;
	Blua32ExecutionImage* executionImageForDomain(ExecutionDomainId executionDomainId);
	void decodeImageText(Blua32ExecutionImage& image);
	Closure* staticClosureAtAddress(u32 address);
	bool readFunctionRecordInImage(Blua32ExecutionImage& image, u32 address);
	bool readFunctionRecordInExecutionDomain(Blua32ExecutionImage& executionImage, u32 address);
	bool readFunctionRecordOnSelectedBus(u32 address);
	void executeFunctionAddress(u32 functionAddress);
	CallFrame* pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc);
	CallFrame* pushFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch);
	CallFrame* pushLatchedFrame(Closure* closure, const Value* args, size_t argCount,
		int returnBase, int returnCount, bool returnToCompletionLatch);
	Closure* allocateTrackedClosure(u32 functionAddress, size_t upvalueCount);
	Closure* createClosure(CallFrame& frame);
	void closeUpvalues(CallFrame& frame);
	Upvalue* findOpenUpvalue(const CallFrame& frame, int index) const;
	void linkOpenUpvalue(CallFrame& frame, Upvalue* upvalue);
	const Value& readUpvalue(Upvalue* upvalue);
	void writeUpvalue(Upvalue* upvalue, const Value& value);
	void writeReturnValues(CallFrame& frame, int base, int count, const Value* values, int valueCount);
	void setRegister(CallFrame& frame, int index, Value value);
	Value* ensureRegisterCapacity(CallFrame& frame, int index);
	void writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount);
	const Value& readRK(CallFrame& frame, int rk);
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
	void ensureStackSize(size_t size);
	void refreshFrameRegisterPointers();
	BuiltinResultsScratchScope acquireBuiltinResultScratch();
	void releaseLocalRoots(size_t base);
	void trackLocalRoot(Value value);

	DecodedInstruction& decodedSlotForWrite(Blua32ExecutionImage& image, size_t wordIndex);
	const DecodedInstruction& decodedAtWordIndex(const Blua32ExecutionImage& image, size_t wordIndex) const {
		return image.decodedPages[wordIndex >> DECODED_PAGE_SHIFT]
			.words[static_cast<size_t>(wordIndex) & DECODED_PAGE_MASK];
	}
	void skipNextInstruction(CallFrame& frame);
	void clearHaltAfterAcceptedInterrupt();
	void enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord);
	void enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address);
	void enterException(u32 functionAddress, u32 causeWord, u32 epcWord);
	void enterLuaFaultException(u32 reason, Value errorValue);
	void hardHalt();
	void blockMappedWrite(CallFrame& frame, uint32_t address);
	void markRoots(GcHeap& heap);

	std::vector<std::unique_ptr<Blua32ExecutionImage>> m_executionImages;
	Blua32ExecutionImage* m_systemImage = nullptr;
	Blua32ExecutionImage* m_activeExecutionImage = nullptr;
	std::vector<std::unique_ptr<CallFrame>> m_frames;
	ScratchBuffer<ProtectedCallContinuation> m_protectedCallContinuations;
	size_t m_protectedCallDepth = 0;
	bool m_haltedUntilIrq = false;
	bool m_interruptEventPending = false;
	bool m_memoryWriteBlocked = false;
	uint32_t m_memoryWriteBlockedAddress = 0;
	u32 m_currentInstructionPc = 0;
	ExecutionDomainId m_lastExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	bool m_hardHalted = false;
	u32 m_statusWord = CPU_STATUS_CART_ENTRY;
	u32 m_causeWord = 0;
	u32 m_epcWord = 0;
	u32 m_badAddressWord = 0;
	u32 m_luaFaultReasonWord = 0;
	u32 m_exceptionDomainWord = 0;
	u32 m_nmiReturnCauseWord = 0;
	u32 m_nmiReturnEpcWord = 0;
	u32 m_nmiReturnBadAddressWord = 0;
	u32 m_nmiReturnLuaFaultReasonWord = 0;
	u32 m_nmiReturnExceptionDomainWord = 0;
	bool m_nonMaskableInterruptPending = false;
	u32 m_systemExceptionFunctionAddress = 0;
	bool m_yieldRequested = false;
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

	std::vector<std::unique_ptr<CallFrame>> m_framePool;
	std::vector<Upvalue*> m_closureUpvalueScratch;
	static constexpr int MAX_POOLED_FRAMES = 32;
	std::vector<Value> m_stack;
	int m_stackTop = 0;
	std::vector<StringId> m_systemGlobalNames;
	std::vector<Value> m_systemGlobalValues;
	std::unordered_map<StringId, size_t> m_systemGlobalSlotByKey;
	std::vector<StringId> m_globalNames;
	std::vector<Value> m_globalValues;
	std::unordered_map<StringId, size_t> m_globalSlotByKey;
	Table* m_stringIndexTable = nullptr;
};

} // namespace bmsx
