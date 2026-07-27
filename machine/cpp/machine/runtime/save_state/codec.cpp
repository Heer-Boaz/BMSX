#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binencoder.h"
#include "machine/bus/io.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gte.h"
#include "machine/devices/input/contracts.h"
#include "machine/memory/map.h"
#include "spec/bmsx/memory_map.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/schema.h"
#include <algorithm>
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

const BinBinary& requireBinaryWithLength(const BinValue& value, const char* label, size_t byteLength) {
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

i16 requireI16(const BinValue& value, const char* label) {
	const i32 word = requireI32(value, label);
	if (word < static_cast<i32>(std::numeric_limits<i16>::min())
		|| word > static_cast<i32>(std::numeric_limits<i16>::max())) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a 16-bit integer.");
	}
	return static_cast<i16>(word);
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

std::vector<u32> decodeU32VectorWithMaxLength(const BinValue& value, const char* label, size_t maxCount) {
	const BinArray& array = requireArray(value, label);
	if (array.size() > maxCount) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have at most " + std::to_string(maxCount) + " entries.");
	}
	std::vector<u32> out;
	out.reserve(array.size());
	for (const BinValue& word : array) {
		out.push_back(requireU32(word, label));
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

BinValue encodeFrameSchedulerState(const FrameSchedulerStateSnapshot& state) {
	BinObject object;
	object["accumulatedHostTimeMs"] = state.accumulatedHostTimeMs;
	object["cycleGrantRemainder"] = state.cycleGrantRemainder;
	object["carriedCycleBudget"] = state.carriedCycleBudget;
	object["tickCompletionPending"] = state.tickCompletionPending;
	object["tickCompletionVisualCommitted"] = state.tickCompletionVisualCommitted;
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
	state.cycleGrantRemainder = requireNumber(requireField(object, "cycleGrantRemainder", label), "frameScheduler.cycleGrantRemainder");
	state.carriedCycleBudget = requireI64(requireField(object, "carriedCycleBudget", label), "frameScheduler.carriedCycleBudget");
	state.tickCompletionPending = requireBool(requireField(object, "tickCompletionPending", label), "frameScheduler.tickCompletionPending");
	state.tickCompletionVisualCommitted = requireBool(requireField(object, "tickCompletionVisualCommitted", label), "frameScheduler.tickCompletionVisualCommitted");
	state.lastTickSequence = requireI64(requireField(object, "lastTickSequence", label), "frameScheduler.lastTickSequence");
	state.lastTickBudgetGranted = requireI64(requireField(object, "lastTickBudgetGranted", label), "frameScheduler.lastTickBudgetGranted");
	state.lastTickCpuBudgetGranted = requireI64(requireField(object, "lastTickCpuBudgetGranted", label), "frameScheduler.lastTickCpuBudgetGranted");
	state.lastTickCpuUsedCycles = requireI64(requireField(object, "lastTickCpuUsedCycles", label), "frameScheduler.lastTickCpuUsedCycles");
	state.lastTickBudgetRemaining = requireI64(requireField(object, "lastTickBudgetRemaining", label), "frameScheduler.lastTickBudgetRemaining");
	state.lastTickVisualFrameCommitted = requireBool(requireField(object, "lastTickVisualFrameCommitted", label), "frameScheduler.lastTickVisualFrameCommitted");
	state.lastTickCompleted = requireBool(requireField(object, "lastTickCompleted", label), "frameScheduler.lastTickCompleted");
	state.lastTickConsumedSequence = requireI64(requireField(object, "lastTickConsumedSequence", label), "frameScheduler.lastTickConsumedSequence");
	return state;
}

BinValue encodeFrameState(const FrameState& state) {
	BinObject object;
	object["updateExecuted"] = state.updateExecuted;
	object["luaFaulted"] = state.luaFaulted;
	object["cycleBudgetRemaining"] = state.cycleBudgetRemaining;
	object["cycleBudgetGranted"] = state.cycleBudgetGranted;
	object["cycleCarryGranted"] = state.cycleCarryGranted;
	object["activeCpuUsedCycles"] = state.activeCpuUsedCycles;
	return BinValue(std::move(object));
}

FrameState decodeFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	FrameState state;
	state.updateExecuted = requireBool(requireField(object, "updateExecuted", label), "machineState.frameLoop.frameState.updateExecuted");
	state.luaFaulted = requireBool(requireField(object, "luaFaulted", label), "machineState.frameLoop.frameState.luaFaulted");
	state.cycleBudgetRemaining = requireI64(requireField(object, "cycleBudgetRemaining", label), "machineState.frameLoop.frameState.cycleBudgetRemaining");
	state.cycleBudgetGranted = requireI64(requireField(object, "cycleBudgetGranted", label), "machineState.frameLoop.frameState.cycleBudgetGranted");
	state.cycleCarryGranted = requireI64(requireField(object, "cycleCarryGranted", label), "machineState.frameLoop.frameState.cycleCarryGranted");
	state.activeCpuUsedCycles = requireI64(requireField(object, "activeCpuUsedCycles", label), "machineState.frameLoop.frameState.activeCpuUsedCycles");
	return state;
}

BinValue encodeFrameLoopState(const FrameLoopStateSnapshot& state) {
	BinObject object;
	object["frameState"] = encodeFrameState(state.frameState);
	object["frameActive"] = state.frameActive;
	object["frameDeltaMs"] = state.frameDeltaMs;
	return BinValue(std::move(object));
}

FrameLoopStateSnapshot decodeFrameLoopState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	FrameLoopStateSnapshot state;
	state.frameState = decodeFrameState(requireField(object, "frameState", label), "machineState.frameLoop.frameState");
	state.frameActive = requireBool(requireField(object, "frameActive", label), "machineState.frameLoop.frameActive");
	state.frameDeltaMs = requireNumber(requireField(object, "frameDeltaMs", label), "machineState.frameLoop.frameDeltaMs");
	return state;
}

BinValue encodeCartridgeSlotState(const CartridgeSlotState& state) {
	BinObject object;
	object["ram"] = BinValue(BinBinary(state.ram.begin(), state.ram.end()));
	object["mailboxDataWord"] = static_cast<f64>(state.mailboxDataWord);
	object["mailboxControlWord"] = static_cast<f64>(state.mailboxControlWord);
	object["mailboxIrqPending"] = state.mailboxIrqPending;
	return BinValue(std::move(object));
}

CartridgeSlotState decodeCartridgeSlotState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CartridgeSlotState state;
	state.ram = requireBinary(requireField(object, "ram", label), "machine.cartridge.slots[].ram");
	state.mailboxDataWord = requireU32(requireField(object, "mailboxDataWord", label), "machine.cartridge.slots[].mailboxDataWord");
	state.mailboxControlWord = requireU32(requireField(object, "mailboxControlWord", label), "machine.cartridge.slots[].mailboxControlWord");
	state.mailboxIrqPending = requireBool(requireField(object, "mailboxIrqPending", label), "machine.cartridge.slots[].mailboxIrqPending");
	return state;
}

BinValue encodeCartridgeControllerState(const CartridgeControllerState& state) {
	BinObject object;
	object["selectionWord"] = static_cast<f64>(state.selectionWord);
	BinArray slots;
	slots.reserve(CARTRIDGE_SLOT_COUNT);
	for (const CartridgeSlotState& slot : state.slots) {
		slots.push_back(encodeCartridgeSlotState(slot));
	}
	object["slots"] = BinValue(std::move(slots));
	return BinValue(std::move(object));
}

CartridgeControllerState decodeCartridgeControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinArray& slots = requireArray(requireField(object, "slots", label), "machine.cartridge.slots");
	if (slots.size() != CARTRIDGE_SLOT_COUNT) {
		throw BMSX_RUNTIME_ERROR(
			"machine.cartridge.slots must contain "
			+ std::to_string(CARTRIDGE_SLOT_COUNT)
			+ " cartridge slot states.");
	}
	CartridgeControllerState state;
	state.selectionWord = requireU32(requireField(object, "selectionWord", label), "machine.cartridge.selectionWord");
	for (u32 slotIndex = 0; slotIndex < CARTRIDGE_SLOT_COUNT; ++slotIndex) {
		state.slots[slotIndex] = decodeCartridgeSlotState(slots[slotIndex], "machine.cartridge.slots[]");
	}
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
	object["userMask"] = static_cast<f64>(state.userMask);
	object["userPendingFlags"] = static_cast<f64>(state.userPendingFlags);
	object["supervisorContextActive"] = state.supervisorContextActive;
	return BinValue(std::move(object));
}

IrqControllerState decodeIrqControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	IrqControllerState state;
	state.mask = requireU32(requireField(object, "mask", label), "machine.irq.mask");
	state.pendingFlags = requireU32(requireField(object, "pendingFlags", label), "machine.irq.pendingFlags");
	state.userMask = requireU32(requireField(object, "userMask", label), "machine.irq.userMask");
	state.userPendingFlags = requireU32(requireField(object, "userPendingFlags", label), "machine.irq.userPendingFlags");
	state.supervisorContextActive = requireBool(requireField(object, "supervisorContextActive", label), "machine.irq.supervisorContextActive");
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
	object["supervisorRequestLineHigh"] = state.supervisorRequestLineHigh;
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
	state.supervisorRequestLineHigh = requireBool(requireField(object, "supervisorRequestLineHigh", label), "machine.input.supervisorRequestLineHigh");
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
	object["supervisorQuiesceRequested"] = state.supervisorQuiesceRequested;
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
	state.supervisorQuiesceRequested = requireBool(requireField(object, "supervisorQuiesceRequested", label), "machine.geometry.supervisorQuiesceRequested");
	return state;
}

BinValue encodeGxGpuCommandBufferState(const GxGpuCommandBufferState& state) {
	BinObject object;
	object["commandCount"] = static_cast<i64>(state.commandCount);
	object["executedCommandCount"] = static_cast<i64>(state.executedCommandCount);
	object["presentCommandCount"] = static_cast<i64>(state.presentCommandCount);
	object["wordCount"] = static_cast<i64>(state.wordCount);
	object["commandKind"] = encodeVector(state.commandKind, encodeScalar<i64, u8>);
	object["commandOpcode"] = encodeVector(state.commandOpcode, encodeScalar<i64, u8>);
	object["commandWordStart"] = encodeVector(state.commandWordStart, encodeScalar<i64, u32>);
	object["commandWordCount"] = encodeVector(state.commandWordCount, encodeScalar<i64, u32>);
	object["commandDrawModeWord"] = encodeVector(state.commandDrawModeWord, encodeScalar<i64, u32>);
	object["commandVramYAddressExtensionWord"] = encodeVector(state.commandVramYAddressExtensionWord, encodeScalar<i64, u8>);
	object["commandTextureWindowWord"] = encodeVector(state.commandTextureWindowWord, encodeScalar<i64, u32>);
	object["commandDrawingAreaTopLeftWord"] = encodeVector(state.commandDrawingAreaTopLeftWord, encodeScalar<i64, u32>);
	object["commandDrawingAreaBottomRightWord"] = encodeVector(state.commandDrawingAreaBottomRightWord, encodeScalar<i64, u32>);
	object["commandDrawingOffsetWord"] = encodeVector(state.commandDrawingOffsetWord, encodeScalar<i64, u32>);
	object["commandMaskBitModeWord"] = encodeVector(state.commandMaskBitModeWord, encodeScalar<i64, u32>);
	object["commandSkippedLineParity"] = encodeVector(state.commandSkippedLineParity, encodeScalar<i64, u8>);
	object["words"] = encodeVector(state.words, encodeScalar<i64, u32>);
	object["readbackPhase"] = static_cast<i64>(state.readbackPhase);
	object["readbackFenceCommandCount"] = static_cast<i64>(state.readbackFenceCommandCount);
	object["readbackX"] = static_cast<i64>(state.readbackX);
	object["readbackY"] = static_cast<i64>(state.readbackY);
	object["readbackVramYAddressExtensionWord"] = static_cast<i64>(state.readbackVramYAddressExtensionWord);
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
	state.executedCommandCount = requireBoundedU32(requireField(object, "executedCommandCount", label), "machine.gxGpu.commandBuffer.executedCommandCount", 0u, static_cast<u32>(state.commandCount));
	state.presentCommandCount = requireBoundedU32(requireField(object, "presentCommandCount", label), "machine.gxGpu.commandBuffer.presentCommandCount", 0u, static_cast<u32>(state.executedCommandCount));
	state.wordCount = requireBoundedU32(requireField(object, "wordCount", label), "machine.gxGpu.commandBuffer.wordCount", 0u, static_cast<u32>(GX_GPU_COMMAND_WORD_CAPACITY));
	state.commandKind = decodeU8VectorWithLength(requireField(object, "commandKind", label), "machine.gxGpu.commandBuffer.commandKind", state.commandCount);
	state.commandOpcode = decodeU8VectorWithLength(requireField(object, "commandOpcode", label), "machine.gxGpu.commandBuffer.commandOpcode", state.commandCount);
	state.commandWordStart = decodeU32VectorWithLength(requireField(object, "commandWordStart", label), "machine.gxGpu.commandBuffer.commandWordStart", state.commandCount);
	state.commandWordCount = decodeU32VectorWithLength(requireField(object, "commandWordCount", label), "machine.gxGpu.commandBuffer.commandWordCount", state.commandCount);
	state.commandDrawModeWord = decodeU32VectorWithLength(requireField(object, "commandDrawModeWord", label), "machine.gxGpu.commandBuffer.commandDrawModeWord", state.commandCount);
	state.commandVramYAddressExtensionWord = decodeU8VectorWithLength(requireField(object, "commandVramYAddressExtensionWord", label), "machine.gxGpu.commandBuffer.commandVramYAddressExtensionWord", state.commandCount);
	state.commandTextureWindowWord = decodeU32VectorWithLength(requireField(object, "commandTextureWindowWord", label), "machine.gxGpu.commandBuffer.commandTextureWindowWord", state.commandCount);
	state.commandDrawingAreaTopLeftWord = decodeU32VectorWithLength(requireField(object, "commandDrawingAreaTopLeftWord", label), "machine.gxGpu.commandBuffer.commandDrawingAreaTopLeftWord", state.commandCount);
	state.commandDrawingAreaBottomRightWord = decodeU32VectorWithLength(requireField(object, "commandDrawingAreaBottomRightWord", label), "machine.gxGpu.commandBuffer.commandDrawingAreaBottomRightWord", state.commandCount);
	state.commandDrawingOffsetWord = decodeU32VectorWithLength(requireField(object, "commandDrawingOffsetWord", label), "machine.gxGpu.commandBuffer.commandDrawingOffsetWord", state.commandCount);
	state.commandMaskBitModeWord = decodeU32VectorWithLength(requireField(object, "commandMaskBitModeWord", label), "machine.gxGpu.commandBuffer.commandMaskBitModeWord", state.commandCount);
	state.commandSkippedLineParity = decodeU8VectorWithLength(requireField(object, "commandSkippedLineParity", label), "machine.gxGpu.commandBuffer.commandSkippedLineParity", state.commandCount);
	state.words = decodeU32VectorWithLength(requireField(object, "words", label), "machine.gxGpu.commandBuffer.words", state.wordCount);
	state.readbackPhase = static_cast<u8>(requireBoundedU32(requireField(object, "readbackPhase", label), "machine.gxGpu.commandBuffer.readbackPhase", 0u, GX_GPU_READBACK_READY));
	if (state.readbackPhase == GX_GPU_READBACK_SUBMITTED) {
		throw BMSX_RUNTIME_ERROR("machine.gxGpu.commandBuffer.readbackPhase cannot contain the backend-submitted phase.");
	}
	state.readbackFenceCommandCount = requireBoundedU32(requireField(object, "readbackFenceCommandCount", label), "machine.gxGpu.commandBuffer.readbackFenceCommandCount", 0u, static_cast<u32>(state.commandCount));
	state.readbackX = requireBoundedU32(requireField(object, "readbackX", label), "machine.gxGpu.commandBuffer.readbackX", 0u, GX_GPU_VRAM_WIDTH - 1u);
	state.readbackY = requireBoundedU32(requireField(object, "readbackY", label), "machine.gxGpu.commandBuffer.readbackY", 0u, GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u);
	state.readbackVramYAddressExtensionWord = static_cast<u8>(requireBoundedU32(requireField(object, "readbackVramYAddressExtensionWord", label), "machine.gxGpu.commandBuffer.readbackVramYAddressExtensionWord", 0u, 1u));
	state.readbackWidth = requireBoundedU32(requireField(object, "readbackWidth", label), "machine.gxGpu.commandBuffer.readbackWidth", 0u, GX_GPU_VRAM_WIDTH);
	state.readbackHeight = requireBoundedU32(requireField(object, "readbackHeight", label), "machine.gxGpu.commandBuffer.readbackHeight", 0u, GX_GPU_TRANSFER_MAX_HEIGHT);
	const size_t readbackPixelCount = static_cast<size_t>(state.readbackWidth) * static_cast<size_t>(state.readbackHeight);
	state.readbackPixelCursor = requireBoundedU32(requireField(object, "readbackPixelCursor", label), "machine.gxGpu.commandBuffer.readbackPixelCursor", 0u, static_cast<u32>(readbackPixelCount));
	state.readbackPixelBytes = requireBinaryWithLength(requireField(object, "readbackPixelBytes", label), "machine.gxGpu.commandBuffer.readbackPixelBytes", state.readbackPhase == GX_GPU_READBACK_READY ? readbackPixelCount * 2u : 0u);
	return state;
}

BinValue encodeGxGpuRegisterContextState(const GxGpuRegisterContextState& state) {
	BinObject object;
	object["gp0Word"] = static_cast<i64>(state.gp0Word);
	object["gp1Word"] = static_cast<i64>(state.gp1Word);
	object["displayModeWord"] = static_cast<i64>(state.displayModeWord);
	object["statusWord"] = static_cast<i64>(state.statusWord);
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
	object["vramYAddressExtensionWord"] = static_cast<i64>(state.vramYAddressExtensionWord);
	object["presentStatusWord"] = static_cast<i64>(state.presentStatusWord);
	object["presentDisplayModeWord"] = static_cast<i64>(state.presentDisplayModeWord);
	object["presentDisplayStartWord"] = static_cast<i64>(state.presentDisplayStartWord);
	object["presentVramYAddressExtensionWord"] = static_cast<i64>(state.presentVramYAddressExtensionWord);
	object["presentHorizontalDisplayRangeWord"] = static_cast<i64>(state.presentHorizontalDisplayRangeWord);
	object["presentVerticalDisplayRangeWord"] = static_cast<i64>(state.presentVerticalDisplayRangeWord);
	object["pcrtcRegisterWords"] = encodeFixedArray(state.pcrtcRegisterWords, encodeScalar<i64, u32>);
	object["pcrtcPresentWords"] = encodeFixedArray(state.pcrtcPresentWords, encodeScalar<i64, u32>);
	object["vramPresentationPending"] = state.vramPresentationPending;
	return BinValue(std::move(object));
}

GxGpuRegisterContextState decodeGxGpuRegisterContextState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuRegisterContextState state;
	state.gp0Word = requireU32(requireField(object, "gp0Word", label), "machine.gxGpu.userContext.gp0Word");
	state.gp1Word = requireU32(requireField(object, "gp1Word", label), "machine.gxGpu.userContext.gp1Word");
	state.displayModeWord = requireU32(requireField(object, "displayModeWord", label), "machine.gxGpu.userContext.displayModeWord");
	state.statusWord = requireU32(requireField(object, "statusWord", label), "machine.gxGpu.userContext.statusWord");
	state.gpuReadWord = requireU32(requireField(object, "gpuReadWord", label), "machine.gxGpu.userContext.gpuReadWord");
	state.drawModeWord = requireU32(requireField(object, "drawModeWord", label), "machine.gxGpu.userContext.drawModeWord");
	state.textureWindowWord = requireU32(requireField(object, "textureWindowWord", label), "machine.gxGpu.userContext.textureWindowWord");
	state.drawingAreaTopLeftWord = requireU32(requireField(object, "drawingAreaTopLeftWord", label), "machine.gxGpu.userContext.drawingAreaTopLeftWord");
	state.drawingAreaBottomRightWord = requireU32(requireField(object, "drawingAreaBottomRightWord", label), "machine.gxGpu.userContext.drawingAreaBottomRightWord");
	state.drawingOffsetWord = requireU32(requireField(object, "drawingOffsetWord", label), "machine.gxGpu.userContext.drawingOffsetWord");
	state.maskBitModeWord = requireU32(requireField(object, "maskBitModeWord", label), "machine.gxGpu.userContext.maskBitModeWord");
	state.displayStartWord = requireU32(requireField(object, "displayStartWord", label), "machine.gxGpu.userContext.displayStartWord");
	state.horizontalDisplayRangeWord = requireU32(requireField(object, "horizontalDisplayRangeWord", label), "machine.gxGpu.userContext.horizontalDisplayRangeWord");
	state.verticalDisplayRangeWord = requireU32(requireField(object, "verticalDisplayRangeWord", label), "machine.gxGpu.userContext.verticalDisplayRangeWord");
	state.vramYAddressExtensionWord = requireU32(requireField(object, "vramYAddressExtensionWord", label), "machine.gxGpu.userContext.vramYAddressExtensionWord");
	state.presentStatusWord = requireU32(requireField(object, "presentStatusWord", label), "machine.gxGpu.userContext.presentStatusWord");
	state.presentDisplayModeWord = requireU32(requireField(object, "presentDisplayModeWord", label), "machine.gxGpu.userContext.presentDisplayModeWord");
	state.presentDisplayStartWord = requireU32(requireField(object, "presentDisplayStartWord", label), "machine.gxGpu.userContext.presentDisplayStartWord");
	state.presentVramYAddressExtensionWord = requireBoundedU32(requireField(object, "presentVramYAddressExtensionWord", label), "machine.gxGpu.userContext.presentVramYAddressExtensionWord", 0u, 1u);
	state.presentHorizontalDisplayRangeWord = requireU32(requireField(object, "presentHorizontalDisplayRangeWord", label), "machine.gxGpu.userContext.presentHorizontalDisplayRangeWord");
	state.presentVerticalDisplayRangeWord = requireU32(requireField(object, "presentVerticalDisplayRangeWord", label), "machine.gxGpu.userContext.presentVerticalDisplayRangeWord");
	state.pcrtcRegisterWords = decodeU32Array<GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>(requireField(object, "pcrtcRegisterWords", label), "machine.gxGpu.userContext.pcrtcRegisterWords");
	state.pcrtcPresentWords = decodeU32Array<GX_GPU_PCRTC_COMPOSITION_WORD_COUNT>(requireField(object, "pcrtcPresentWords", label), "machine.gxGpu.userContext.pcrtcPresentWords");
	state.vramPresentationPending = requireBool(requireField(object, "vramPresentationPending", label), "machine.gxGpu.userContext.vramPresentationPending");
	return state;
}

BinValue encodeGxGpuIngressContextState(const GxGpuIngressContextState& state) {
	BinObject object;
	object["gp0CommandTargetWordCount"] = static_cast<i64>(state.gp0CommandTargetWordCount);
	object["gp0CommandWords"] = encodeVector(state.gp0CommandWords, encodeScalar<i64, u32>);
	object["gp0IngressPhase"] = static_cast<i64>(state.gp0IngressPhase);
	object["gp0IngressWordsRemaining"] = static_cast<i64>(state.gp0IngressWordsRemaining);
	object["gp0IngressPolylineWordsPerVertex"] = static_cast<i64>(state.gp0IngressPolylineWordsPerVertex);
	object["gp0IngressPolylinePayloadPhase"] = static_cast<i64>(state.gp0IngressPolylinePayloadPhase);
	object["gp0ImageLoadWordsRemaining"] = static_cast<i64>(state.gp0ImageLoadWordsRemaining);
	object["gp0ImageLoadCommandWordStart"] = static_cast<i64>(state.gp0ImageLoadCommandWordStart);
	object["gp0ImageLoadCommandWordCount"] = static_cast<i64>(state.gp0ImageLoadCommandWordCount);
	object["gp0ImageLoadCommandOpcode"] = static_cast<i64>(state.gp0ImageLoadCommandOpcode);
	object["gp0PolylineWordsPerVertex"] = static_cast<i64>(state.gp0PolylineWordsPerVertex);
	object["gp0PolylinePayloadPhase"] = static_cast<i64>(state.gp0PolylinePayloadPhase);
	object["gp0PolylineCommandWordStart"] = static_cast<i64>(state.gp0PolylineCommandWordStart);
	object["gp0PolylineCommandWordCount"] = static_cast<i64>(state.gp0PolylineCommandWordCount);
	object["gp0PolylineCommandOpcode"] = static_cast<i64>(state.gp0PolylineCommandOpcode);
	object["commandBufferWords"] = encodeVector(state.commandBufferWords, encodeScalar<i64, u32>);
	return BinValue(std::move(object));
}

GxGpuIngressContextState decodeGxGpuIngressContextState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuIngressContextState state;
	state.gp0CommandTargetWordCount = requireBoundedU32(requireField(object, "gp0CommandTargetWordCount", label), "machine.gxGpu.userIngressContext.gp0CommandTargetWordCount", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0CommandWords = decodeU32VectorWithMaxLength(requireField(object, "gp0CommandWords", label), "machine.gxGpu.userIngressContext.gp0CommandWords", GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0IngressPhase = requireBoundedU32(requireField(object, "gp0IngressPhase", label), "machine.gxGpu.userIngressContext.gp0IngressPhase", 0u, GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD);
	state.gp0IngressWordsRemaining = requireBoundedU32(requireField(object, "gp0IngressWordsRemaining", label), "machine.gxGpu.userIngressContext.gp0IngressWordsRemaining", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0IngressPolylineWordsPerVertex = requireBoundedU32(requireField(object, "gp0IngressPolylineWordsPerVertex", label), "machine.gxGpu.userIngressContext.gp0IngressPolylineWordsPerVertex", 0u, 2u);
	state.gp0IngressPolylinePayloadPhase = requireBoundedU32(requireField(object, "gp0IngressPolylinePayloadPhase", label), "machine.gxGpu.userIngressContext.gp0IngressPolylinePayloadPhase", 0u, 1u);
	state.gp0ImageLoadWordsRemaining = requireBoundedU32(requireField(object, "gp0ImageLoadWordsRemaining", label), "machine.gxGpu.userIngressContext.gp0ImageLoadWordsRemaining", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandWordStart = requireBoundedU32(requireField(object, "gp0ImageLoadCommandWordStart", label), "machine.gxGpu.userIngressContext.gp0ImageLoadCommandWordStart", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandWordCount = requireBoundedU32(requireField(object, "gp0ImageLoadCommandWordCount", label), "machine.gxGpu.userIngressContext.gp0ImageLoadCommandWordCount", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0ImageLoadCommandOpcode = static_cast<u8>(requireBoundedU32(requireField(object, "gp0ImageLoadCommandOpcode", label), "machine.gxGpu.userIngressContext.gp0ImageLoadCommandOpcode", 0u, 0xffu));
	state.gp0PolylineWordsPerVertex = requireBoundedU32(requireField(object, "gp0PolylineWordsPerVertex", label), "machine.gxGpu.userIngressContext.gp0PolylineWordsPerVertex", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0PolylinePayloadPhase = requireBoundedU32(requireField(object, "gp0PolylinePayloadPhase", label), "machine.gxGpu.userIngressContext.gp0PolylinePayloadPhase", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0PolylineCommandWordStart = requireBoundedU32(requireField(object, "gp0PolylineCommandWordStart", label), "machine.gxGpu.userIngressContext.gp0PolylineCommandWordStart", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0PolylineCommandWordCount = requireBoundedU32(requireField(object, "gp0PolylineCommandWordCount", label), "machine.gxGpu.userIngressContext.gp0PolylineCommandWordCount", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0PolylineCommandOpcode = static_cast<u8>(requireBoundedU32(requireField(object, "gp0PolylineCommandOpcode", label), "machine.gxGpu.userIngressContext.gp0PolylineCommandOpcode", 0u, 0xffu));
	state.commandBufferWords = decodeU32VectorWithMaxLength(requireField(object, "commandBufferWords", label), "machine.gxGpu.userIngressContext.commandBufferWords", GX_GPU_COMMAND_WORD_CAPACITY);
	return state;
}

BinValue encodeGxGpuPcrtcState(const GxGpuPcrtcState& state) {
	BinObject object;
	object["registerWords"] = encodeFixedArray(state.registerWords, encodeScalar<i64, u32>);
	object["presentWords"] = encodeFixedArray(state.presentWords, encodeScalar<i64, u32>);
	object["csrWord"] = static_cast<i64>(state.csrWord);
	object["imrWord"] = static_cast<i64>(state.imrWord);
	object["beamCycleOffset"] = state.beamCycleOffset;
	object["beamRemainder"] = static_cast<i64>(state.beamRemainder);
	object["beamHalfLine"] = static_cast<i64>(state.beamHalfLine);
	object["nextHsyncHalfLine"] = static_cast<i64>(state.nextHsyncHalfLine);
	object["verticalStage"] = static_cast<i64>(state.verticalStage);
	object["vblankActive"] = state.vblankActive;
	return BinValue(std::move(object));
}

GxGpuPcrtcState decodeGxGpuPcrtcState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuPcrtcState state;
	state.registerWords = decodeU32Array<GX_GPU_PCRTC_CONFIG_WORD_COUNT>(requireField(object, "registerWords", label), "machine.gxGpu.pcrtc.registerWords");
	state.presentWords = decodeU32Array<GX_GPU_PCRTC_CONFIG_WORD_COUNT>(requireField(object, "presentWords", label), "machine.gxGpu.pcrtc.presentWords");
	state.csrWord = requireU32(requireField(object, "csrWord", label), "machine.gxGpu.pcrtc.csrWord");
	state.imrWord = requireU32(requireField(object, "imrWord", label), "machine.gxGpu.pcrtc.imrWord");
	state.beamCycleOffset = requireI64(requireField(object, "beamCycleOffset", label), "machine.gxGpu.pcrtc.beamCycleOffset");
	state.beamRemainder = requireU32(requireField(object, "beamRemainder", label), "machine.gxGpu.pcrtc.beamRemainder");
	state.beamHalfLine = requireU32(requireField(object, "beamHalfLine", label), "machine.gxGpu.pcrtc.beamHalfLine");
	state.nextHsyncHalfLine = requireU32(requireField(object, "nextHsyncHalfLine", label), "machine.gxGpu.pcrtc.nextHsyncHalfLine");
	state.verticalStage = requireBoundedU32(requireField(object, "verticalStage", label), "machine.gxGpu.pcrtc.verticalStage", 0u, 2u);
	state.vblankActive = requireBool(requireField(object, "vblankActive", label), "machine.gxGpu.pcrtc.vblankActive");
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
	object["gp0FifoWords"] = encodeVector(state.gp0FifoWords, encodeScalar<i64, u32>);
	object["gp0DmaIngressWords"] = encodeVector(state.gp0DmaIngressWords, encodeScalar<i64, u32>);
	object["gp0IngressPhase"] = static_cast<i64>(state.gp0IngressPhase);
	object["gp0IngressWordsRemaining"] = static_cast<i64>(state.gp0IngressWordsRemaining);
	object["gp0IngressPolylineWordsPerVertex"] = static_cast<i64>(state.gp0IngressPolylineWordsPerVertex);
	object["gp0IngressPolylinePayloadPhase"] = static_cast<i64>(state.gp0IngressPolylinePayloadPhase);
	object["pendingCommandCycles"] = state.pendingCommandCycles;
	object["pendingCommandTargetCount"] = static_cast<i64>(state.pendingCommandTargetCount);
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
	object["vramYAddressExtensionWord"] = static_cast<i64>(state.vramYAddressExtensionWord);
	object["presentStatusWord"] = static_cast<i64>(state.presentStatusWord);
	object["presentDisplayModeWord"] = static_cast<i64>(state.presentDisplayModeWord);
	object["presentDisplayStartWord"] = static_cast<i64>(state.presentDisplayStartWord);
	object["presentVramYAddressExtensionWord"] = static_cast<i64>(state.presentVramYAddressExtensionWord);
	object["presentHorizontalDisplayRangeWord"] = static_cast<i64>(state.presentHorizontalDisplayRangeWord);
	object["presentVerticalDisplayRangeWord"] = static_cast<i64>(state.presentVerticalDisplayRangeWord);
	object["pcrtc"] = encodeGxGpuPcrtcState(state.pcrtc);
	object["pcrtcPresentationPending"] = state.pcrtcPresentationPending;
	object["vramPresentationPending"] = state.vramPresentationPending;
	object["supervisorQuiesceRequested"] = state.supervisorQuiesceRequested;
	object["supervisorIngressQuiesceRequested"] = state.supervisorIngressQuiesceRequested;
	object["supervisorIngressStopped"] = state.supervisorIngressStopped;
	object["userContext"] = encodeGxGpuRegisterContextState(state.userContext);
	object["userIngressContext"] = encodeGxGpuIngressContextState(state.userIngressContext);
	object["commandBuffer"] = encodeGxGpuCommandBufferState(state.commandBuffer);
	return BinValue(std::move(object));
}

GxGpuState decodeGxGpuState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGpuState state;
	state.commandBuffer = decodeGxGpuCommandBufferState(requireField(object, "commandBuffer", label), "machine.gxGpu.commandBuffer");
	state.gp0Word = requireU32(requireField(object, "gp0Word", label), "machine.gxGpu.gp0Word");
	state.gp1Word = requireU32(requireField(object, "gp1Word", label), "machine.gxGpu.gp1Word");
	state.displayModeWord = requireU32(requireField(object, "displayModeWord", label), "machine.gxGpu.displayModeWord");
	state.statusWord = requireU32(requireField(object, "statusWord", label), "machine.gxGpu.statusWord");
	state.gp0CommandWordCount = requireBoundedU32(requireField(object, "gp0CommandWordCount", label), "machine.gxGpu.gp0CommandWordCount", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0CommandTargetWordCount = requireBoundedU32(requireField(object, "gp0CommandTargetWordCount", label), "machine.gxGpu.gp0CommandTargetWordCount", 0u, GX_GPU_GP0_COMMAND_BUFFER_WORDS);
	state.gp0CommandWords = decodeU32VectorWithLength(requireField(object, "gp0CommandWords", label), "machine.gxGpu.gp0CommandWords", state.gp0CommandWordCount);
	state.gp0FifoWords = decodeU32VectorWithMaxLength(requireField(object, "gp0FifoWords", label), "machine.gxGpu.gp0FifoWords", GX_GPU_COMMAND_FIFO_WORD_CAPACITY);
	state.gp0DmaIngressWords = decodeU32VectorWithMaxLength(requireField(object, "gp0DmaIngressWords", label), "machine.gxGpu.gp0DmaIngressWords", GX_GPU_DMA_INGRESS_WORD_CAPACITY);
	state.gp0IngressPhase = requireBoundedU32(requireField(object, "gp0IngressPhase", label), "machine.gxGpu.gp0IngressPhase", 0u, GX_GPU_GP0_INGRESS_POLYLINE_PAYLOAD);
	state.gp0IngressWordsRemaining = requireBoundedU32(requireField(object, "gp0IngressWordsRemaining", label), "machine.gxGpu.gp0IngressWordsRemaining", 0u, GX_GPU_COMMAND_WORD_CAPACITY);
	state.gp0IngressPolylineWordsPerVertex = requireBoundedU32(requireField(object, "gp0IngressPolylineWordsPerVertex", label), "machine.gxGpu.gp0IngressPolylineWordsPerVertex", 0u, 2u);
	state.gp0IngressPolylinePayloadPhase = requireBoundedU32(requireField(object, "gp0IngressPolylinePayloadPhase", label), "machine.gxGpu.gp0IngressPolylinePayloadPhase", 0u, 1u);
	state.pendingCommandCycles = requireBoundedU32(requireField(object, "pendingCommandCycles", label), "machine.gxGpu.pendingCommandCycles", 0u, 0xffffffffu);
	state.pendingCommandTargetCount = requireBoundedU32(requireField(object, "pendingCommandTargetCount", label), "machine.gxGpu.pendingCommandTargetCount", 0u, static_cast<u32>(state.commandBuffer.commandCount));
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
	state.vramYAddressExtensionWord = requireU32(requireField(object, "vramYAddressExtensionWord", label), "machine.gxGpu.vramYAddressExtensionWord");
	state.presentStatusWord = requireU32(requireField(object, "presentStatusWord", label), "machine.gxGpu.presentStatusWord");
	state.presentDisplayModeWord = requireU32(requireField(object, "presentDisplayModeWord", label), "machine.gxGpu.presentDisplayModeWord");
	state.presentDisplayStartWord = requireU32(requireField(object, "presentDisplayStartWord", label), "machine.gxGpu.presentDisplayStartWord");
	state.presentVramYAddressExtensionWord = requireBoundedU32(requireField(object, "presentVramYAddressExtensionWord", label), "machine.gxGpu.presentVramYAddressExtensionWord", 0u, 1u);
	state.presentHorizontalDisplayRangeWord = requireU32(requireField(object, "presentHorizontalDisplayRangeWord", label), "machine.gxGpu.presentHorizontalDisplayRangeWord");
	state.presentVerticalDisplayRangeWord = requireU32(requireField(object, "presentVerticalDisplayRangeWord", label), "machine.gxGpu.presentVerticalDisplayRangeWord");
	state.pcrtc = decodeGxGpuPcrtcState(requireField(object, "pcrtc", label), "machine.gxGpu.pcrtc");
	state.pcrtcPresentationPending = requireBool(requireField(object, "pcrtcPresentationPending", label), "machine.gxGpu.pcrtcPresentationPending");
	state.vramPresentationPending = requireBool(requireField(object, "vramPresentationPending", label), "machine.gxGpu.vramPresentationPending");
	state.supervisorQuiesceRequested = requireBool(requireField(object, "supervisorQuiesceRequested", label), "machine.gxGpu.supervisorQuiesceRequested");
	state.supervisorIngressQuiesceRequested = requireBool(requireField(object, "supervisorIngressQuiesceRequested", label), "machine.gxGpu.supervisorIngressQuiesceRequested");
	state.supervisorIngressStopped = requireBool(requireField(object, "supervisorIngressStopped", label), "machine.gxGpu.supervisorIngressStopped");
	state.userContext = decodeGxGpuRegisterContextState(requireField(object, "userContext", label), "machine.gxGpu.userContext");
	state.userIngressContext = decodeGxGpuIngressContextState(requireField(object, "userIngressContext", label), "machine.gxGpu.userIngressContext");
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
	object["plusRegisterWords"] = encodeFixedArray(state.plusRegisterWords, encodeScalar<i64, u32>);
	object["mac0"] = static_cast<i64>(state.mac0);
	object["mac1"] = static_cast<i64>(state.mac1);
	object["mac2"] = static_cast<i64>(state.mac2);
	object["mac3"] = static_cast<i64>(state.mac3);
	object["currentSf"] = static_cast<i64>(state.currentSf);
	object["lastCycles"] = static_cast<i64>(state.lastCycles);
	object["plusPendingCycles"] = static_cast<i64>(state.plusPendingCycles);
	object["plusInterlockArmed"] = state.plusInterlockArmed;
	object["plusPendingResultXy"] = static_cast<i64>(state.plusPendingResultXy);
	object["plusPendingResultZ"] = static_cast<i64>(state.plusPendingResultZ);
	object["plusPendingFlag"] = static_cast<i64>(state.plusPendingFlag);
	return BinValue(std::move(object));
}

GxGteState decodeGxGteState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	GxGteState state;
	state.dataRegisterWords = decodeU32Array<GX_GTE_DATA_REGISTER_COUNT>(requireField(object, "dataRegisterWords", label), "machine.gxGte.dataRegisterWords");
	state.controlRegisterWords = decodeU32Array<GX_GTE_CONTROL_REGISTER_COUNT>(requireField(object, "controlRegisterWords", label), "machine.gxGte.controlRegisterWords");
	state.plusRegisterWords = decodeU32Array<GX_GTE_PLUS_REGISTER_COUNT>(requireField(object, "plusRegisterWords", label), "machine.gxGte.plusRegisterWords");
	state.mac0 = requireI64(requireField(object, "mac0", label), "machine.gxGte.mac0");
	state.mac1 = requireI64(requireField(object, "mac1", label), "machine.gxGte.mac1");
	state.mac2 = requireI64(requireField(object, "mac2", label), "machine.gxGte.mac2");
	state.mac3 = requireI64(requireField(object, "mac3", label), "machine.gxGte.mac3");
	state.currentSf = requireU32(requireField(object, "currentSf", label), "machine.gxGte.currentSf");
	state.lastCycles = requireU32(requireField(object, "lastCycles", label), "machine.gxGte.lastCycles");
	state.plusPendingCycles = requireU32(requireField(object, "plusPendingCycles", label), "machine.gxGte.plusPendingCycles");
	state.plusInterlockArmed = requireBool(requireField(object, "plusInterlockArmed", label), "machine.gxGte.plusInterlockArmed");
	state.plusPendingResultXy = requireU32(requireField(object, "plusPendingResultXy", label), "machine.gxGte.plusPendingResultXy");
	state.plusPendingResultZ = requireU32(requireField(object, "plusPendingResultZ", label), "machine.gxGte.plusPendingResultZ");
	state.plusPendingFlag = requireU32(requireField(object, "plusPendingFlag", label), "machine.gxGte.plusPendingFlag");
	return state;
}

BinValue encodeApuBiquadFilterState(const ApuBiquadFilterState& state) {
	BinObject object;
	object["l1"] = static_cast<i64>(state.l1);
	object["l2"] = static_cast<i64>(state.l2);
	object["r1"] = static_cast<i64>(state.r1);
	object["r2"] = static_cast<i64>(state.r2);
	return BinValue(std::move(object));
}

ApuBiquadFilterState decodeApuBiquadFilterState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuBiquadFilterState state;
	state.l1 = requireI32(requireField(object, "l1", label), "machine.audio.output.voices.filter.l1");
	state.l2 = requireI32(requireField(object, "l2", label), "machine.audio.output.voices.filter.l2");
	state.r1 = requireI32(requireField(object, "r1", label), "machine.audio.output.voices.filter.r1");
	state.r2 = requireI32(requireField(object, "r2", label), "machine.audio.output.voices.filter.r2");
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
	object["previousDecodedFrame"] = encodeScalar<f64>(state.previousDecodedFrame);
	object["previousDecodedLeft"] = encodeScalar<f64>(state.previousDecodedLeft);
	object["previousDecodedRight"] = encodeScalar<f64>(state.previousDecodedRight);
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
	state.decodedLeft = requireI16(requireField(object, "decodedLeft", label), "machine.audio.output.voices.badp.decodedLeft");
	state.decodedRight = requireI16(requireField(object, "decodedRight", label), "machine.audio.output.voices.badp.decodedRight");
	state.previousDecodedFrame = requireI64(requireField(object, "previousDecodedFrame", label), "machine.audio.output.voices.badp.previousDecodedFrame");
	state.previousDecodedLeft = requireI16(requireField(object, "previousDecodedLeft", label), "machine.audio.output.voices.badp.previousDecodedLeft");
	state.previousDecodedRight = requireI16(requireField(object, "previousDecodedRight", label), "machine.audio.output.voices.badp.previousDecodedRight");
	return state;
}

BinValue encodeApuOutputVoiceState(const ApuOutputVoiceState& state) {
	BinObject object;
	object["slot"] = encodeScalar<f64>(state.slot);
	object["sourceCartridgeSlot"] = encodeScalar<f64>(state.sourceCartridgeSlot);
	object["cursorQ16"] = encodeScalar<f64>(state.cursorQ16);
	object["phaseRemainder"] = encodeScalar<f64>(state.phaseRemainder);
	object["gainQ12"] = encodeScalar<f64>(state.gainQ12);
	object["fadeStepQ12"] = encodeScalar<f64>(state.fadeStepQ12);
	object["fadeStepRemainder"] = encodeScalar<f64>(state.fadeStepRemainder);
	object["fadeError"] = encodeScalar<f64>(state.fadeError);
	object["fadeSamplesRemaining"] = encodeScalar<f64>(state.fadeSamplesRemaining);
	object["fadeSamplesTotal"] = encodeScalar<f64>(state.fadeSamplesTotal);
	object["filter"] = encodeApuBiquadFilterState(state.filter);
	object["badp"] = encodeApuBadpDecoderState(state.badp);
	return BinValue(std::move(object));
}

ApuOutputVoiceState decodeApuOutputVoiceState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuOutputVoiceState state;
	state.slot = requireBoundedU32(requireField(object, "slot", label), "machine.audio.output.voices.slot", 0u, APU_SLOT_COUNT - 1u);
	state.sourceCartridgeSlot = requireBoundedU32(
		requireField(object, "sourceCartridgeSlot", label),
		"machine.audio.output.voices.sourceCartridgeSlot",
		0u,
		CARTRIDGE_SLOT_COUNT - 1u);
	state.cursorQ16 = requireI64(requireField(object, "cursorQ16", label), "machine.audio.output.voices.cursorQ16");
	state.phaseRemainder = requireI32(requireField(object, "phaseRemainder", label), "machine.audio.output.voices.phaseRemainder");
	state.gainQ12 = requireI32(requireField(object, "gainQ12", label), "machine.audio.output.voices.gainQ12");
	state.fadeStepQ12 = requireI32(requireField(object, "fadeStepQ12", label), "machine.audio.output.voices.fadeStepQ12");
	state.fadeStepRemainder = requireI32(requireField(object, "fadeStepRemainder", label), "machine.audio.output.voices.fadeStepRemainder");
	state.fadeError = requireU32(requireField(object, "fadeError", label), "machine.audio.output.voices.fadeError");
	state.fadeSamplesRemaining = requireU32(requireField(object, "fadeSamplesRemaining", label), "machine.audio.output.voices.fadeSamplesRemaining");
	state.fadeSamplesTotal = requireU32(requireField(object, "fadeSamplesTotal", label), "machine.audio.output.voices.fadeSamplesTotal");
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

BinValue encodeApuSampleTransferState(const ApuSampleTransferState& state) {
	BinObject object;
	object["fifoWords"] = encodeFixedArray(state.fifoWords, encodeScalar<f64, u32>);
	object["fifoReadIndex"] = encodeScalar<f64>(state.fifoReadIndex);
	object["fifoWriteIndex"] = encodeScalar<f64>(state.fifoWriteIndex);
	object["fifoCount"] = encodeScalar<f64>(state.fifoCount);
	object["transferAddressWord"] = encodeScalar<f64>(state.transferAddressWord);
	object["transferDataWord"] = encodeScalar<f64>(state.transferDataWord);
	object["transferControlWord"] = encodeScalar<f64>(state.transferControlWord);
	object["currentAddress"] = encodeScalar<f64>(state.currentAddress);
	object["timingCarry"] = encodeScalar<f64>(state.timingCarry);
	object["scheduledWords"] = encodeScalar<f64>(state.scheduledWords);
	object["scheduledCycles"] = encodeScalar<f64>(state.scheduledCycles);
	return BinValue(std::move(object));
}

ApuSampleTransferState decodeApuSampleTransferState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ApuSampleTransferState state;
	state.fifoWords = decodeU32Array<APU_TRANSFER_FIFO_WORD_CAPACITY>(requireField(object, "fifoWords", label), "machine.audio.sampleTransfer.fifoWords");
	state.fifoReadIndex = requireBoundedU32(requireField(object, "fifoReadIndex", label), "machine.audio.sampleTransfer.fifoReadIndex", 0u, APU_TRANSFER_FIFO_WORD_CAPACITY - 1u);
	state.fifoWriteIndex = requireBoundedU32(requireField(object, "fifoWriteIndex", label), "machine.audio.sampleTransfer.fifoWriteIndex", 0u, APU_TRANSFER_FIFO_WORD_CAPACITY - 1u);
	state.fifoCount = requireBoundedU32(requireField(object, "fifoCount", label), "machine.audio.sampleTransfer.fifoCount", 0u, APU_TRANSFER_FIFO_WORD_CAPACITY);
	state.transferAddressWord = requireU32(requireField(object, "transferAddressWord", label), "machine.audio.sampleTransfer.transferAddressWord");
	state.transferDataWord = requireU32(requireField(object, "transferDataWord", label), "machine.audio.sampleTransfer.transferDataWord");
	state.transferControlWord = requireU32(requireField(object, "transferControlWord", label), "machine.audio.sampleTransfer.transferControlWord");
	state.currentAddress = requireBoundedU32(requireField(object, "currentAddress", label), "machine.audio.sampleTransfer.currentAddress", 0u, APU_SAMPLE_RAM_ADDRESS_MASK);
	state.timingCarry = requireI64(requireField(object, "timingCarry", label), "machine.audio.sampleTransfer.timingCarry");
	state.scheduledWords = requireBoundedU32(requireField(object, "scheduledWords", label), "machine.audio.sampleTransfer.scheduledWords", 0u, APU_TRANSFER_FIFO_WORD_CAPACITY);
	state.scheduledCycles = requireI64(requireField(object, "scheduledCycles", label), "machine.audio.sampleTransfer.scheduledCycles");
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
	object["sampleRam"] = BinValue(BinBinary(state.sampleRam.begin(), state.sampleRam.end()));
	object["sampleTransfer"] = encodeApuSampleTransferState(state.sampleTransfer);
	BinObject output;
	output["voices"] = encodeVector<ApuOutputVoiceState>(state.output.voices, encodeApuOutputVoiceState);
	object["output"] = BinValue(std::move(output));
	object["sampleCarry"] = encodeScalar<f64>(state.sampleCarry);
	object["sampleSequence"] = encodeScalar<f64>(state.sampleSequence);
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
	state.sampleRam = requireBinary(requireField(object, "sampleRam", label), "machine.audio.sampleRam");
	if (state.sampleRam.size() != APU_SAMPLE_RAM_BYTES) {
		throw BMSX_RUNTIME_ERROR("machine.audio.sampleRam must contain APU_SAMPLE_RAM_BYTES bytes.");
	}
	state.sampleTransfer = decodeApuSampleTransferState(requireField(object, "sampleTransfer", label), "machine.audio.sampleTransfer");
	state.output = decodeApuOutputState(requireField(object, "output", label), "machine.audio.output");
	state.sampleCarry = requireI64(requireField(object, "sampleCarry", label), "machine.audio.sampleCarry");
	state.sampleSequence = requireI64(requireField(object, "sampleSequence", label), "machine.audio.sampleSequence");
	state.apuStatus = requireU32(requireField(object, "apuStatus", label), "machine.audio.apuStatus");
	state.apuFaultCode = requireU32(requireField(object, "apuFaultCode", label), "machine.audio.apuFaultCode");
	state.apuFaultDetail = requireU32(requireField(object, "apuFaultDetail", label), "machine.audio.apuFaultDetail");
	return state;
}

BinValue encodeDmaChannelState(const DmaChannelState& state) {
	BinObject object;
	object["readAddressWord"] = encodeScalar<f64>(state.readAddressWord);
	object["writeAddressWord"] = encodeScalar<f64>(state.writeAddressWord);
	object["transferCountWord"] = encodeScalar<f64>(state.transferCountWord);
	object["controlWord"] = encodeScalar<f64>(state.controlWord);
	object["statusWord"] = encodeScalar<f64>(state.statusWord);
	return BinValue(std::move(object));
}

DmaChannelState decodeDmaChannelState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	DmaChannelState state;
	state.readAddressWord = requireU32(requireField(object, "readAddressWord", label), label);
	state.writeAddressWord = requireU32(requireField(object, "writeAddressWord", label), label);
	state.transferCountWord = requireU32(requireField(object, "transferCountWord", label), label);
	state.controlWord = requireU32(requireField(object, "controlWord", label), label);
	state.statusWord = requireU32(requireField(object, "statusWord", label), label);
	return state;
}

BinValue encodeDmaControllerState(const DmaControllerState& state) {
	BinObject object;
	object["channels"] = encodeFixedArray(state.channels, encodeDmaChannelState);
	object["activeChannel"] = encodeScalar<f64>(state.activeChannel);
	object["nextChannel"] = encodeScalar<f64>(state.nextChannel);
	object["scheduledBlockWords"] = encodeScalar<f64>(state.scheduledBlockWords);
	object["scheduledBlockCycles"] = encodeScalar<f64>(state.scheduledBlockCycles);
	object["scheduledReadAddressWord"] = encodeScalar<f64>(state.scheduledReadAddressWord);
	object["scheduledWriteAddressWord"] = encodeScalar<f64>(state.scheduledWriteAddressWord);
	object["scheduledTransferCountWord"] = encodeScalar<f64>(state.scheduledTransferCountWord);
	object["scheduledControlWord"] = encodeScalar<f64>(state.scheduledControlWord);
	object["supervisorQuiesceRequested"] = state.supervisorQuiesceRequested;
	object["supervisorAdmissionQuiesceRequested"] = state.supervisorAdmissionQuiesceRequested;
	object["userChannels"] = encodeFixedArray(state.userChannels, encodeDmaChannelState);
	object["userNextChannel"] = encodeScalar<f64>(state.userNextChannel);
	return BinValue(std::move(object));
}

DmaControllerState decodeDmaControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinArray& channels = requireArray(requireField(object, "channels", label), "machine.dma.channels");
	const BinArray& userChannels = requireArray(requireField(object, "userChannels", label), "machine.dma.userChannels");
	if (channels.size() != IO_DMA_CHANNEL_COUNT || userChannels.size() != IO_DMA_CHANNEL_COUNT) {
		throw BMSX_RUNTIME_ERROR("machine.dma must contain two DMA channels.");
	}
	DmaControllerState state;
	for (u32 channel = 0u; channel < IO_DMA_CHANNEL_COUNT; channel += 1u) {
		state.channels[channel] = decodeDmaChannelState(channels[channel], "machine.dma.channels[]");
		state.userChannels[channel] = decodeDmaChannelState(userChannels[channel], "machine.dma.userChannels[]");
	}
	state.activeChannel = requireBoundedU32(requireField(object, "activeChannel", label), "machine.dma.activeChannel", 0u, IO_DMA_CHANNEL_COUNT);
	state.nextChannel = requireBoundedU32(requireField(object, "nextChannel", label), "machine.dma.nextChannel", 0u, IO_DMA_CHANNEL_COUNT - 1u);
	state.scheduledBlockWords = requireBoundedU32(requireField(object, "scheduledBlockWords", label), "machine.dma.scheduledBlockWords", 0u, 16u);
	state.scheduledBlockCycles = requireI64(requireField(object, "scheduledBlockCycles", label), "machine.dma.scheduledBlockCycles");
	state.scheduledReadAddressWord = requireU32(requireField(object, "scheduledReadAddressWord", label), "machine.dma.scheduledReadAddressWord");
	state.scheduledWriteAddressWord = requireU32(requireField(object, "scheduledWriteAddressWord", label), "machine.dma.scheduledWriteAddressWord");
	state.scheduledTransferCountWord = requireU32(requireField(object, "scheduledTransferCountWord", label), "machine.dma.scheduledTransferCountWord");
	state.scheduledControlWord = requireU32(requireField(object, "scheduledControlWord", label), "machine.dma.scheduledControlWord");
	state.supervisorQuiesceRequested = requireBool(requireField(object, "supervisorQuiesceRequested", label), "machine.dma.supervisorQuiesceRequested");
	state.supervisorAdmissionQuiesceRequested = requireBool(requireField(object, "supervisorAdmissionQuiesceRequested", label), "machine.dma.supervisorAdmissionQuiesceRequested");
	state.userNextChannel = requireBoundedU32(requireField(object, "userNextChannel", label), "machine.dma.userNextChannel", 0u, IO_DMA_CHANNEL_COUNT - 1u);
	return state;
}

BinValue encodeImgDecControllerState(const ImgDecControllerState& state) {
	BinObject object;
	object["inputWordCountWord"] = encodeScalar<f64>(state.inputWordCountWord);
	object["textureDestinationWord"] = encodeScalar<f64>(state.textureDestinationWord);
	object["textureSizeWord"] = encodeScalar<f64>(state.textureSizeWord);
	object["clutDestinationWord"] = encodeScalar<f64>(state.clutDestinationWord);
	object["controlWord"] = encodeScalar<f64>(state.controlWord);
	object["statusWord"] = encodeScalar<f64>(state.statusWord);
	object["dataWord"] = encodeScalar<f64>(state.dataWord);
	object["inputWordsReceived"] = encodeScalar<f64>(state.inputWordsReceived);
	object["decodedWordCount"] = encodeScalar<f64>(state.decodedWordCount);
	object["textureWordCount"] = encodeScalar<f64>(state.textureWordCount);
	object["clutWordCount"] = encodeScalar<f64>(state.clutWordCount);
	object["outputWordsRead"] = encodeScalar<f64>(state.outputWordsRead);
	object["decodePhase"] = encodeScalar<f64>(state.decodePhase);
	object["outputStage"] = encodeScalar<f64>(state.outputStage);
	object["runWordsRemaining"] = encodeScalar<f64>(state.runWordsRemaining);
	object["repeatWord"] = encodeScalar<f64>(state.repeatWord);
	object["backReferenceDistance"] = encodeScalar<f64>(state.backReferenceDistance);
	object["supervisorQuiesceRequested"] = state.supervisorQuiesceRequested;
	object["inputWords"] = encodeVector(state.inputWords, encodeScalar<i64, u32>);
	object["outputWords"] = encodeVector(state.outputWords, encodeScalar<i64, u32>);
	object["historyWords"] = encodeVector(state.historyWords, encodeScalar<i64, u32>);
	object["scheduledDecodeWords"] = encodeScalar<f64>(state.scheduledDecodeWords);
	object["scheduledDecodeCycles"] = encodeScalar<f64>(state.scheduledDecodeCycles);
	return BinValue(std::move(object));
}

ImgDecControllerState decodeImgDecControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	ImgDecControllerState state;
	state.inputWordCountWord = requireU32(requireField(object, "inputWordCountWord", label), "machine.imgDec.inputWordCountWord");
	state.textureDestinationWord = requireU32(requireField(object, "textureDestinationWord", label), "machine.imgDec.textureDestinationWord");
	state.textureSizeWord = requireU32(requireField(object, "textureSizeWord", label), "machine.imgDec.textureSizeWord");
	state.clutDestinationWord = requireU32(requireField(object, "clutDestinationWord", label), "machine.imgDec.clutDestinationWord");
	state.controlWord = requireU32(requireField(object, "controlWord", label), "machine.imgDec.controlWord");
	state.statusWord = requireU32(requireField(object, "statusWord", label), "machine.imgDec.statusWord");
	state.dataWord = requireU32(requireField(object, "dataWord", label), "machine.imgDec.dataWord");
	state.inputWordsReceived = requireU32(requireField(object, "inputWordsReceived", label), "machine.imgDec.inputWordsReceived");
	state.decodedWordCount = requireU32(requireField(object, "decodedWordCount", label), "machine.imgDec.decodedWordCount");
	state.textureWordCount = requireU32(requireField(object, "textureWordCount", label), "machine.imgDec.textureWordCount");
	state.clutWordCount = requireU32(requireField(object, "clutWordCount", label), "machine.imgDec.clutWordCount");
	state.outputWordsRead = requireU32(requireField(object, "outputWordsRead", label), "machine.imgDec.outputWordsRead");
	state.decodePhase = requireBoundedU32(requireField(object, "decodePhase", label), "machine.imgDec.decodePhase", 0u, 8u);
	state.outputStage = requireBoundedU32(requireField(object, "outputStage", label), "machine.imgDec.outputStage", 0u, 4u);
	state.runWordsRemaining = requireU32(requireField(object, "runWordsRemaining", label), "machine.imgDec.runWordsRemaining");
	state.repeatWord = requireU32(requireField(object, "repeatWord", label), "machine.imgDec.repeatWord");
	state.backReferenceDistance = requireBoundedU32(requireField(object, "backReferenceDistance", label), "machine.imgDec.backReferenceDistance", 0u, IMGDEC_HISTORY_WORD_CAPACITY);
	state.supervisorQuiesceRequested = requireBool(requireField(object, "supervisorQuiesceRequested", label), "machine.imgDec.supervisorQuiesceRequested");
	state.inputWords = decodeU32VectorWithMaxLength(requireField(object, "inputWords", label), "machine.imgDec.inputWords", IMGDEC_INPUT_FIFO_WORD_CAPACITY);
	state.outputWords = decodeU32VectorWithMaxLength(requireField(object, "outputWords", label), "machine.imgDec.outputWords", IMGDEC_OUTPUT_FIFO_WORD_CAPACITY);
	state.historyWords = decodeU32VectorWithMaxLength(requireField(object, "historyWords", label), "machine.imgDec.historyWords", IMGDEC_HISTORY_WORD_CAPACITY);
	state.scheduledDecodeWords = requireBoundedU32(requireField(object, "scheduledDecodeWords", label), "machine.imgDec.scheduledDecodeWords", 0u, IMGDEC_DECODE_BATCH_WORDS);
	state.scheduledDecodeCycles = requireI64(requireField(object, "scheduledDecodeCycles", label), "machine.imgDec.scheduledDecodeCycles");
	return state;
}

BinValue encodeSystemControllerState(const SystemControllerState& state) {
	BinObject object;
	object["resetRequested"] = state.resetRequested;
	object["supervisorPhase"] = static_cast<i64>(state.supervisorPhase);
	object["supervisorTransitionTarget"] = static_cast<i64>(state.supervisorTransitionTarget);
	object["supervisorResumable"] = state.supervisorResumable;
	object["supervisorExitRequested"] = state.supervisorExitRequested;
	object["printBuffer"] = BinValue(BinBinary(state.printBuffer.begin(), state.printBuffer.end()));
	object["printReadIndex"] = static_cast<i64>(state.printReadIndex);
	object["printByteCount"] = static_cast<i64>(state.printByteCount);
	return BinValue(std::move(object));
}

SystemControllerState decodeSystemControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	SystemControllerState state;
	state.resetRequested = requireBool(requireField(object, "resetRequested", label), "machineState.machine.systemControl.resetRequested");
	state.supervisorPhase = static_cast<u8>(requireBoundedU32(requireField(object, "supervisorPhase", label), "machineState.machine.systemControl.supervisorPhase", SYSTEM_SUPERVISOR_PHASE_USER, SYSTEM_SUPERVISOR_PHASE_GPU_QUIESCE));
	state.supervisorTransitionTarget = static_cast<u8>(requireBoundedU32(requireField(object, "supervisorTransitionTarget", label), "machineState.machine.systemControl.supervisorTransitionTarget", SYSTEM_SUPERVISOR_TARGET_USER, SYSTEM_SUPERVISOR_TARGET_SUPERVISOR));
	state.supervisorResumable = requireBool(requireField(object, "supervisorResumable", label), "machineState.machine.systemControl.supervisorResumable");
	state.supervisorExitRequested = requireBool(requireField(object, "supervisorExitRequested", label), "machineState.machine.systemControl.supervisorExitRequested");
	const BinBinary& printBuffer = requireBinaryWithLength(requireField(object, "printBuffer", label), "machineState.machine.systemControl.printBuffer", SYS_PRINT_BUFFER_BYTES);
	std::copy(printBuffer.begin(), printBuffer.end(), state.printBuffer.begin());
	state.printReadIndex = requireBoundedU32(requireField(object, "printReadIndex", label), "machineState.machine.systemControl.printReadIndex", 0u, SYS_PRINT_BUFFER_BYTES - 1u);
	state.printByteCount = requireBoundedU32(requireField(object, "printByteCount", label), "machineState.machine.systemControl.printByteCount", 0u, SYS_PRINT_BUFFER_BYTES);
	return state;
}

BinValue encodeMachineSaveState(const MachineSaveState& state) {
	BinObject object;
	object["memory"] = encodeMemorySaveState(state.memory);
	object["cartridge"] = encodeCartridgeControllerState(state.cartridge);
	object["dma"] = encodeDmaControllerState(state.dma);
	object["geometry"] = encodeGeometryControllerState(state.geometry);
	object["gxGpu"] = encodeGxGpuSaveState(state.gxGpu);
	object["gxGte"] = encodeGxGteState(state.gxGte);
	object["irq"] = encodeIrqControllerState(state.irq);
	object["audio"] = encodeAudioControllerState(state.audio);
	object["stringPool"] = encodeStringPoolState(state.stringPool);
	object["input"] = encodeInputControllerState(state.input);
	object["imgDec"] = encodeImgDecControllerState(state.imgDec);
	object["systemControl"] = encodeSystemControllerState(state.systemControl);
	return BinValue(std::move(object));
}

MachineSaveState decodeMachineSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MachineSaveState state;
	state.memory = decodeMemorySaveState(requireField(object, "memory", label), "machineState.machine.memory");
	state.cartridge = decodeCartridgeControllerState(requireField(object, "cartridge", label), "machineState.machine.cartridge");
	state.dma = decodeDmaControllerState(requireField(object, "dma", label), "machineState.machine.dma");
	state.geometry = decodeGeometryControllerState(requireField(object, "geometry", label), "machineState.machine.geometry");
	state.gxGpu = decodeGxGpuSaveState(requireField(object, "gxGpu", label), "machineState.machine.gxGpu");
	state.gxGte = decodeGxGteState(requireField(object, "gxGte", label), "machineState.machine.gxGte");
	state.irq = decodeIrqControllerState(requireField(object, "irq", label), "machineState.machine.irq");
	state.audio = decodeAudioControllerState(requireField(object, "audio", label), "machineState.machine.audio");
	state.stringPool = decodeStringPoolState(requireField(object, "stringPool", label), "machineState.machine.stringPool");
	state.input = decodeInputControllerState(requireField(object, "input", label), "machineState.machine.input");
	state.imgDec = decodeImgDecControllerState(requireField(object, "imgDec", label), "machineState.machine.imgDec");
	state.systemControl = decodeSystemControllerState(requireField(object, "systemControl", label), "machineState.machine.systemControl");
	return state;
}

BinValue encodeRuntimeSaveMachineState(const RuntimeSaveMachineState& state) {
	BinObject object;
	object["machine"] = encodeMachineSaveState(state.machine);
	object["frameScheduler"] = encodeFrameSchedulerState(state.frameScheduler);
	object["frameLoop"] = encodeFrameLoopState(state.frameLoop);
	object["schedulerNowCycles"] = state.schedulerNowCycles;
	return BinValue(std::move(object));
}

RuntimeSaveMachineState decodeRuntimeSaveMachineState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveMachineState state;
	state.machine = decodeMachineSaveState(requireField(object, "machine", label), "machineState.machine");
	state.frameScheduler = decodeFrameSchedulerState(requireField(object, "frameScheduler", label), "machineState.frameScheduler");
	state.frameLoop = decodeFrameLoopState(requireField(object, "frameLoop", label), "machineState.frameLoop");
	state.schedulerNowCycles = requireI64(requireField(object, "schedulerNowCycles", label), "machineState.schedulerNowCycles");
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
			object["functionAddress"] = static_cast<i64>(state.functionAddress);
			object["canonical"] = state.closureCanonical;
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
		state.functionAddress = requireU32(
			requireField(object, "functionAddress", label),
			"cpuObjectState.functionAddress"
		);
		state.closureCanonical = requireBool(
			requireField(object, "canonical", label),
			"cpuObjectState.canonical"
		);
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
	object["functionAddress"] = static_cast<i64>(state.functionAddress);
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
	object["returnToCompletionLatch"] = state.returnToCompletionLatch;
	object["callSitePc"] = static_cast<i64>(state.callSitePc);
	object["isExceptionFrame"] = state.isExceptionFrame;
	object["isNonMaskableExceptionFrame"] = state.isNonMaskableExceptionFrame;
	return BinValue(std::move(object));
}

CpuFrameState decodeCpuFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuFrameState state;
	state.functionAddress = requireU32(
		requireField(object, "functionAddress", label),
		"cpuFrameState.functionAddress"
	);
	state.pc = requireU32(requireField(object, "pc", label), "cpuFrameState.pc");
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
	state.returnToCompletionLatch = requireBool(requireField(object, "returnToCompletionLatch", label), "cpuFrameState.returnToCompletionLatch");
	state.callSitePc = requireU32(requireField(object, "callSitePc", label), "cpuFrameState.callSitePc");
	state.isExceptionFrame = requireBool(requireField(object, "isExceptionFrame", label), "cpuFrameState.isExceptionFrame");
	state.isNonMaskableExceptionFrame = requireBool(requireField(object, "isNonMaskableExceptionFrame", label), "cpuFrameState.isNonMaskableExceptionFrame");
	return state;
}

BinValue encodeCpuProtectedCallState(const CpuProtectedCallState& state) {
	BinObject object;
	object["kind"] = static_cast<i64>(state.kind);
	object["callerFrameIndex"] = static_cast<i64>(state.callerFrameIndex);
	object["targetFrameIndex"] = static_cast<i64>(state.targetFrameIndex);
	object["returnsToProtectedParent"] = state.returnsToProtectedParent;
	object["callBase"] = static_cast<i64>(state.callBase);
	object["returnCount"] = static_cast<i64>(state.returnCount);
	object["handlerRegister"] = static_cast<i64>(state.handlerRegister);
	return BinValue(std::move(object));
}

CpuProtectedCallState decodeCpuProtectedCallState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuProtectedCallState state;
	state.kind = static_cast<ProtectedCallKind>(requireI32(requireField(object, "kind", label), "cpuProtectedCallState.kind"));
	state.callerFrameIndex = requireI32(requireField(object, "callerFrameIndex", label), "cpuProtectedCallState.callerFrameIndex");
	state.targetFrameIndex = requireI32(requireField(object, "targetFrameIndex", label), "cpuProtectedCallState.targetFrameIndex");
	state.returnsToProtectedParent = requireBool(requireField(object, "returnsToProtectedParent", label), "cpuProtectedCallState.returnsToProtectedParent");
	state.callBase = requireI32(requireField(object, "callBase", label), "cpuProtectedCallState.callBase");
	state.returnCount = requireI32(requireField(object, "returnCount", label), "cpuProtectedCallState.returnCount");
	state.handlerRegister = requireI32(requireField(object, "handlerRegister", label), "cpuProtectedCallState.handlerRegister");
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
	object["executionCartridgeSlot"] = static_cast<i64>(state.executionCartridgeSlot);
	object["systemGlobals"] = encodeVector(state.systemGlobals, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["globals"] = encodeVector(state.globals, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["frames"] = encodeVector(state.frames, [](const CpuFrameState& value) {
		return encodeCpuFrameState(value);
	});
	object["protectedCalls"] = encodeVector(state.protectedCalls, [](const CpuProtectedCallState& value) {
		return encodeCpuProtectedCallState(value);
	});
	object["completionValues"] = encodeVector(state.completionValues, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["objects"] = encodeVector(state.objects, [](const CpuObjectState& value) {
		return encodeCpuObjectState(value);
	});
	object["openUpvalues"] = encodeVector(state.openUpvalues, [](int value) {
		return BinValue(static_cast<i64>(value));
	});
	object["lastExecutionDomainId"] = static_cast<i64>(state.lastExecutionDomainId);
	object["lastPc"] = static_cast<i64>(state.lastPc);
	object["instructionBudgetRemaining"] = static_cast<i64>(state.instructionBudgetRemaining);
	object["haltedUntilIrq"] = state.haltedUntilIrq;
	object["interruptEventPending"] = state.interruptEventPending;
	object["memoryWriteBlocked"] = state.memoryWriteBlocked;
	object["memoryWriteBlockedAddress"] = static_cast<i64>(state.memoryWriteBlockedAddress);
	object["statusWord"] = static_cast<i64>(state.statusWord);
	object["causeWord"] = static_cast<i64>(state.causeWord);
	object["epcWord"] = static_cast<i64>(state.epcWord);
	object["badAddressWord"] = static_cast<i64>(state.badAddressWord);
	object["luaFaultReasonWord"] = static_cast<i64>(state.luaFaultReasonWord);
	object["nmiReturnCauseWord"] = static_cast<i64>(state.nmiReturnCauseWord);
	object["nmiReturnEpcWord"] = static_cast<i64>(state.nmiReturnEpcWord);
	object["nmiReturnBadAddressWord"] = static_cast<i64>(state.nmiReturnBadAddressWord);
	object["nmiReturnLuaFaultReasonWord"] = static_cast<i64>(state.nmiReturnLuaFaultReasonWord);
	object["nonMaskableInterruptPending"] = state.nonMaskableInterruptPending;
	object["yieldRequested"] = state.yieldRequested;
	return BinValue(std::move(object));
}

CpuRuntimeState decodeCpuRuntimeState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuRuntimeState state;
	state.executionCartridgeSlot = requireI32(
		requireField(object, "executionCartridgeSlot", label),
		"cpuState.executionCartridgeSlot"
	);
	state.systemGlobals = decodeVector<CpuRootValueState>(requireField(object, "systemGlobals", label), "cpuState.systemGlobals",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.systemGlobals[]");
		});
	state.globals = decodeVector<CpuRootValueState>(requireField(object, "globals", label), "cpuState.globals",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.globals[]");
		});
	state.frames = decodeVector<CpuFrameState>(requireField(object, "frames", label), "cpuState.frames",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuFrameState(entryValue, "cpuState.frames[]");
		});
	state.protectedCalls = decodeVector<CpuProtectedCallState>(requireField(object, "protectedCalls", label), "cpuState.protectedCalls",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuProtectedCallState(entryValue, "cpuState.protectedCalls[]");
		});
	state.completionValues = decodeVector<CpuValueState>(requireField(object, "completionValues", label), "cpuState.completionValues",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuState.completionValues[]");
		});
	state.objects = decodeVector<CpuObjectState>(requireField(object, "objects", label), "cpuState.objects",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuObjectState(entryValue, "cpuState.objects[]");
		});
	state.openUpvalues = decodeVector<int>(requireField(object, "openUpvalues", label), "cpuState.openUpvalues",
		[](const BinValue& entryValue, size_t) {
			return requireI32(entryValue, "cpuState.openUpvalues[]");
		});
	state.lastExecutionDomainId = requireI32(
		requireField(object, "lastExecutionDomainId", label),
		"cpuState.lastExecutionDomainId"
	);
	state.lastPc = requireU32(requireField(object, "lastPc", label), "cpuState.lastPc");
	state.instructionBudgetRemaining = requireI32(requireField(object, "instructionBudgetRemaining", label), "cpuState.instructionBudgetRemaining");
	state.haltedUntilIrq = requireBool(requireField(object, "haltedUntilIrq", label), "cpuState.haltedUntilIrq");
	state.interruptEventPending = requireBool(requireField(object, "interruptEventPending", label), "cpuState.interruptEventPending");
	state.memoryWriteBlocked = requireBool(requireField(object, "memoryWriteBlocked", label), "cpuState.memoryWriteBlocked");
	state.memoryWriteBlockedAddress = requireU32(requireField(object, "memoryWriteBlockedAddress", label), "cpuState.memoryWriteBlockedAddress");
	state.statusWord = requireU32(requireField(object, "statusWord", label), "cpuState.statusWord");
	state.causeWord = requireU32(requireField(object, "causeWord", label), "cpuState.causeWord");
	state.epcWord = requireU32(requireField(object, "epcWord", label), "cpuState.epcWord");
	state.badAddressWord = requireU32(requireField(object, "badAddressWord", label), "cpuState.badAddressWord");
	state.luaFaultReasonWord = requireU32(requireField(object, "luaFaultReasonWord", label), "cpuState.luaFaultReasonWord");
	state.nmiReturnCauseWord = requireU32(requireField(object, "nmiReturnCauseWord", label), "cpuState.nmiReturnCauseWord");
	state.nmiReturnEpcWord = requireU32(requireField(object, "nmiReturnEpcWord", label), "cpuState.nmiReturnEpcWord");
	state.nmiReturnBadAddressWord = requireU32(requireField(object, "nmiReturnBadAddressWord", label), "cpuState.nmiReturnBadAddressWord");
	state.nmiReturnLuaFaultReasonWord = requireU32(requireField(object, "nmiReturnLuaFaultReasonWord", label), "cpuState.nmiReturnLuaFaultReasonWord");
	state.nonMaskableInterruptPending = requireBool(requireField(object, "nonMaskableInterruptPending", label), "cpuState.nonMaskableInterruptPending");
	state.yieldRequested = requireBool(requireField(object, "yieldRequested", label), "cpuState.yieldRequested");
	return state;
}

BinValue encodeRuntimeSaveStateValue(const RuntimeSaveState& state) {
	BinObject object;
	object["machineState"] = encodeRuntimeSaveMachineState(state.machineState);
	object["cpuState"] = encodeCpuRuntimeState(state.cpuState);
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
	state.luaInitialized = requireBool(requireField(object, "luaInitialized", label), "runtimeSaveState.luaInitialized");
	state.luaRuntimeFailed = requireBool(requireField(object, "luaRuntimeFailed", label), "runtimeSaveState.luaRuntimeFailed");
	state.pendingEntryCall = requireBool(requireField(object, "pendingEntryCall", label), "runtimeSaveState.pendingEntryCall");
	return state;
}

} // namespace

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state) {
	std::vector<u8> bytes = encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
	size_t cartridgeRamByteCount = 0u;
	for (const CartridgeSlotState& slot : state.machineState.machine.cartridge.slots) {
		cartridgeRamByteCount += slot.ram.size();
	}
	if (bytes.size() > runtimeSaveStateWireCapacity(cartridgeRamByteCount)) {
		throw BMSX_RUNTIME_ERROR("Runtime save-state payload exceeds the current-format wire capacity.");
	}
	return bytes;
}

RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size, size_t cartridgeRamByteCount) {
	if (size > runtimeSaveStateWireCapacity(cartridgeRamByteCount)) {
		throw BMSX_RUNTIME_ERROR("Runtime save-state payload exceeds the current-format wire capacity.");
	}
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(data, size, RUNTIME_SAVE_STATE_PROP_NAMES),
		"runtimeSaveState");
}

RuntimeSaveState decodeRuntimeSaveState(const std::vector<u8>& data, size_t cartridgeRamByteCount) {
	return decodeRuntimeSaveState(data.data(), data.size(), cartridgeRamByteCount);
}

// disable-next-line single_line_method_pattern -- byte save-state API composes capture and binary encoding at the public boundary.
std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime) {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

// disable-next-line single_line_method_pattern -- byte save-state API composes binary decoding and runtime restore at the public boundary.
void applyRuntimeSaveStateBytes(Runtime& runtime, const u8* data, size_t size) {
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(data, size, runtime.machine.cartridgeController.ramByteCount()));
}

// disable-next-line single_line_method_pattern -- vector save-state input is the public owner overload for byte payload callers.
void applyRuntimeSaveStateBytes(Runtime& runtime, const std::vector<u8>& data) {
	applyRuntimeSaveStateBytes(runtime, data.data(), data.size());
}

} // namespace bmsx
