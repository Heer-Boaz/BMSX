#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binencoder.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/contracts.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/schema.h"
#include <cmath>
#include <limits>
#include <string>
#include <utility>

namespace bmsx {
namespace {

template<typename T, typename EncodeFn>
BinValue encodeVector(const std::vector<T>& values, EncodeFn&& encode) {
	BinArray array;
	array.reserve(values.size());
	for (const T& value : values) {
		array.push_back(encode(value));
	}
	return BinValue(std::move(array));
}

template<typename T, typename DecodeFn>
std::vector<T> decodeVector(const BinValue& value, const char* label, DecodeFn&& decode) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an array.");
	}
	const BinArray& array = value.asArray();
	std::vector<T> out;
	out.reserve(array.size());
	for (size_t index = 0; index < array.size(); ++index) {
		out.push_back(decode(array[index], index));
	}
	return out;
}

const BinObject& requireObject(const BinValue& value, const char* label) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an object.");
	}
	return value.asObject();
}

const BinArray& requireArray(const BinValue& value, const char* label) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an array.");
	}
	return value.asArray();
}

const BinBinary& requireBinary(const BinValue& value, const char* label) {
	if (!value.isBinary()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be binary.");
	}
	return value.asBinary();
}

std::vector<u8> requireBinaryWithLength(const BinValue& value, const char* label, size_t byteLength) {
	const BinBinary& bytes = requireBinary(value, label);
	if (bytes.size() != byteLength) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must contain " + std::to_string(byteLength) + " bytes.");
	}
	return bytes;
}

const BinValue& requireField(const BinObject& object, const char* key, const char* label) {
	auto it = object.find(key);
	if (it == object.end()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + "." + key + " is required.");
	}
	return it->second;
}

std::string requireString(const BinValue& value, const char* label) {
	if (!value.isString()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a string.");
	}
	return value.asString();
}

bool requireBool(const BinValue& value, const char* label) {
	if (!value.isBool()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a boolean.");
	}
	return value.asBool();
}

f64 requireNumber(const BinValue& value, const char* label) {
	if (!value.isNumber()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be numeric.");
	}
	return value.toNumber();
}

i32 requireI32(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number
		|| number < static_cast<f64>(std::numeric_limits<int32_t>::min())
		|| number > static_cast<f64>(std::numeric_limits<int32_t>::max())) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a 32-bit integer.");
	}
	return static_cast<i32>(number);
}

i64 requireI64(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an integer.");
	}
	return static_cast<i64>(number);
}

u32 requireU32(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number
		|| number < 0.0
		|| number > static_cast<f64>(std::numeric_limits<uint32_t>::max())) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a uint32.");
	}
	return static_cast<u32>(number);
}

u32 requireBoundedU32(const BinValue& value, const char* label, u32 min, u32 max) {
	const u32 word = requireU32(value, label);
	if (word < min || word > max) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be inside the declared u32 range.");
	}
	return word;
}

template<typename Out, typename In>
BinValue encodeScalar(In value) {
	return BinValue(static_cast<Out>(value));
}

template<typename T, size_t N, typename EncodeFn>
BinValue encodeFixedArray(const std::array<T, N>& values, EncodeFn&& encode) {
	BinArray array;
	array.reserve(N);
	for (const T& value : values) {
		array.push_back(encode(value));
	}
	return BinValue(std::move(array));
}

template<size_t N>
std::array<u32, N> decodeU32Array(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != N) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(N) + " entries.");
	}
	std::array<u32, N> out{};
	for (size_t index = 0; index < N; ++index) {
		out[index] = requireU32(array[index], label);
	}
	return out;
}

template<size_t N>
std::array<u8, N> decodeU8Array(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != N) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(N) + " entries.");
	}
	std::array<u8, N> out{};
	for (size_t index = 0; index < N; ++index) {
		out[index] = static_cast<u8>(requireBoundedU32(array[index], label, 0u, 0xffu));
	}
	return out;
}


std::vector<u32> decodeU32VectorWithLength(const BinValue& value, const char* label, size_t count) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != count) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(count) + " entries.");
	}
	std::vector<u32> out;
	out.reserve(count);
	for (size_t index = 0; index < count; ++index) {
		out.push_back(requireU32(array[index], label));
	}
	return out;
}

std::vector<u8> decodeU8VectorWithLength(const BinValue& value, const char* label, size_t count) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != count) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(count) + " entries.");
	}
	std::vector<u8> out;
	out.reserve(count);
	for (size_t index = 0; index < count; ++index) {
		out.push_back(static_cast<u8>(requireBoundedU32(array[index], label, 0u, 0xffu)));
	}
	return out;
}

template<size_t N>
std::array<i32, N> decodeI32Array(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != N) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(N) + " entries.");
	}
	std::array<i32, N> out{};
	for (size_t index = 0; index < N; ++index) {
		out[index] = requireI32(array[index], label);
	}
	return out;
}

template<size_t N>
std::array<i64, N> decodeI64Array(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != N) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(N) + " entries.");
	}
	std::array<i64, N> out{};
	for (size_t index = 0; index < N; ++index) {
		out[index] = requireI64(array[index], label);
	}
	return out;
}

BinValue encodeCpuValueState(const CpuValueState& state);
CpuValueState decodeCpuValueState(const BinValue& value, const char* label);

BinValue encodeTickCompletion(const TickCompletion& state) {
	BinObject object;
	object["sequence"] = static_cast<i64>(state.sequence);
	object["remaining"] = static_cast<i64>(state.remaining);
	object["visualCommitted"] = state.visualCommitted;
	return BinValue(std::move(object));
}

TickCompletion decodeTickCompletion(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	TickCompletion state;
	state.sequence = requireI64(requireField(object, "sequence", label), "tickCompletion.sequence");
	state.remaining = requireI32(requireField(object, "remaining", label), "tickCompletion.remaining");
	state.visualCommitted = requireBool(requireField(object, "visualCommitted", label), "tickCompletion.visualCommitted");
	return state;
}

BinValue encodeFrameSchedulerState(const FrameSchedulerStateSnapshot& state) {
	BinObject object;
	object["accumulatedHostTimeMs"] = state.accumulatedHostTimeMs;
	object["queuedTickCompletions"] = encodeVector(state.queuedTickCompletions, [](const TickCompletion& completion) {
		return encodeTickCompletion(completion);
	});
	object["lastTickSequence"] = static_cast<i64>(state.lastTickSequence);
	object["lastTickBudgetGranted"] = static_cast<i64>(state.lastTickBudgetGranted);
	object["lastTickCpuBudgetGranted"] = static_cast<i64>(state.lastTickCpuBudgetGranted);
	object["lastTickCpuUsedCycles"] = static_cast<i64>(state.lastTickCpuUsedCycles);
	object["lastTickBudgetRemaining"] = static_cast<i64>(state.lastTickBudgetRemaining);
	object["lastTickVisualFrameCommitted"] = state.lastTickVisualFrameCommitted;
	object["lastTickCompleted"] = state.lastTickCompleted;
	object["lastTickConsumedSequence"] = static_cast<i64>(state.lastTickConsumedSequence);
	return BinValue(std::move(object));
}

FrameSchedulerStateSnapshot decodeFrameSchedulerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	FrameSchedulerStateSnapshot state;
	state.accumulatedHostTimeMs = requireNumber(requireField(object, "accumulatedHostTimeMs", label), "frameScheduler.accumulatedHostTimeMs");
	state.queuedTickCompletions = decodeVector<TickCompletion>(requireField(object, "queuedTickCompletions", label), "frameScheduler.queuedTickCompletions",
		[](const BinValue& entryValue, size_t) {
			return decodeTickCompletion(entryValue, "frameScheduler.queuedTickCompletions[]");
		});
	state.lastTickSequence = requireI64(requireField(object, "lastTickSequence", label), "frameScheduler.lastTickSequence");
	state.lastTickBudgetGranted = requireI32(requireField(object, "lastTickBudgetGranted", label), "frameScheduler.lastTickBudgetGranted");
	state.lastTickCpuBudgetGranted = requireI32(requireField(object, "lastTickCpuBudgetGranted", label), "frameScheduler.lastTickCpuBudgetGranted");
	state.lastTickCpuUsedCycles = requireI32(requireField(object, "lastTickCpuUsedCycles", label), "frameScheduler.lastTickCpuUsedCycles");
	state.lastTickBudgetRemaining = requireI32(requireField(object, "lastTickBudgetRemaining", label), "frameScheduler.lastTickBudgetRemaining");
	state.lastTickVisualFrameCommitted = requireBool(requireField(object, "lastTickVisualFrameCommitted", label), "frameScheduler.lastTickVisualFrameCommitted");
	state.lastTickCompleted = requireBool(requireField(object, "lastTickCompleted", label), "frameScheduler.lastTickCompleted");
	state.lastTickConsumedSequence = requireI64(requireField(object, "lastTickConsumedSequence", label), "frameScheduler.lastTickConsumedSequence");
	return state;
}

BinValue encodeRuntimeVblankState(const RuntimeVblankSnapshot& state) {
	BinObject object;
	object["nowCycles"] = static_cast<i64>(state.nowCycles);
	object["cyclesIntoFrame"] = static_cast<i64>(state.cyclesIntoFrame);
	return BinValue(std::move(object));
}

RuntimeVblankSnapshot decodeRuntimeVblankState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeVblankSnapshot state;
	state.nowCycles = requireI64(requireField(object, "nowCycles", label), "vblank.nowCycles");
	state.cyclesIntoFrame = requireI32(requireField(object, "cyclesIntoFrame", label), "vblank.cyclesIntoFrame");
	return state;
}

BinValue encodeMemorySaveState(const MemorySaveState& state) {
	BinObject object;
	object["ram"] = BinValue(BinBinary(state.ram.begin(), state.ram.end()));
	object["busFaultCode"] = static_cast<f64>(state.busFaultCode);
	object["busFaultAddr"] = static_cast<f64>(state.busFaultAddr);
	object["busFaultAccess"] = static_cast<f64>(state.busFaultAccess);
	return BinValue(std::move(object));
}

MemorySaveState decodeMemorySaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MemorySaveState state;
	state.ram = requireBinary(requireField(object, "ram", label), "machine.memory.ram");
	if (state.ram.size() != RAM_END - RAM_BASE) {
		throw BMSX_RUNTIME_ERROR("machine.memory.ram must contain " + std::to_string(RAM_END - RAM_BASE) + " bytes.");
	}
	state.busFaultCode = requireU32(requireField(object, "busFaultCode", label), "machine.memory.busFaultCode");
	state.busFaultAddr = requireU32(requireField(object, "busFaultAddr", label), "machine.memory.busFaultAddr");
	state.busFaultAccess = requireU32(requireField(object, "busFaultAccess", label), "machine.memory.busFaultAccess");
	return state;
}

BinValue encodeIrqControllerState(const IrqControllerState& state) {
	BinObject object;
	object["mask"] = static_cast<f64>(state.mask);
	object["pendingFlags"] = static_cast<f64>(state.pendingFlags);
	return BinValue(std::move(object));
}

IrqControllerState decodeIrqControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	IrqControllerState state;
	state.mask = requireU32(requireField(object, "mask", label), "machine.irq.mask");
	state.pendingFlags = requireU32(requireField(object, "pendingFlags", label), "machine.irq.pendingFlags");
	return state;
}

BinValue encodeStringPoolStateEntry(const StringPoolStateEntry& state) {
	BinObject object;
	object["id"] = static_cast<i64>(state.id);
	object["value"] = state.value;
	object["tracked"] = state.tracked;
	return BinValue(std::move(object));
}

StringPoolStateEntry decodeStringPoolStateEntry(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	StringPoolStateEntry state;
	state.id = requireU32(requireField(object, "id", label), "machine.stringPool.entries[].id");
	state.value = requireString(requireField(object, "value", label), "machine.stringPool.entries[].value");
	state.tracked = requireBool(requireField(object, "tracked", label), "machine.stringPool.entries[].tracked");
	return state;
}

BinValue encodeStringPoolState(const StringPoolState& state) {
	BinObject object;
	object["entries"] = encodeVector<StringPoolStateEntry>(state.entries, encodeStringPoolStateEntry);
	return BinValue(std::move(object));
}

StringPoolState decodeStringPoolState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	StringPoolState state;
	state.entries = decodeVector<StringPoolStateEntry>(
		requireField(object, "entries", label),
		"machine.stringPool.entries",
		[](const BinValue& entry, size_t) { return decodeStringPoolStateEntry(entry, "machine.stringPool.entries[]"); }
	);
	return state;
}

BinValue encodeInputControllerState(const InputControllerState& state) {
	BinObject object;
	object["sampleArmed"] = state.sampleArmed;
	object["sampleSequence"] = static_cast<i64>(state.sampleSequence);
	object["lastSampleCycle"] = static_cast<i64>(state.lastSampleCycle);
	BinObject registers;
	registers["ctrl"] = static_cast<i64>(state.registers.ctrl);
	BinArray keyWords;
	for (const u32 word : state.registers.keyWords) {
		keyWords.emplace_back(static_cast<i64>(word));
	}
	registers["keyWords"] = BinValue(std::move(keyWords));
	registers["pointerButtons"] = static_cast<i64>(state.registers.pointerButtons);
	registers["pointerXQ16"] = static_cast<i64>(state.registers.pointerXQ16);
	registers["pointerYQ16"] = static_cast<i64>(state.registers.pointerYQ16);
	registers["pointerWheelQ16"] = static_cast<i64>(state.registers.pointerWheelQ16);
	BinArray padButtons;
	for (const u32 word : state.registers.padButtons) {
		padButtons.emplace_back(static_cast<i64>(word));
	}
	registers["padButtons"] = BinValue(std::move(padButtons));
	BinArray padAxesQ16;
	for (const u32 word : state.registers.padAxesQ16) {
		padAxesQ16.emplace_back(static_cast<i64>(word));
	}
	registers["padAxesQ16"] = BinValue(std::move(padAxesQ16));
	registers["outputPort"] = static_cast<i64>(state.registers.outputPort);
	registers["outputIntensityQ16"] = static_cast<i64>(state.registers.outputIntensityQ16);
	registers["outputDurationMs"] = static_cast<i64>(state.registers.outputDurationMs);
	registers["outputStatus"] = static_cast<i64>(state.registers.outputStatus);
	object["registers"] = BinValue(std::move(registers));
	return BinValue(std::move(object));
}

InputControllerState decodeInputControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinObject& registers = requireObject(requireField(object, "registers", label), "machine.input.registers");
	InputControllerState state;
	state.sampleArmed = requireBool(requireField(object, "sampleArmed", label), "machine.input.sampleArmed");
	state.sampleSequence = requireU32(requireField(object, "sampleSequence", label), "machine.input.sampleSequence");
	state.lastSampleCycle = requireU32(requireField(object, "lastSampleCycle", label), "machine.input.lastSampleCycle");
	state.registers.ctrl = requireU32(requireField(registers, "ctrl", "machine.input.registers"), "machine.input.registers.ctrl");
	const auto decodeWordArray = [&registers](const char* key, u32* out, size_t count) {
		const BinArray& array = requireArray(requireField(registers, key, "machine.input.registers"), key);
		if (array.size() != count) {
			throw std::runtime_error(std::string("machine.input.registers.") + key + " has unexpected length.");
		}
		for (size_t i = 0; i < count; i += 1) {
			out[i] = requireU32(array[i], key);
		}
	};
	decodeWordArray("keyWords", state.registers.keyWords.data(), state.registers.keyWords.size());
	state.registers.pointerButtons = requireU32(requireField(registers, "pointerButtons", "machine.input.registers"), "machine.input.registers.pointerButtons");
	state.registers.pointerXQ16 = requireU32(requireField(registers, "pointerXQ16", "machine.input.registers"), "machine.input.registers.pointerXQ16");
	state.registers.pointerYQ16 = requireU32(requireField(registers, "pointerYQ16", "machine.input.registers"), "machine.input.registers.pointerYQ16");
	state.registers.pointerWheelQ16 = requireU32(requireField(registers, "pointerWheelQ16", "machine.input.registers"), "machine.input.registers.pointerWheelQ16");
	decodeWordArray("padButtons", state.registers.padButtons.data(), state.registers.padButtons.size());
	decodeWordArray("padAxesQ16", state.registers.padAxesQ16.data(), state.registers.padAxesQ16.size());
	state.registers.outputPort = requireU32(requireField(registers, "outputPort", "machine.input.registers"), "machine.input.registers.outputPort");
	state.registers.outputIntensityQ16 = requireU32(requireField(registers, "outputIntensityQ16", "machine.input.registers"), "machine.input.registers.outputIntensityQ16");
	state.registers.outputDurationMs = requireU32(requireField(registers, "outputDurationMs", "machine.input.registers"), "machine.input.registers.outputDurationMs");
	state.registers.outputStatus = requireU32(requireField(registers, "outputStatus", "machine.input.registers"), "machine.input.registers.outputStatus");
	return state;
}

BinValue encodeGeometryJobState(const GeometryJobState& state) {
	BinObject object;
	object["cmd"] = static_cast<i64>(state.cmd);
	object["src0"] = static_cast<i64>(state.src0);
	object["src1"] = static_cast<i64>(state.src1);
	object["src2"] = static_cast<i64>(state.src2);
	object["dst0"] = static_cast<i64>(state.dst0);
	object["dst1"] = static_cast<i64>(state.dst1);
	object["count"] = static_cast<i64>(state.count);
	object["param0"] = static_cast<i64>(state.param0);
	object["param1"] = static_cast<i64>(state.param1);
	object["stride0"] = static_cast<i64>(state.stride0);
	object["stride1"] = static_cast<i64>(state.stride1);
	object["stride2"] = static_cast<i64>(state.stride2);
	object["processed"] = static_cast<i64>(state.processed);
	object["resultCount"] = static_cast<i64>(state.resultCount);
	object["exactPairCount"] = static_cast<i64>(state.exactPairCount);
	object["broadphasePairCount"] = static_cast<i64>(state.broadphasePairCount);
	return BinValue(std::move(object));
}

GeometryJobState decodeGeometryJobState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GeometryJobState state;
	state.cmd = requireU32(requireField(object, "cmd", label), "machine.geometry.activeJob.cmd");
	state.src0 = requireU32(requireField(object, "src0", label), "machine.geometry.activeJob.src0");
	state.src1 = requireU32(requireField(object, "src1", label), "machine.geometry.activeJob.src1");
	state.src2 = requireU32(requireField(object, "src2", label), "machine.geometry.activeJob.src2");
	state.dst0 = requireU32(requireField(object, "dst0", label), "machine.geometry.activeJob.dst0");
	state.dst1 = requireU32(requireField(object, "dst1", label), "machine.geometry.activeJob.dst1");
	state.count = requireU32(requireField(object, "count", label), "machine.geometry.activeJob.count");
	state.param0 = requireU32(requireField(object, "param0", label), "machine.geometry.activeJob.param0");
	state.param1 = requireU32(requireField(object, "param1", label), "machine.geometry.activeJob.param1");
	state.stride0 = requireU32(requireField(object, "stride0", label), "machine.geometry.activeJob.stride0");
	state.stride1 = requireU32(requireField(object, "stride1", label), "machine.geometry.activeJob.stride1");
	state.stride2 = requireU32(requireField(object, "stride2", label), "machine.geometry.activeJob.stride2");
	state.processed = requireU32(requireField(object, "processed", label), "machine.geometry.activeJob.processed");
	state.resultCount = requireU32(requireField(object, "resultCount", label), "machine.geometry.activeJob.resultCount");
	state.exactPairCount = requireU32(requireField(object, "exactPairCount", label), "machine.geometry.activeJob.exactPairCount");
	state.broadphasePairCount = requireU32(requireField(object, "broadphasePairCount", label), "machine.geometry.activeJob.broadphasePairCount");
	return state;
}

BinValue encodeGeometryControllerState(const GeometryControllerState& state) {
	BinObject object;
	object["phase"] = static_cast<i64>(static_cast<u32>(state.phase));
	object["registerWords"] = encodeFixedArray(state.registerWords, encodeScalar<i64, u32>);
	object["activeJob"] = state.activeJob.has_value() ? encodeGeometryJobState(*state.activeJob) : BinValue(nullptr);
	object["workCarry"] = static_cast<i64>(state.workCarry);
	object["availableWorkUnits"] = static_cast<i64>(state.availableWorkUnits);
	return BinValue(std::move(object));
}

GeometryControllerState decodeGeometryControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GeometryControllerState state;
	const u32 phase = requireU32(requireField(object, "phase", label), "machine.geometry.phase");
	if (phase > static_cast<u32>(GeometryControllerPhase::Rejected)) {
		throw BMSX_RUNTIME_ERROR("machine.geometry.phase out of range");
	}
	state.phase = static_cast<GeometryControllerPhase>(phase);
	state.registerWords = decodeU32Array<GEOMETRY_CONTROLLER_REGISTER_COUNT>(requireField(object, "registerWords", label), "machine.geometry.registerWords");
	const BinValue& activeJob = requireField(object, "activeJob", label);
	if (!activeJob.isNull()) {
		state.activeJob = decodeGeometryJobState(activeJob, "machine.geometry.activeJob");
	}
	state.workCarry = requireI64(requireField(object, "workCarry", label), "machine.geometry.workCarry");
	state.availableWorkUnits = requireU32(requireField(object, "availableWorkUnits", label), "machine.geometry.availableWorkUnits");
	return state;
}

BinValue encodeGxGpuCommandBufferState(const GxGpuCommandBufferState& state) {
	BinObject object;
	object["commandCount"] = static_cast<i64>(state.commandCount);
	object["presentCommandCount"] = static_cast<i64>(state.presentCommandCount);
	object["wordCount"] = static_cast<i64>(state.wordCount);
	object["commandKind"] = encodeVector(state.commandKind, encodeScalar<i64, u8>);
	object["commandOpcode"] = encodeVector(state.commandOpcode, encodeScalar<i64, u8>);
	object["commandWordStart"] = encodeVector(state.commandWordStart, encodeScalar<i64, u32>);
	object["commandWordCount"] = encodeVector(state.commandWordCount, encodeScalar<i64, u32>);
	object["commandDrawModeWord"] = encodeVector(state.commandDrawModeWord, encodeScalar<i64, u32>);
	object["commandTextureWindowWord"] = encodeVector(state.commandTextureWindowWord, encodeScalar<i64, u32>);
	object["commandDrawingAreaTopLeftWord"] = encodeVector(state.commandDrawingAreaTopLeftWord, encodeScalar<i64, u32>);
	object["commandDrawingAreaBottomRightWord"] = encodeVector(state.commandDrawingAreaBottomRightWord, encodeScalar<i64, u32>);
	object["commandDrawingOffsetWord"] = encodeVector(state.commandDrawingOffsetWord, encodeScalar<i64, u32>);
	object["commandMaskBitModeWord"] = encodeVector(state.commandMaskBitModeWord, encodeScalar<i64, u32>);
	object["commandInterlacedRenderWord"] = encodeVector(state.commandInterlacedRenderWord, encodeScalar<i64, u8>);
	object["words"] = encodeVector(state.words, encodeScalar<i64, u32>);
	object["readbackPhase"] = static_cast<i64>(state.readbackPhase);
	object["readbackFenceCommandCount"] = static_cast<i64>(state.readbackFenceCommandCount);
	object["readbackX"] = static_cast<i64>(state.readbackX);
	object["readbackY"] = static_cast<i64>(state.readbackY);
	object["readbackWidth"] = static_cast<i64>(state.readbackWidth);
	object["readbackHeight"] = static_cast<i64>(state.readbackHeight);
	object["readbackPixelCursor"] = static_cast<i64>(state.readbackPixelCursor);
	object["readbackPixelBytes"] = BinBinary(state.readbackPixelBytes);
	return BinValue(std::move(object));
}

GxGpuCommandBufferState decodeGxGpuCommandBufferState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuCommandBufferState state;
	state.commandCount = requireBoundedU32(requireField(object, "commandCount", label), "machine.gxGpu.commandBuffer.commandCount", 0u, static_cast<u32>(GX_GPU_COMMAND_CAPACITY));
	state.presentCommandCount = requireBoundedU32(requireField(object, "presentCommandCount", label), "machine.gxGpu.commandBuffer.presentCommandCount", 0u, static_cast<u32>(state.commandCount));
	state.wordCount = requireBoundedU32(requireField(object, "wordCount", label), "machine.gxGpu.commandBuffer.wordCount", 0u, static_cast<u32>(GX_GPU_COMMAND_WORD_CAPACITY));
	state.commandKind = decodeU8VectorWithLength(requireField(object, "commandKind", label), "machine.gxGpu.commandBuffer.commandKind", state.commandCount);
	state.commandOpcode = decodeU8VectorWithLength(requireField(object, "commandOpcode", label), "machine.gxGpu.commandBuffer.commandOpcode", state.commandCount);
	state.commandWordStart = decodeU32VectorWithLength(requireField(object, "commandWordStart", label), "machine.gxGpu.commandBuffer.commandWordStart", state.commandCount);
	state.commandWordCount = decodeU32VectorWithLength(requireField(object, "commandWordCount", label), "machine.gxGpu.commandBuffer.commandWordCount", state.commandCount);
	state.commandDrawModeWord = decodeU32VectorWithLength(requireField(object, "commandDrawModeWord", label), "machine.gxGpu.commandBuffer.commandDrawModeWord", state.commandCount);
	state.commandTextureWindowWord = decodeU32VectorWithLength(requireField(object, "commandTextureWindowWord", label), "machine.gxGpu.commandBuffer.commandTextureWindowWord", state.commandCount);
	state.commandDrawingAreaTopLeftWord = decodeU32VectorWithLength(requireField(object, "commandDrawingAreaTopLeftWord", label), "machine.gxGpu.commandBuffer.commandDrawingAreaTopLeftWord", state.commandCount);
	state.commandDrawingAreaBottomRightWord = decodeU32VectorWithLength(requireField(object, "commandDrawingAreaBottomRightWord", label), "machine.gxGpu.commandBuffer.commandDrawingAreaBottomRightWord", state.commandCount);
	state.commandDrawingOffsetWord = decodeU32VectorWithLength(requireField(object, "commandDrawingOffsetWord", label), "machine.gxGpu.commandBuffer.commandDrawingOffsetWord", state.commandCount);
	state.commandMaskBitModeWord = decodeU32VectorWithLength(requireField(object, "commandMaskBitModeWord", label), "machine.gxGpu.commandBuffer.commandMaskBitModeWord", state.commandCount);
	state.commandInterlacedRenderWord = decodeU8VectorWithLength(requireField(object, "commandInterlacedRenderWord", label), "machine.gxGpu.commandBuffer.commandInterlacedRenderWord", state.commandCount);
	state.words = decodeU32VectorWithLength(requireField(object, "words", label), "machine.gxGpu.commandBuffer.words", state.wordCount);
	state.readbackPhase = static_cast<u8>(requireBoundedU32(requireField(object, "readbackPhase", label), "machine.gxGpu.commandBuffer.readbackPhase", 0u, GX_GPU_READBACK_READY));
	if (state.readbackPhase == GX_GPU_READBACK_SUBMITTED) {
		throw BMSX_RUNTIME_ERROR("machine.gxGpu.commandBuffer.readbackPhase cannot contain the backend-submitted phase.");
	}
	state.readbackFenceCommandCount = requireBoundedU32(requireField(object, "readbackFenceCommandCount", label), "machine.gxGpu.commandBuffer.readbackFenceCommandCount", 0u, static_cast<u32>(state.commandCount));
	state.readbackX = requireBoundedU32(requireField(object, "readbackX", label), "machine.gxGpu.commandBuffer.readbackX", 0u, GX_GPU_VRAM_WIDTH - 1u);
	state.readbackY = requireBoundedU32(requireField(object, "readbackY", label), "machine.gxGpu.commandBuffer.readbackY", 0u, GX_GPU_VRAM_HEIGHT - 1u);
	state.readbackWidth = requireBoundedU32(requireField(object, "readbackWidth", label), "machine.gxGpu.commandBuffer.readbackWidth", 0u, GX_GPU_VRAM_WIDTH);
	state.readbackHeight = requireBoundedU32(requireField(object, "readbackHeight", label), "machine.gxGpu.commandBuffer.readbackHeight", 0u, GX_GPU_VRAM_HEIGHT);
	const size_t readbackPixelCount = static_cast<size_t>(state.readbackWidth) * static_cast<size_t>(state.readbackHeight);
	state.readbackPixelCursor = requireBoundedU32(requireField(object, "readbackPixelCursor", label), "machine.gxGpu.commandBuffer.readbackPixelCursor", 0u, static_cast<u32>(readbackPixelCount));
	state.readbackPixelBytes = requireBinaryWithLength(requireField(object, "readbackPixelBytes", label), "machine.gxGpu.commandBuffer.readbackPixelBytes", state.readbackPhase == GX_GPU_READBACK_READY ? readbackPixelCount * 2u : 0u);
	return state;
}

BinValue encodeGxGpuState(const GxGpuState& state) {
	BinObject object;
	object["gp0Word"] = static_cast<i64>(state.gp0Word);
	object["gp1Word"] = static_cast<i64>(state.gp1Word);
	object["displayModeWord"] = static_cast<i64>(state.displayModeWord);
	object["statusWord"] = static_cast<i64>(state.statusWord);
	object["gp0CommandWordCount"] = static_cast<i64>(state.gp0CommandWordCount);
	object["gp0CommandTargetWordCount"] = static_cast<i64>(state.gp0CommandTargetWordCount);
	object["gp0CommandWords"] = encodeVector(state.gp0CommandWords, encodeScalar<i64, u32>);
	object["gp0ImageLoadWordsRemaining"] = static_cast<i64>(state.gp0ImageLoadWordsRemaining);
	object["gp0ImageLoadCommandWordStart"] = static_cast<i64>(state.gp0ImageLoadCommandWordStart);
	object["gp0ImageLoadCommandWordCount"] = static_cast<i64>(state.gp0ImageLoadCommandWordCount);
	object["gp0ImageLoadCommandOpcode"] = static_cast<i64>(state.gp0ImageLoadCommandOpcode);
	object["gp0PolylineWordsPerVertex"] = static_cast<i64>(state.gp0PolylineWordsPerVertex);
	object["gp0PolylinePayloadPhase"] = static_cast<i64>(state.gp0PolylinePayloadPhase);
	object["gp0PolylineCommandWordStart"] = static_cast<i64>(state.gp0PolylineCommandWordStart);
	object["gp0PolylineCommandWordCount"] = static_cast<i64>(state.gp0PolylineCommandWordCount);
	object["gp0PolylineCommandOpcode"] = static_cast<i64>(state.gp0PolylineCommandOpcode);
	object["gpuReadWord"] = static_cast<i64>(state.gpuReadWord);
	object["drawModeWord"] = static_cast<i64>(state.drawModeWord);
	object["textureWindowWord"] = static_cast<i64>(state.textureWindowWord);
	object["drawingAreaTopLeftWord"] = static_cast<i64>(state.drawingAreaTopLeftWord);
	object["drawingAreaBottomRightWord"] = static_cast<i64>(state.drawingAreaBottomRightWord);
	object["drawingOffsetWord"] = static_cast<i64>(state.drawingOffsetWord);
	object["maskBitModeWord"] = static_cast<i64>(state.maskBitModeWord);
	object["displayStartWord"] = static_cast<i64>(state.displayStartWord);
	object["horizontalDisplayRangeWord"] = static_cast<i64>(state.horizontalDisplayRangeWord);
	object["verticalDisplayRangeWord"] = static_cast<i64>(state.verticalDisplayRangeWord);
	object["textureDisableAllowedWord"] = static_cast<i64>(state.textureDisableAllowedWord);
	object["scanoutInterlacedField"] = static_cast<i64>(state.scanoutInterlacedField);
	object["scanoutInterlacedDisplayField"] = static_cast<i64>(state.scanoutInterlacedDisplayField);
	object["scanoutActiveLineLsb"] = static_cast<i64>(state.scanoutActiveLineLsb);
	object["presentStatusWord"] = static_cast<i64>(state.presentStatusWord);
	object["presentDisplayModeWord"] = static_cast<i64>(state.presentDisplayModeWord);
	object["presentDisplayStartWord"] = static_cast<i64>(state.presentDisplayStartWord);
	object["presentHorizontalDisplayRangeWord"] = static_cast<i64>(state.presentHorizontalDisplayRangeWord);
	object["presentVerticalDisplayRangeWord"] = static_cast<i64>(state.presentVerticalDisplayRangeWord);
	object["commandBuffer"] = encodeGxGpuCommandBufferState(state.commandBuffer);
	return BinValue(std::move(object));
}

GxGpuState decodeGxGpuState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuState state;
	state.gp0Word = requireU32(requireField(object, "gp0Word", label), "machine.gxGpu.gp0Word");
	state.gp1Word = requireU32(requireField(object, "gp1Word", label), "machine.gxGpu.gp1Word");
	state.displayModeWord = requireU32(requireField(object, "displayModeWord", label), "machine.gxGpu.displayModeWord");
	state.statusWord = requireU32(requireField(object, "statusWord", label), "machine.gxGpu.statusWord");
	state.gp0CommandWordCount = requireBoundedU32(requireField(object, "gp0CommandWordCount", label), "machine.gxGpu.gp0CommandWordCount", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0CommandTargetWordCount = requireBoundedU32(requireField(object, "gp0CommandTargetWordCount", label), "machine.gxGpu.gp0CommandTargetWordCount", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0CommandWords = decodeU32VectorWithLength(requireField(object, "gp0CommandWords", label), "machine.gxGpu.gp0CommandWords", state.gp0CommandWordCount);
	state.gp0ImageLoadWordsRemaining = requireBoundedU32(requireField(object, "gp0ImageLoadWordsRemaining", label), "machine.gxGpu.gp0ImageLoadWordsRemaining", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandWordStart = requireBoundedU32(requireField(object, "gp0ImageLoadCommandWordStart", label), "machine.gxGpu.gp0ImageLoadCommandWordStart", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandWordCount = requireBoundedU32(requireField(object, "gp0ImageLoadCommandWordCount", label), "machine.gxGpu.gp0ImageLoadCommandWordCount", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandOpcode = static_cast<u8>(requireBoundedU32(requireField(object, "gp0ImageLoadCommandOpcode", label), "machine.gxGpu.gp0ImageLoadCommandOpcode", 0u, 0xffu));
	state.gp0PolylineWordsPerVertex = requireBoundedU32(requireField(object, "gp0PolylineWordsPerVertex", label), "machine.gxGpu.gp0PolylineWordsPerVertex", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0PolylinePayloadPhase = requireBoundedU32(requireField(object, "gp0PolylinePayloadPhase", label), "machine.gxGpu.gp0PolylinePayloadPhase", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0PolylineCommandWordStart = requireBoundedU32(requireField(object, "gp0PolylineCommandWordStart", label), "machine.gxGpu.gp0PolylineCommandWordStart", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0PolylineCommandWordCount = requireBoundedU32(requireField(object, "gp0PolylineCommandWordCount", label), "machine.gxGpu.gp0PolylineCommandWordCount", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0PolylineCommandOpcode = static_cast<u8>(requireBoundedU32(requireField(object, "gp0PolylineCommandOpcode", label), "machine.gxGpu.gp0PolylineCommandOpcode", 0u, 0xffu));
	state.gpuReadWord = requireU32(requireField(object, "gpuReadWord", label), "machine.gxGpu.gpuReadWord");
	state.drawModeWord = requireU32(requireField(object, "drawModeWord", label), "machine.gxGpu.drawModeWord");
	state.textureWindowWord = requireU32(requireField(object, "textureWindowWord", label), "machine.gxGpu.textureWindowWord");
	state.drawingAreaTopLeftWord = requireU32(requireField(object, "drawingAreaTopLeftWord", label), "machine.gxGpu.drawingAreaTopLeftWord");
	state.drawingAreaBottomRightWord = requireU32(requireField(object, "drawingAreaBottomRightWord", label), "machine.gxGpu.drawingAreaBottomRightWord");
	state.drawingOffsetWord = requireU32(requireField(object, "drawingOffsetWord", label), "machine.gxGpu.drawingOffsetWord");
	state.maskBitModeWord = requireU32(requireField(object, "maskBitModeWord", label), "machine.gxGpu.maskBitModeWord");
	state.displayStartWord = requireU32(requireField(object, "displayStartWord", label), "machine.gxGpu.displayStartWord");
	state.horizontalDisplayRangeWord = requireU32(requireField(object, "horizontalDisplayRangeWord", label), "machine.gxGpu.horizontalDisplayRangeWord");
	state.verticalDisplayRangeWord = requireU32(requireField(object, "verticalDisplayRangeWord", label), "machine.gxGpu.verticalDisplayRangeWord");
	state.textureDisableAllowedWord = requireU32(requireField(object, "textureDisableAllowedWord", label), "machine.gxGpu.textureDisableAllowedWord");
	state.scanoutInterlacedField = requireBoundedU32(requireField(object, "scanoutInterlacedField", label), "machine.gxGpu.scanoutInterlacedField", 0u, 1u);
	state.scanoutInterlacedDisplayField = requireBoundedU32(requireField(object, "scanoutInterlacedDisplayField", label), "machine.gxGpu.scanoutInterlacedDisplayField", 0u, 1u);
	state.scanoutActiveLineLsb = requireBoundedU32(requireField(object, "scanoutActiveLineLsb", label), "machine.gxGpu.scanoutActiveLineLsb", 0u, 1u);
	state.presentStatusWord = requireU32(requireField(object, "presentStatusWord", label), "machine.gxGpu.presentStatusWord");
	state.presentDisplayModeWord = requireU32(requireField(object, "presentDisplayModeWord", label), "machine.gxGpu.presentDisplayModeWord");
	state.presentDisplayStartWord = requireU32(requireField(object, "presentDisplayStartWord", label), "machine.gxGpu.presentDisplayStartWord");
	state.presentHorizontalDisplayRangeWord = requireU32(requireField(object, "presentHorizontalDisplayRangeWord", label), "machine.gxGpu.presentHorizontalDisplayRangeWord");
	state.presentVerticalDisplayRangeWord = requireU32(requireField(object, "presentVerticalDisplayRangeWord", label), "machine.gxGpu.presentVerticalDisplayRangeWord");
	state.commandBuffer = decodeGxGpuCommandBufferState(requireField(object, "commandBuffer", label), "machine.gxGpu.commandBuffer");
	return state;
}

BinValue encodeGxGpuSaveState(const GxGpuSaveState& state) {
	BinObject object = encodeGxGpuState(state).asObject();
	object["vramBytes"] = BinBinary(state.vramBytes);
	return BinValue(std::move(object));
}

GxGpuSaveState decodeGxGpuSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const GxGpuState base = decodeGxGpuState(value, label);
	GxGpuSaveState state;
	static_cast<GxGpuState&>(state) = base;
	state.vramBytes = requireBinaryWithLength(requireField(object, "vramBytes", label), "machine.gxGpu.vramBytes", GX_GPU_VRAM_BYTE_COUNT);
	return state;
}

BinValue encodeGxGteState(const GxGteState& state) {
	BinObject object;
	object["dataRegisterWords"] = encodeFixedArray(state.dataRegisterWords, encodeScalar<i64, u32>);
	object["controlRegisterWords"] = encodeFixedArray(state.controlRegisterWords, encodeScalar<i64, u32>);
	object["mac0"] = static_cast<i64>(state.mac0);
	object["mac1"] = static_cast<i64>(state.mac1);
	object["mac2"] = static_cast<i64>(state.mac2);
	object["mac3"] = static_cast<i64>(state.mac3);
	object["currentSf"] = static_cast<i64>(state.currentSf);
	object["lastCycles"] = static_cast<i64>(state.lastCycles);
	return BinValue(std::move(object));
}

GxGteState decodeGxGteState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGteState state;
	state.dataRegisterWords = decodeU32Array<GX_GTE_DATA_REGISTER_COUNT>(requireField(object, "dataRegisterWords", label), "machine.gxGte.dataRegisterWords");
	state.controlRegisterWords = decodeU32Array<GX_GTE_CONTROL_REGISTER_COUNT>(requireField(object, "controlRegisterWords", label), "machine.gxGte.controlRegisterWords");
	state.mac0 = requireI64(requireField(object, "mac0", label), "machine.gxGte.mac0");
	state.mac1 = requireI64(requireField(object, "mac1", label), "machine.gxGte.mac1");
	state.mac2 = requireI64(requireField(object, "mac2", label), "machine.gxGte.mac2");
	state.mac3 = requireI64(requireField(object, "mac3", label), "machine.gxGte.mac3");
	state.currentSf = requireU32(requireField(object, "currentSf", label), "machine.gxGte.currentSf");
	state.lastCycles = requireU32(requireField(object, "lastCycles", label), "machine.gxGte.lastCycles");
	return state;
}

BinValue encodeApuBiquadFilterState(const ApuBiquadFilterState& state) {
	BinObject object;
	object["enabled"] = BinValue(state.enabled);
	object["b0"] = encodeScalar<f64>(state.b0);
	object["b1"] = encodeScalar<f64>(state.b1);
	object["b2"] = encodeScalar<f64>(state.b2);
	object["a1"] = encodeScalar<f64>(state.a1);
	object["a2"] = encodeScalar<f64>(state.a2);
	object["l1"] = encodeScalar<f64>(state.l1);
	object["l2"] = encodeScalar<f64>(state.l2);
	object["r1"] = encodeScalar<f64>(state.r1);
	object["r2"] = encodeScalar<f64>(state.r2);
	return BinValue(std::move(object));
}

ApuBiquadFilterState decodeApuBiquadFilterState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuBiquadFilterState state;
	state.enabled = requireBool(requireField(object, "enabled", label), "machine.audio.output.voices.filter.enabled");
	state.b0 = static_cast<f32>(requireNumber(requireField(object, "b0", label), "machine.audio.output.voices.filter.b0"));
	state.b1 = static_cast<f32>(requireNumber(requireField(object, "b1", label), "machine.audio.output.voices.filter.b1"));
	state.b2 = static_cast<f32>(requireNumber(requireField(object, "b2", label), "machine.audio.output.voices.filter.b2"));
	state.a1 = static_cast<f32>(requireNumber(requireField(object, "a1", label), "machine.audio.output.voices.filter.a1"));
	state.a2 = static_cast<f32>(requireNumber(requireField(object, "a2", label), "machine.audio.output.voices.filter.a2"));
	state.l1 = static_cast<f32>(requireNumber(requireField(object, "l1", label), "machine.audio.output.voices.filter.l1"));
	state.l2 = static_cast<f32>(requireNumber(requireField(object, "l2", label), "machine.audio.output.voices.filter.l2"));
	state.r1 = static_cast<f32>(requireNumber(requireField(object, "r1", label), "machine.audio.output.voices.filter.r1"));
	state.r2 = static_cast<f32>(requireNumber(requireField(object, "r2", label), "machine.audio.output.voices.filter.r2"));
	return state;
}

BinValue encodeApuBadpDecoderState(const ApuBadpDecoderSaveState& state) {
	BinObject object;
	object["predictors"] = encodeFixedArray(state.predictors, encodeScalar<f64, i32>);
	object["stepIndices"] = encodeFixedArray(state.stepIndices, encodeScalar<f64, i32>);
	object["nextFrame"] = encodeScalar<f64>(state.nextFrame);
	object["blockEnd"] = encodeScalar<f64>(state.blockEnd);
	object["blockFrames"] = encodeScalar<f64>(state.blockFrames);
	object["blockFrameIndex"] = encodeScalar<f64>(state.blockFrameIndex);
	object["payloadOffset"] = encodeScalar<f64>(state.payloadOffset);
	object["nibbleCursor"] = encodeScalar<f64>(state.nibbleCursor);
	object["decodedFrame"] = encodeScalar<f64>(state.decodedFrame);
	object["decodedLeft"] = encodeScalar<f64>(state.decodedLeft);
	object["decodedRight"] = encodeScalar<f64>(state.decodedRight);
	return BinValue(std::move(object));
}

ApuBadpDecoderSaveState decodeApuBadpDecoderState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuBadpDecoderSaveState state;
	state.predictors = decodeI32Array<2>(requireField(object, "predictors", label), "machine.audio.output.voices.badp.predictors");
	state.stepIndices = decodeI32Array<2>(requireField(object, "stepIndices", label), "machine.audio.output.voices.badp.stepIndices");
	state.nextFrame = requireU32(requireField(object, "nextFrame", label), "machine.audio.output.voices.badp.nextFrame");
	state.blockEnd = requireU32(requireField(object, "blockEnd", label), "machine.audio.output.voices.badp.blockEnd");
	state.blockFrames = requireU32(requireField(object, "blockFrames", label), "machine.audio.output.voices.badp.blockFrames");
	state.blockFrameIndex = requireU32(requireField(object, "blockFrameIndex", label), "machine.audio.output.voices.badp.blockFrameIndex");
	state.payloadOffset = requireU32(requireField(object, "payloadOffset", label), "machine.audio.output.voices.badp.payloadOffset");
	state.nibbleCursor = requireU32(requireField(object, "nibbleCursor", label), "machine.audio.output.voices.badp.nibbleCursor");
	state.decodedFrame = requireI64(requireField(object, "decodedFrame", label), "machine.audio.output.voices.badp.decodedFrame");
	state.decodedLeft = requireI32(requireField(object, "decodedLeft", label), "machine.audio.output.voices.badp.decodedLeft");
	state.decodedRight = requireI32(requireField(object, "decodedRight", label), "machine.audio.output.voices.badp.decodedRight");
	return state;
}

BinValue encodeApuOutputVoiceState(const ApuOutputVoiceState& state) {
	BinObject object;
	object["slot"] = encodeScalar<f64>(state.slot);
	object["position"] = encodeScalar<f64>(state.position);
	object["step"] = encodeScalar<f64>(state.step);
	object["gain"] = encodeScalar<f64>(state.gain);
	object["targetGain"] = encodeScalar<f64>(state.targetGain);
	object["gainRampRemaining"] = encodeScalar<f64>(state.gainRampRemaining);
	object["stopAfter"] = encodeScalar<f64>(state.stopAfter);
	object["filterSampleRate"] = encodeScalar<f64>(state.filterSampleRate);
	object["filter"] = encodeApuBiquadFilterState(state.filter);
	object["badp"] = encodeApuBadpDecoderState(state.badp);
	return BinValue(std::move(object));
}

ApuOutputVoiceState decodeApuOutputVoiceState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuOutputVoiceState state;
	state.slot = requireBoundedU32(requireField(object, "slot", label), "machine.audio.output.voices.slot", 0u, APU_SLOT_COUNT - 1u);
	state.position = requireNumber(requireField(object, "position", label), "machine.audio.output.voices.position");
	state.step = requireNumber(requireField(object, "step", label), "machine.audio.output.voices.step");
	state.gain = static_cast<f32>(requireNumber(requireField(object, "gain", label), "machine.audio.output.voices.gain"));
	state.targetGain = static_cast<f32>(requireNumber(requireField(object, "targetGain", label), "machine.audio.output.voices.targetGain"));
	state.gainRampRemaining = requireNumber(requireField(object, "gainRampRemaining", label), "machine.audio.output.voices.gainRampRemaining");
	state.stopAfter = requireNumber(requireField(object, "stopAfter", label), "machine.audio.output.voices.stopAfter");
	state.filterSampleRate = requireI32(requireField(object, "filterSampleRate", label), "machine.audio.output.voices.filterSampleRate");
	state.filter = decodeApuBiquadFilterState(requireField(object, "filter", label), "machine.audio.output.voices.filter");
	state.badp = decodeApuBadpDecoderState(requireField(object, "badp", label), "machine.audio.output.voices.badp");
	return state;
}

ApuOutputState decodeApuOutputState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuOutputState state;
	state.voices = decodeVector<ApuOutputVoiceState>(
		requireField(object, "voices", label),
		"machine.audio.output.voices",
		[](const BinValue& entry, size_t) { return decodeApuOutputVoiceState(entry, "machine.audio.output.voices[]"); }
	);
	return state;
}

BinValue encodeApuCommandFifoState(const ApuCommandFifoState& state) {
	BinObject object;
	object["commands"] = encodeFixedArray(state.commands, encodeScalar<f64, u32>);
	object["registerWords"] = encodeFixedArray(state.registerWords, encodeScalar<f64, u32>);
	object["readIndex"] = encodeScalar<f64>(state.readIndex);
	object["writeIndex"] = encodeScalar<f64>(state.writeIndex);
	object["count"] = encodeScalar<f64>(state.count);
	return BinValue(std::move(object));
}

ApuCommandFifoState decodeApuCommandFifoState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuCommandFifoState state;
	state.commands = decodeU32Array<APU_COMMAND_FIFO_CAPACITY>(requireField(object, "commands", label), "machine.audio.commandFifo.commands");
	state.registerWords = decodeU32Array<APU_COMMAND_FIFO_REGISTER_WORD_COUNT>(requireField(object, "registerWords", label), "machine.audio.commandFifo.registerWords");
	state.readIndex = requireBoundedU32(requireField(object, "readIndex", label), "machine.audio.commandFifo.readIndex", 0, APU_COMMAND_FIFO_CAPACITY - 1u);
	state.writeIndex = requireBoundedU32(requireField(object, "writeIndex", label), "machine.audio.commandFifo.writeIndex", 0, APU_COMMAND_FIFO_CAPACITY - 1u);
	state.count = requireBoundedU32(requireField(object, "count", label), "machine.audio.commandFifo.count", 0, APU_COMMAND_FIFO_CAPACITY);
	return state;
}

BinValue encodeAudioControllerState(const AudioControllerState& state) {
	BinObject object;
	object["registerWords"] = encodeFixedArray(state.registerWords, encodeScalar<f64, u32>);
	object["commandFifo"] = encodeApuCommandFifoState(state.commandFifo);
	object["eventSequence"] = encodeScalar<f64>(state.eventSequence);
	object["eventKind"] = encodeScalar<f64>(state.eventKind);
	object["eventSlot"] = encodeScalar<f64>(state.eventSlot);
	object["eventSourceAddr"] = encodeScalar<f64>(state.eventSourceAddr);
	object["slotPhases"] = encodeFixedArray(state.slotPhases, encodeScalar<f64, u32>);
	object["slotRegisterWords"] = encodeFixedArray(state.slotRegisterWords, encodeScalar<f64, u32>);
	object["slotSourceBytes"] = encodeFixedArray(state.slotSourceBytes, [](const std::vector<u8>& bytes) {
		return BinValue(BinBinary(bytes.begin(), bytes.end()));
	});
	object["slotPlaybackCursorQ16"] = encodeFixedArray(state.slotPlaybackCursorQ16, encodeScalar<f64, i64>);
	object["slotFadeSamplesRemaining"] = encodeFixedArray(state.slotFadeSamplesRemaining, encodeScalar<f64, u32>);
	object["slotFadeSamplesTotal"] = encodeFixedArray(state.slotFadeSamplesTotal, encodeScalar<f64, u32>);
	BinObject output;
	output["voices"] = encodeVector<ApuOutputVoiceState>(state.output.voices, encodeApuOutputVoiceState);
	object["output"] = BinValue(std::move(output));
	object["sampleCarry"] = encodeScalar<f64>(state.sampleCarry);
	object["availableSamples"] = encodeScalar<f64>(state.availableSamples);
	object["apuStatus"] = encodeScalar<f64>(state.apuStatus);
	object["apuFaultCode"] = encodeScalar<f64>(state.apuFaultCode);
	object["apuFaultDetail"] = encodeScalar<f64>(state.apuFaultDetail);
	return BinValue(std::move(object));
}

AudioControllerState decodeAudioControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	AudioControllerState state;
	state.registerWords = decodeU32Array<APU_PARAMETER_REGISTER_COUNT>(requireField(object, "registerWords", label), "machine.audio.registerWords");
	state.commandFifo = decodeApuCommandFifoState(requireField(object, "commandFifo", label), "machine.audio.commandFifo");
	state.eventSequence = requireU32(requireField(object, "eventSequence", label), "machine.audio.eventSequence");
	state.eventKind = requireU32(requireField(object, "eventKind", label), "machine.audio.eventKind");
	state.eventSlot = requireU32(requireField(object, "eventSlot", label), "machine.audio.eventSlot");
	state.eventSourceAddr = requireU32(requireField(object, "eventSourceAddr", label), "machine.audio.eventSourceAddr");
	state.slotPhases = decodeU32Array<APU_SLOT_COUNT>(requireField(object, "slotPhases", label), "machine.audio.slotPhases");
	state.slotRegisterWords = decodeU32Array<APU_SLOT_REGISTER_WORD_COUNT>(requireField(object, "slotRegisterWords", label), "machine.audio.slotRegisterWords");
	const BinArray& slotSourceBytes = requireArray(requireField(object, "slotSourceBytes", label), "machine.audio.slotSourceBytes");
	if (slotSourceBytes.size() != APU_SLOT_COUNT) {
		throw BMSX_RUNTIME_ERROR("machine.audio.slotSourceBytes must contain APU_SLOT_COUNT binary entries.");
	}
	for (size_t slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		state.slotSourceBytes[slot] = requireBinary(slotSourceBytes[slot], "machine.audio.slotSourceBytes[]");
	}
	state.slotPlaybackCursorQ16 = decodeI64Array<APU_SLOT_COUNT>(requireField(object, "slotPlaybackCursorQ16", label), "machine.audio.slotPlaybackCursorQ16");
	state.slotFadeSamplesRemaining = decodeU32Array<APU_SLOT_COUNT>(requireField(object, "slotFadeSamplesRemaining", label), "machine.audio.slotFadeSamplesRemaining");
	state.slotFadeSamplesTotal = decodeU32Array<APU_SLOT_COUNT>(requireField(object, "slotFadeSamplesTotal", label), "machine.audio.slotFadeSamplesTotal");
	state.output = decodeApuOutputState(requireField(object, "output", label), "machine.audio.output");
	state.sampleCarry = requireI64(requireField(object, "sampleCarry", label), "machine.audio.sampleCarry");
	state.availableSamples = requireI64(requireField(object, "availableSamples", label), "machine.audio.availableSamples");
	state.apuStatus = requireU32(requireField(object, "apuStatus", label), "machine.audio.apuStatus");
	state.apuFaultCode = requireU32(requireField(object, "apuFaultCode", label), "machine.audio.apuFaultCode");
	state.apuFaultDetail = requireU32(requireField(object, "apuFaultDetail", label), "machine.audio.apuFaultDetail");
	return state;
}

BinValue encodeDmaJobState(const DmaJobState& state) {
	BinObject object;
	object["src"] = encodeScalar<f64>(state.src);
	object["dst"] = encodeScalar<f64>(state.dst);
	object["remaining"] = encodeScalar<f64>(state.remaining);
	object["written"] = encodeScalar<f64>(state.written);
	object["clipped"] = BinValue(state.clipped);
	return BinValue(std::move(object));
}

DmaJobState decodeDmaJobState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	DmaJobState state;
	state.src = requireU32(requireField(object, "src", label), "machine.dma.queue.src");
	state.dst = requireU32(requireField(object, "dst", label), "machine.dma.queue.dst");
	state.remaining = requireU32(requireField(object, "remaining", label), "machine.dma.queue.remaining");
	state.written = requireU32(requireField(object, "written", label), "machine.dma.queue.written");
	state.clipped = requireBool(requireField(object, "clipped", label), "machine.dma.queue.clipped");
	return state;
}

BinValue encodeDmaControllerState(const DmaControllerState& state) {
	BinObject object;
	object["queue"] = encodeVector<DmaJobState>(state.queue, encodeDmaJobState);
	object["budget"] = encodeScalar<f64>(state.budget);
	object["carry"] = encodeScalar<f64>(state.carry);
	object["writtenValue"] = encodeScalar<f64>(state.writtenValue);
	object["writtenDirty"] = BinValue(state.writtenDirty);
	object["sourceRegisterWord"] = encodeScalar<f64>(state.sourceRegisterWord);
	object["destinationRegisterWord"] = encodeScalar<f64>(state.destinationRegisterWord);
	object["lengthRegisterWord"] = encodeScalar<f64>(state.lengthRegisterWord);
	object["controlRegisterWord"] = encodeScalar<f64>(state.controlRegisterWord);
	object["statusRegisterWord"] = encodeScalar<f64>(state.statusRegisterWord);
	object["writtenRegisterWord"] = encodeScalar<f64>(state.writtenRegisterWord);
	return BinValue(std::move(object));
}

DmaControllerState decodeDmaControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	DmaControllerState state;
	const BinArray& queue = requireArray(requireField(object, "queue", label), "machine.dma.queue");
	if (queue.size() > DMA_JOB_QUEUE_CAPACITY) {
		throw BMSX_RUNTIME_ERROR("machine.dma.queue exceeds the DMA FIFO capacity.");
	}
	state.queue.reserve(queue.size());
	for (const BinValue& entry : queue) {
		state.queue.push_back(decodeDmaJobState(entry, "machine.dma.queue[]"));
	}
	state.budget = requireI64(requireField(object, "budget", label), "machine.dma.budget");
	state.carry = requireI64(requireField(object, "carry", label), "machine.dma.carry");
	state.writtenValue = requireU32(requireField(object, "writtenValue", label), "machine.dma.writtenValue");
	state.writtenDirty = requireBool(requireField(object, "writtenDirty", label), "machine.dma.writtenDirty");
	state.sourceRegisterWord = requireU32(requireField(object, "sourceRegisterWord", label), "machine.dma.sourceRegisterWord");
	state.destinationRegisterWord = requireU32(requireField(object, "destinationRegisterWord", label), "machine.dma.destinationRegisterWord");
	state.lengthRegisterWord = requireU32(requireField(object, "lengthRegisterWord", label), "machine.dma.lengthRegisterWord");
	state.controlRegisterWord = requireU32(requireField(object, "controlRegisterWord", label), "machine.dma.controlRegisterWord");
	state.statusRegisterWord = requireU32(requireField(object, "statusRegisterWord", label), "machine.dma.statusRegisterWord");
	state.writtenRegisterWord = requireU32(requireField(object, "writtenRegisterWord", label), "machine.dma.writtenRegisterWord");
	return state;
}

BinValue encodeMachineSaveState(const MachineSaveState& state) {
	BinObject object;
	object["memory"] = encodeMemorySaveState(state.memory);
	object["dma"] = encodeDmaControllerState(state.dma);
	object["geometry"] = encodeGeometryControllerState(state.geometry);
	object["gxGpu"] = encodeGxGpuSaveState(state.gxGpu);
	object["gxGte"] = encodeGxGteState(state.gxGte);
	object["irq"] = encodeIrqControllerState(state.irq);
	object["audio"] = encodeAudioControllerState(state.audio);
	object["stringPool"] = encodeStringPoolState(state.stringPool);
	object["input"] = encodeInputControllerState(state.input);
	return BinValue(std::move(object));
}

MachineSaveState decodeMachineSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MachineSaveState state;
	state.memory = decodeMemorySaveState(requireField(object, "memory", label), "machineState.machine.memory");
	state.dma = decodeDmaControllerState(requireField(object, "dma", label), "machineState.machine.dma");
	state.geometry = decodeGeometryControllerState(requireField(object, "geometry", label), "machineState.machine.geometry");
	state.gxGpu = decodeGxGpuSaveState(requireField(object, "gxGpu", label), "machineState.machine.gxGpu");
	state.gxGte = decodeGxGteState(requireField(object, "gxGte", label), "machineState.machine.gxGte");
	state.irq = decodeIrqControllerState(requireField(object, "irq", label), "machineState.machine.irq");
	state.audio = decodeAudioControllerState(requireField(object, "audio", label), "machineState.machine.audio");
	state.stringPool = decodeStringPoolState(requireField(object, "stringPool", label), "machineState.machine.stringPool");
	state.input = decodeInputControllerState(requireField(object, "input", label), "machineState.machine.input");
	return state;
}

BinValue encodeRuntimeSaveMachineState(const RuntimeSaveMachineState& state) {
	BinObject object;
	object["psxGpuDisplayModeWord"] = static_cast<i64>(state.psxGpuDisplayModeWord);
	object["machine"] = encodeMachineSaveState(state.machine);
	object["frameScheduler"] = encodeFrameSchedulerState(state.frameScheduler);
	object["vblank"] = encodeRuntimeVblankState(state.vblank);
	return BinValue(std::move(object));
}

RuntimeSaveMachineState decodeRuntimeSaveMachineState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveMachineState state;
	state.psxGpuDisplayModeWord = requireU32(requireField(object, "psxGpuDisplayModeWord", label), "machineState.psxGpuDisplayModeWord");
	state.machine = decodeMachineSaveState(requireField(object, "machine", label), "machineState.machine");
	state.frameScheduler = decodeFrameSchedulerState(requireField(object, "frameScheduler", label), "machineState.frameScheduler");
	state.vblank = decodeRuntimeVblankState(requireField(object, "vblank", label), "machineState.vblank");
	return state;
}

BinValue encodeCpuValueState(const CpuValueState& state) {
	BinObject object;
	switch (state.tag) {
		case CpuValueStateTag::Nil:
			object["tag"] = "nil";
			break;
		case CpuValueStateTag::False:
			object["tag"] = "false";
			break;
		case CpuValueStateTag::True:
			object["tag"] = "true";
			break;
		case CpuValueStateTag::Number:
			object["tag"] = "number";
			object["value"] = state.numberValue;
			break;
		case CpuValueStateTag::String:
			object["tag"] = "string";
			object["id"] = static_cast<i64>(state.stringId);
			break;
		case CpuValueStateTag::Builtin:
			object["tag"] = "builtin";
			object["id"] = static_cast<i64>(state.builtinId);
			break;
		case CpuValueStateTag::Ref:
			object["tag"] = "ref";
			object["id"] = static_cast<i64>(state.refId);
			break;
	}
	return BinValue(std::move(object));
}

CpuValueState decodeCpuValueState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const std::string tag = requireString(requireField(object, "tag", label), "cpuValueState.tag");
	CpuValueState state;
	if (tag == "nil") {
		state.tag = CpuValueStateTag::Nil;
		return state;
	}
	if (tag == "false") {
		state.tag = CpuValueStateTag::False;
		return state;
	}
	if (tag == "true") {
		state.tag = CpuValueStateTag::True;
		return state;
	}
	if (tag == "number") {
		state.tag = CpuValueStateTag::Number;
		state.numberValue = requireNumber(requireField(object, "value", label), "cpuValueState.value");
		return state;
	}
	if (tag == "string") {
		state.tag = CpuValueStateTag::String;
		state.stringId = requireU32(requireField(object, "id", label), "cpuValueState.id");
		return state;
	}
	if (tag == "builtin") {
		state.tag = CpuValueStateTag::Builtin;
		state.builtinId = static_cast<BuiltinFunctionId>(requireU32(requireField(object, "id", label), "cpuValueState.id"));
		return state;
	}
	if (tag == "ref") {
		state.tag = CpuValueStateTag::Ref;
		state.refId = requireI32(requireField(object, "id", label), "cpuValueState.id");
		return state;
	}
	throw BMSX_RUNTIME_ERROR("cpuValueState.tag is invalid.");
}

BinValue encodeCpuObjectState(const CpuObjectState& state) {
	BinObject object;
	object["hashId"] = static_cast<i64>(state.hashId);
	switch (state.kind) {
		case CpuObjectState::Kind::Table:
			object["kind"] = "table";
			object["array"] = encodeVector(state.array, [](const CpuValueState& value) {
				return encodeCpuValueState(value);
			});
			object["arrayLength"] = static_cast<i64>(state.arrayLength);
			object["hash"] = encodeVector(state.hash, [](const CpuTableHashNodeSnapshot& node) {
				BinObject encoded;
				encoded["key"] = encodeCpuValueState(node.key);
				encoded["value"] = encodeCpuValueState(node.value);
				encoded["next"] = static_cast<i64>(node.next);
				return BinValue(std::move(encoded));
			});
			object["hashFree"] = static_cast<i64>(state.hashFree);
			object["metatable"] = encodeCpuValueState(state.metatable);
			break;
		case CpuObjectState::Kind::Closure:
			object["kind"] = "closure";
			object["protoIndex"] = static_cast<i64>(state.protoIndex);
			object["upvalues"] = encodeVector(state.upvalues, [](int index) {
				return BinValue(static_cast<i64>(index));
			});
			break;
		case CpuObjectState::Kind::Upvalue:
			object["kind"] = "upvalue";
			object["open"] = state.upvalueOpen;
			object["index"] = static_cast<i64>(state.upvalueIndex);
			object["frameIndex"] = static_cast<i64>(state.frameIndex);
			object["value"] = encodeCpuValueState(state.upvalueValue);
			break;
	}
	return BinValue(std::move(object));
}

CpuObjectState decodeCpuObjectState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const std::string kind = requireString(requireField(object, "kind", label), "cpuObjectState.kind");
	CpuObjectState state;
	if (kind == "table") {
		state.kind = CpuObjectState::Kind::Table;
		state.hashId = requireU32(requireField(object, "hashId", label), "cpuObjectState.hashId");
		state.array = decodeVector<CpuValueState>(requireField(object, "array", label), "cpuObjectState.array",
			[](const BinValue& entryValue, size_t) {
				return decodeCpuValueState(entryValue, "cpuObjectState.array[]");
			});
		state.arrayLength = static_cast<size_t>(requireU32(requireField(object, "arrayLength", label), "cpuObjectState.arrayLength"));
		state.hash = decodeVector<CpuTableHashNodeSnapshot>(requireField(object, "hash", label), "cpuObjectState.hash",
			[](const BinValue& entryValue, size_t) {
				const BinObject& entry = requireObject(entryValue, "cpuObjectState.hash[]");
				CpuTableHashNodeSnapshot node;
				node.key = decodeCpuValueState(requireField(entry, "key", "cpuObjectState.hash[]"), "cpuObjectState.hash[].key");
				node.value = decodeCpuValueState(requireField(entry, "value", "cpuObjectState.hash[]"), "cpuObjectState.hash[].value");
				node.next = requireI32(requireField(entry, "next", "cpuObjectState.hash[]"), "cpuObjectState.hash[].next");
				return node;
			});
		state.hashFree = requireI32(requireField(object, "hashFree", label), "cpuObjectState.hashFree");
		state.metatable = decodeCpuValueState(requireField(object, "metatable", label), "cpuObjectState.metatable");
		return state;
	}
	if (kind == "closure") {
		state.kind = CpuObjectState::Kind::Closure;
		state.hashId = requireU32(requireField(object, "hashId", label), "cpuObjectState.hashId");
		state.protoIndex = requireI32(requireField(object, "protoIndex", label), "cpuObjectState.protoIndex");
		state.upvalues = decodeVector<int>(requireField(object, "upvalues", label), "cpuObjectState.upvalues",
			[](const BinValue& entryValue, size_t) {
				return requireI32(entryValue, "cpuObjectState.upvalues[]");
			});
		return state;
	}
	if (kind == "upvalue") {
		state.kind = CpuObjectState::Kind::Upvalue;
		state.hashId = requireU32(requireField(object, "hashId", label), "cpuObjectState.hashId");
		state.upvalueOpen = requireBool(requireField(object, "open", label), "cpuObjectState.open");
		state.upvalueIndex = requireI32(requireField(object, "index", label), "cpuObjectState.index");
		state.frameIndex = requireI32(requireField(object, "frameIndex", label), "cpuObjectState.frameIndex");
		state.upvalueValue = decodeCpuValueState(requireField(object, "value", label), "cpuObjectState.value");
		return state;
	}
	throw BMSX_RUNTIME_ERROR("cpuObjectState.kind is invalid.");
}

BinValue encodeCpuFrameState(const CpuFrameState& state) {
	BinObject object;
	object["protoIndex"] = static_cast<i64>(state.protoIndex);
	object["pc"] = static_cast<i64>(state.pc);
	object["closureRef"] = static_cast<i64>(state.closureRef);
	object["registers"] = encodeVector(state.registers, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["varargs"] = encodeVector(state.varargs, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["returnBase"] = static_cast<i64>(state.returnBase);
	object["returnCount"] = static_cast<i64>(state.returnCount);
	object["top"] = static_cast<i64>(state.top);
	object["captureReturns"] = state.captureReturns;
	object["callSitePc"] = static_cast<i64>(state.callSitePc);
	object["isInterruptFrame"] = state.isInterruptFrame;
	object["savedMaskableEnabled"] = state.savedMaskableEnabled;
	return BinValue(std::move(object));
}

CpuFrameState decodeCpuFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuFrameState state;
	state.protoIndex = requireI32(requireField(object, "protoIndex", label), "cpuFrameState.protoIndex");
	state.pc = requireI32(requireField(object, "pc", label), "cpuFrameState.pc");
	state.closureRef = requireI32(requireField(object, "closureRef", label), "cpuFrameState.closureRef");
	state.registers = decodeVector<CpuValueState>(requireField(object, "registers", label), "cpuFrameState.registers",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuFrameState.registers[]");
		});
	state.varargs = decodeVector<CpuValueState>(requireField(object, "varargs", label), "cpuFrameState.varargs",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuFrameState.varargs[]");
		});
	state.returnBase = requireI32(requireField(object, "returnBase", label), "cpuFrameState.returnBase");
	state.returnCount = requireI32(requireField(object, "returnCount", label), "cpuFrameState.returnCount");
	state.top = requireI32(requireField(object, "top", label), "cpuFrameState.top");
	state.captureReturns = requireBool(requireField(object, "captureReturns", label), "cpuFrameState.captureReturns");
	state.callSitePc = requireI32(requireField(object, "callSitePc", label), "cpuFrameState.callSitePc");
	state.isInterruptFrame = requireBool(requireField(object, "isInterruptFrame", label), "cpuFrameState.isInterruptFrame");
	state.savedMaskableEnabled = requireBool(requireField(object, "savedMaskableEnabled", label), "cpuFrameState.savedMaskableEnabled");
	return state;
}

BinValue encodeCpuRootValueState(const CpuRootValueState& state) {
	BinObject object;
	object["name"] = state.name;
	object["value"] = encodeCpuValueState(state.value);
	return BinValue(std::move(object));
}

CpuRootValueState decodeCpuRootValueState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuRootValueState state;
	state.name = requireString(requireField(object, "name", label), "cpuRootValueState.name");
	state.value = decodeCpuValueState(requireField(object, "value", label), "cpuRootValueState.value");
	return state;
}

BinValue encodeCpuRuntimeState(const CpuRuntimeState& state) {
	BinObject object;
	object["globals"] = encodeVector(state.globals, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["moduleCache"] = encodeVector(state.moduleCache, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["frames"] = encodeVector(state.frames, [](const CpuFrameState& value) {
		return encodeCpuFrameState(value);
	});
	object["lastReturnValues"] = encodeVector(state.lastReturnValues, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["objects"] = encodeVector(state.objects, [](const CpuObjectState& value) {
		return encodeCpuObjectState(value);
	});
	object["openUpvalues"] = encodeVector(state.openUpvalues, [](int value) {
		return BinValue(static_cast<i64>(value));
	});
	object["lastPc"] = static_cast<i64>(state.lastPc);
	object["lastInstruction"] = static_cast<i64>(state.lastInstruction);
	object["instructionBudgetRemaining"] = static_cast<i64>(state.instructionBudgetRemaining);
	object["haltedUntilIrq"] = state.haltedUntilIrq;
	object["maskableInterruptsEnabled"] = state.maskableInterruptsEnabled;
	object["maskableInterruptsRestoreEnabled"] = state.maskableInterruptsRestoreEnabled;
	object["nonMaskableInterruptPending"] = state.nonMaskableInterruptPending;
	object["yieldRequested"] = state.yieldRequested;
	return BinValue(std::move(object));
}

CpuRuntimeState decodeCpuRuntimeState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuRuntimeState state;
	state.globals = decodeVector<CpuRootValueState>(requireField(object, "globals", label), "cpuState.globals",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.globals[]");
		});
	state.moduleCache = decodeVector<CpuRootValueState>(requireField(object, "moduleCache", label), "cpuState.moduleCache",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.moduleCache[]");
		});
	state.frames = decodeVector<CpuFrameState>(requireField(object, "frames", label), "cpuState.frames",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuFrameState(entryValue, "cpuState.frames[]");
		});
	state.lastReturnValues = decodeVector<CpuValueState>(requireField(object, "lastReturnValues", label), "cpuState.lastReturnValues",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuState.lastReturnValues[]");
		});
	state.objects = decodeVector<CpuObjectState>(requireField(object, "objects", label), "cpuState.objects",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuObjectState(entryValue, "cpuState.objects[]");
		});
	state.openUpvalues = decodeVector<int>(requireField(object, "openUpvalues", label), "cpuState.openUpvalues",
		[](const BinValue& entryValue, size_t) {
			return requireI32(entryValue, "cpuState.openUpvalues[]");
		});
	state.lastPc = requireI32(requireField(object, "lastPc", label), "cpuState.lastPc");
	state.lastInstruction = requireU32(requireField(object, "lastInstruction", label), "cpuState.lastInstruction");
	state.instructionBudgetRemaining = requireI32(requireField(object, "instructionBudgetRemaining", label), "cpuState.instructionBudgetRemaining");
	state.haltedUntilIrq = requireBool(requireField(object, "haltedUntilIrq", label), "cpuState.haltedUntilIrq");
	state.maskableInterruptsEnabled = requireBool(requireField(object, "maskableInterruptsEnabled", label), "cpuState.maskableInterruptsEnabled");
	state.maskableInterruptsRestoreEnabled = requireBool(requireField(object, "maskableInterruptsRestoreEnabled", label), "cpuState.maskableInterruptsRestoreEnabled");
	state.nonMaskableInterruptPending = requireBool(requireField(object, "nonMaskableInterruptPending", label), "cpuState.nonMaskableInterruptPending");
	state.yieldRequested = requireBool(requireField(object, "yieldRequested", label), "cpuState.yieldRequested");
	return state;
}

BinValue encodeRuntimeSaveStateValue(const RuntimeSaveState& state) {
	BinObject object;
	object["machineState"] = encodeRuntimeSaveMachineState(state.machineState);
	object["cpuState"] = encodeCpuRuntimeState(state.cpuState);
	object["systemProgramActive"] = state.systemProgramActive;
	object["luaInitialized"] = state.luaInitialized;
	object["luaRuntimeFailed"] = state.luaRuntimeFailed;
	object["pendingEntryCall"] = state.pendingEntryCall;
	return BinValue(std::move(object));
}

RuntimeSaveState decodeRuntimeSaveStateValue(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveState state;
	state.machineState = decodeRuntimeSaveMachineState(requireField(object, "machineState", label), "runtimeSaveState.machineState");
	state.cpuState = decodeCpuRuntimeState(requireField(object, "cpuState", label), "runtimeSaveState.cpuState");
	state.systemProgramActive = requireBool(requireField(object, "systemProgramActive", label), "runtimeSaveState.systemProgramActive");
	state.luaInitialized = requireBool(requireField(object, "luaInitialized", label), "runtimeSaveState.luaInitialized");
	state.luaRuntimeFailed = requireBool(requireField(object, "luaRuntimeFailed", label), "runtimeSaveState.luaRuntimeFailed");
	state.pendingEntryCall = requireBool(requireField(object, "pendingEntryCall", label), "runtimeSaveState.pendingEntryCall");
	return state;
}

} // namespace

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state) {
	std::vector<u8> bytes = encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
	if (bytes.size() > RUNTIME_SAVE_STATE_WIRE_CAPACITY) {
		throw BMSX_RUNTIME_ERROR("Runtime save-state payload exceeds the current-format wire capacity.");
	}
	return bytes;
}

RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size) {
	if (size > RUNTIME_SAVE_STATE_WIRE_CAPACITY) {
		throw BMSX_RUNTIME_ERROR("Runtime save-state payload exceeds the current-format wire capacity.");
	}
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(data, size, RUNTIME_SAVE_STATE_PROP_NAMES),
		"runtimeSaveState");
}

RuntimeSaveState decodeRuntimeSaveState(const std::vector<u8>& data) {
	return decodeRuntimeSaveState(data.data(), data.size());
}

// disable-next-line single_line_method_pattern -- byte save-state API composes capture and binary encoding at the public boundary.
std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime) {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

// disable-next-line single_line_method_pattern -- byte save-state API composes binary decoding and runtime restore at the public boundary.
void applyRuntimeSaveStateBytes(Runtime& runtime, const u8* data, size_t size) {
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(data, size));
}

// disable-next-line single_line_method_pattern -- vector save-state input is the public owner overload for byte payload callers.
void applyRuntimeSaveStateBytes(Runtime& runtime, const std::vector<u8>& data) {
	applyRuntimeSaveStateBytes(runtime, data.data(), data.size());
}

} // namespace bmsx
