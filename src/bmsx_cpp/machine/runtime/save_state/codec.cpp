#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binencoder.h"
#include "machine/devices/input/contracts.h"
#include "machine/memory/map.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/schema.h"
#include <cmath>
#include <limits>
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

BinValue encodeVdpXfState(const VdpXfState& state) {
	BinObject object;
	object["matrixWords"] = encodeFixedArray(state.matrixWords, encodeScalar<i64, u32>);
	object["viewMatrixIndex"] = static_cast<i64>(state.viewMatrixIndex);
	object["projectionMatrixIndex"] = static_cast<i64>(state.projectionMatrixIndex);
	return BinValue(std::move(object));
}

VdpXfState decodeVdpXfState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpXfState state;
	state.matrixWords = decodeU32Array<VDP_XF_MATRIX_REGISTER_WORDS>(requireField(object, "matrixWords", label), "machine.vdp.xf.matrixWords");
	state.viewMatrixIndex = requireU32(requireField(object, "viewMatrixIndex", label), "machine.vdp.xf.viewMatrixIndex");
	state.projectionMatrixIndex = requireU32(requireField(object, "projectionMatrixIndex", label), "machine.vdp.xf.projectionMatrixIndex");
	if (state.viewMatrixIndex >= VDP_XF_MATRIX_COUNT || state.projectionMatrixIndex >= VDP_XF_MATRIX_COUNT) {
		throw BMSX_RUNTIME_ERROR("[save-state] machine.vdp.xf selects invalid matrix indexes.");
	}
	return state;
}

BinValue encodeTickCompletion(const TickCompletion& state) {
	BinObject object;
	object["sequence"] = static_cast<i64>(state.sequence);
	object["remaining"] = static_cast<i64>(state.remaining);
	object["visualCommitted"] = state.visualCommitted;
	object["vdpFrameCost"] = static_cast<i64>(state.vdpFrameCost);
	object["vdpFrameHeld"] = state.vdpFrameHeld;
	return BinValue(std::move(object));
}

TickCompletion decodeTickCompletion(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	TickCompletion state;
	state.sequence = requireI64(requireField(object, "sequence", label), "tickCompletion.sequence");
	state.remaining = requireI32(requireField(object, "remaining", label), "tickCompletion.remaining");
	state.visualCommitted = requireBool(requireField(object, "visualCommitted", label), "tickCompletion.visualCommitted");
	state.vdpFrameCost = requireI32(requireField(object, "vdpFrameCost", label), "tickCompletion.vdpFrameCost");
	state.vdpFrameHeld = requireBool(requireField(object, "vdpFrameHeld", label), "tickCompletion.vdpFrameHeld");
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
	object["lastTickVdpFrameCost"] = static_cast<i64>(state.lastTickVdpFrameCost);
	object["lastTickVdpFrameHeld"] = state.lastTickVdpFrameHeld;
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
	state.lastTickVdpFrameCost = requireI32(requireField(object, "lastTickVdpFrameCost", label), "frameScheduler.lastTickVdpFrameCost");
	state.lastTickVdpFrameHeld = requireBool(requireField(object, "lastTickVdpFrameHeld", label), "frameScheduler.lastTickVdpFrameHeld");
	state.lastTickCompleted = requireBool(requireField(object, "lastTickCompleted", label), "frameScheduler.lastTickCompleted");
	state.lastTickConsumedSequence = requireI64(requireField(object, "lastTickConsumedSequence", label), "frameScheduler.lastTickConsumedSequence");
	return state;
}

BinValue encodeRuntimeVblankState(const RuntimeVblankSnapshot& state) {
	BinObject object;
	object["cyclesIntoFrame"] = static_cast<i64>(state.cyclesIntoFrame);
	return BinValue(std::move(object));
}

RuntimeVblankSnapshot decodeRuntimeVblankState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeVblankSnapshot state;
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
	state.busFaultCode = requireU32(requireField(object, "busFaultCode", label), "machine.memory.busFaultCode");
	state.busFaultAddr = requireU32(requireField(object, "busFaultAddr", label), "machine.memory.busFaultAddr");
	state.busFaultAccess = requireU32(requireField(object, "busFaultAccess", label), "machine.memory.busFaultAccess");
	return state;
}

BinValue encodeIrqControllerState(const IrqControllerState& state) {
	BinObject object;
	object["pendingFlags"] = static_cast<f64>(state.pendingFlags);
	return BinValue(std::move(object));
}

IrqControllerState decodeIrqControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	IrqControllerState state;
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
	registers["player"] = static_cast<i64>(state.registers.player);
	registers["actionStringId"] = static_cast<i64>(state.registers.actionStringId);
	registers["bindStringId"] = static_cast<i64>(state.registers.bindStringId);
	registers["ctrl"] = static_cast<i64>(state.registers.ctrl);
	registers["queryStringId"] = static_cast<i64>(state.registers.queryStringId);
	registers["status"] = static_cast<i64>(state.registers.status);
	registers["value"] = static_cast<i64>(state.registers.value);
	registers["consumeStringId"] = static_cast<i64>(state.registers.consumeStringId);
	registers["outputIntensityQ16"] = static_cast<i64>(state.registers.outputIntensityQ16);
	registers["outputDurationMs"] = static_cast<i64>(state.registers.outputDurationMs);
	object["registers"] = BinValue(std::move(registers));
	object["players"] = encodeFixedArray(state.players, [](const InputControllerPlayerState& player) {
		BinObject playerObject;
		playerObject["actions"] = encodeVector(player.actions, [](const InputControllerActionState& action) {
			BinObject actionObject;
			actionObject["actionStringId"] = static_cast<i64>(action.actionStringId);
			actionObject["bindStringId"] = static_cast<i64>(action.bindStringId);
			actionObject["statusWord"] = static_cast<i64>(action.statusWord);
			actionObject["valueQ16"] = static_cast<i64>(action.valueQ16);
			actionObject["pressTime"] = action.pressTime;
			actionObject["repeatCount"] = static_cast<i64>(action.repeatCount);
			return BinValue(std::move(actionObject));
		});
		return BinValue(std::move(playerObject));
	});
	object["eventFifoEvents"] = encodeVector(state.eventFifoEvents, [](const InputControllerEventState& event) {
		BinObject eventObject;
		eventObject["player"] = static_cast<i64>(event.player);
		eventObject["actionStringId"] = static_cast<i64>(event.actionStringId);
		eventObject["statusWord"] = static_cast<i64>(event.statusWord);
		eventObject["valueQ16"] = static_cast<i64>(event.valueQ16);
		eventObject["repeatCount"] = static_cast<i64>(event.repeatCount);
		return BinValue(std::move(eventObject));
	});
	object["eventFifoOverflow"] = state.eventFifoOverflow;
	return BinValue(std::move(object));
}

InputControllerState decodeInputControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinObject& registers = requireObject(requireField(object, "registers", label), "machine.input.registers");
	InputControllerState state;
	state.sampleArmed = requireBool(requireField(object, "sampleArmed", label), "machine.input.sampleArmed");
	state.sampleSequence = requireU32(requireField(object, "sampleSequence", label), "machine.input.sampleSequence");
	state.lastSampleCycle = requireU32(requireField(object, "lastSampleCycle", label), "machine.input.lastSampleCycle");
	state.registers.player = requireU32(requireField(registers, "player", "machine.input.registers"), "machine.input.registers.player");
	state.registers.actionStringId = requireU32(requireField(registers, "actionStringId", "machine.input.registers"), "machine.input.registers.actionStringId");
	state.registers.bindStringId = requireU32(requireField(registers, "bindStringId", "machine.input.registers"), "machine.input.registers.bindStringId");
	state.registers.ctrl = requireU32(requireField(registers, "ctrl", "machine.input.registers"), "machine.input.registers.ctrl");
	state.registers.queryStringId = requireU32(requireField(registers, "queryStringId", "machine.input.registers"), "machine.input.registers.queryStringId");
	state.registers.status = requireU32(requireField(registers, "status", "machine.input.registers"), "machine.input.registers.status");
	state.registers.value = requireU32(requireField(registers, "value", "machine.input.registers"), "machine.input.registers.value");
	state.registers.consumeStringId = requireU32(requireField(registers, "consumeStringId", "machine.input.registers"), "machine.input.registers.consumeStringId");
	state.registers.outputIntensityQ16 = requireU32(requireField(registers, "outputIntensityQ16", "machine.input.registers"), "machine.input.registers.outputIntensityQ16");
	state.registers.outputDurationMs = requireU32(requireField(registers, "outputDurationMs", "machine.input.registers"), "machine.input.registers.outputDurationMs");
	const BinArray& players = requireArray(requireField(object, "players", label), "machine.input.players");
	if (players.size() != state.players.size()) {
		throw BMSX_RUNTIME_ERROR("machine.input.players must contain " + std::to_string(state.players.size()) + " player entries.");
	}
	for (size_t playerIndex = 0; playerIndex < state.players.size(); playerIndex += 1) {
		const BinObject& player = requireObject(players[playerIndex], "machine.input.players[]");
		state.players[playerIndex].actions = decodeVector<InputControllerActionState>(
			requireField(player, "actions", "machine.input.players[]"),
			"machine.input.players[].actions",
			[](const BinValue& actionValue, size_t) {
				const BinObject& action = requireObject(actionValue, "machine.input.players[].actions[]");
				InputControllerActionState stateAction;
				stateAction.actionStringId = requireU32(requireField(action, "actionStringId", "machine.input.players[].actions[]"), "machine.input.players[].actions[].actionStringId");
				stateAction.bindStringId = requireU32(requireField(action, "bindStringId", "machine.input.players[].actions[]"), "machine.input.players[].actions[].bindStringId");
				stateAction.statusWord = requireU32(requireField(action, "statusWord", "machine.input.players[].actions[]"), "machine.input.players[].actions[].statusWord");
				stateAction.valueQ16 = requireU32(requireField(action, "valueQ16", "machine.input.players[].actions[]"), "machine.input.players[].actions[].valueQ16");
				stateAction.pressTime = requireNumber(requireField(action, "pressTime", "machine.input.players[].actions[]"), "machine.input.players[].actions[].pressTime");
				stateAction.repeatCount = requireU32(requireField(action, "repeatCount", "machine.input.players[].actions[]"), "machine.input.players[].actions[].repeatCount");
				return stateAction;
			}
		);
	}
	state.eventFifoEvents = decodeVector<InputControllerEventState>(
		requireField(object, "eventFifoEvents", label),
		"machine.input.eventFifoEvents",
		[](const BinValue& eventValue, size_t) {
			const BinObject& event = requireObject(eventValue, "machine.input.eventFifoEvents[]");
			InputControllerEventState stateEvent;
			stateEvent.player = requireU32(requireField(event, "player", "machine.input.eventFifoEvents[]"), "machine.input.eventFifoEvents[].player");
			stateEvent.actionStringId = requireU32(requireField(event, "actionStringId", "machine.input.eventFifoEvents[]"), "machine.input.eventFifoEvents[].actionStringId");
			stateEvent.statusWord = requireU32(requireField(event, "statusWord", "machine.input.eventFifoEvents[]"), "machine.input.eventFifoEvents[].statusWord");
			stateEvent.valueQ16 = requireU32(requireField(event, "valueQ16", "machine.input.eventFifoEvents[]"), "machine.input.eventFifoEvents[].valueQ16");
			stateEvent.repeatCount = requireU32(requireField(event, "repeatCount", "machine.input.eventFifoEvents[]"), "machine.input.eventFifoEvents[].repeatCount");
			return stateEvent;
		}
	);
	if (state.eventFifoEvents.size() > INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) {
		throw BMSX_RUNTIME_ERROR("machine.input.eventFifoEvents must contain at most " + std::to_string(INPUT_CONTROLLER_EVENT_FIFO_CAPACITY) + " entries.");
	}
	state.eventFifoOverflow = requireBool(requireField(object, "eventFifoOverflow", label), "machine.input.eventFifoOverflow");
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

template<typename Source>
BinValue encodeVdpSourceState(const Source& state) {
	return BinValue(BinObject{
		{"surfaceId", static_cast<i64>(state.surfaceId)},
		{"srcX", static_cast<i64>(state.srcX)},
		{"srcY", static_cast<i64>(state.srcY)},
		{"width", static_cast<i64>(state.width)},
		{"height", static_cast<i64>(state.height)},
	});
}

template<typename Source>
Source decodeVdpSourceState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	return Source{
		requireU32(requireField(object, "surfaceId", label), "machine.vdp.source.surfaceId"),
		requireU32(requireField(object, "srcX", label), "machine.vdp.source.srcX"),
		requireU32(requireField(object, "srcY", label), "machine.vdp.source.srcY"),
		requireU32(requireField(object, "width", label), "machine.vdp.source.width"),
		requireU32(requireField(object, "height", label), "machine.vdp.source.height"),
	};
}

BinValue encodeGlyphRunGlyphState(const VdpGlyphRunGlyphSaveState& state) {
	BinObject object = encodeVdpSourceState(state).asObject();
	object["dstX"] = static_cast<f64>(state.dstX);
	object["dstY"] = static_cast<f64>(state.dstY);
	object["advance"] = static_cast<i64>(state.advance);
	return BinValue(std::move(object));
}

VdpGlyphRunGlyphSaveState decodeGlyphRunGlyphState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpGlyphRunGlyphSaveState state;
	static_cast<VdpBlitterSourceSaveState&>(state) = decodeVdpSourceState<VdpBlitterSourceSaveState>(value, label);
	state.dstX = static_cast<f32>(requireNumber(requireField(object, "dstX", label), "machine.vdp.glyph.dstX"));
	state.dstY = static_cast<f32>(requireNumber(requireField(object, "dstY", label), "machine.vdp.glyph.dstY"));
	state.advance = requireU32(requireField(object, "advance", label), "machine.vdp.glyph.advance");
	return state;
}

BinValue encodeTileRunBlitState(const VdpTileRunBlitSaveState& state) {
	BinObject object = encodeVdpSourceState(state).asObject();
	object["dstX"] = static_cast<f64>(state.dstX);
	object["dstY"] = static_cast<f64>(state.dstY);
	return BinValue(std::move(object));
}

VdpTileRunBlitSaveState decodeTileRunBlitState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpTileRunBlitSaveState state;
	static_cast<VdpBlitterSourceSaveState&>(state) = decodeVdpSourceState<VdpBlitterSourceSaveState>(value, label);
	state.dstX = static_cast<f32>(requireNumber(requireField(object, "dstX", label), "machine.vdp.tile.dstX"));
	state.dstY = static_cast<f32>(requireNumber(requireField(object, "dstY", label), "machine.vdp.tile.dstY"));
	return state;
}

VdpBlitterCommandType decodeBlitterCommandType(u32 opcode, const char* label) {
	switch (opcode) {
		case static_cast<u32>(VdpBlitterCommandType::Clear): return VdpBlitterCommandType::Clear;
		case static_cast<u32>(VdpBlitterCommandType::Blit): return VdpBlitterCommandType::Blit;
		case static_cast<u32>(VdpBlitterCommandType::CopyRect): return VdpBlitterCommandType::CopyRect;
		case static_cast<u32>(VdpBlitterCommandType::FillRect): return VdpBlitterCommandType::FillRect;
		case static_cast<u32>(VdpBlitterCommandType::DrawLine): return VdpBlitterCommandType::DrawLine;
		case static_cast<u32>(VdpBlitterCommandType::GlyphRun): return VdpBlitterCommandType::GlyphRun;
		case static_cast<u32>(VdpBlitterCommandType::TileRun): return VdpBlitterCommandType::TileRun;
		default:
			throw BMSX_RUNTIME_ERROR(std::string(label) + " has an invalid VDP blitter opcode.");
	}
}

BinValue encodeBlitterCommandState(const VdpBlitterCommandSaveState& state) {
	BinObject object;
	object["opcode"] = static_cast<i64>(static_cast<u32>(state.opcode));
	object["seq"] = static_cast<i64>(state.seq);
	object["renderCost"] = static_cast<i64>(state.renderCost);
	object["layer"] = static_cast<i64>(static_cast<u32>(state.layer));
	object["priority"] = static_cast<f64>(state.priority);
	object["source"] = encodeVdpSourceState(state.source);
	object["dstX"] = static_cast<f64>(state.dstX);
	object["dstY"] = static_cast<f64>(state.dstY);
	object["scaleX"] = static_cast<f64>(state.scaleX);
	object["scaleY"] = static_cast<f64>(state.scaleY);
	object["flipH"] = state.flipH;
	object["flipV"] = state.flipV;
	object["color"] = static_cast<i64>(state.color);
	object["parallaxWeight"] = static_cast<f64>(state.parallaxWeight);
	object["srcX"] = static_cast<i64>(state.srcX);
	object["srcY"] = static_cast<i64>(state.srcY);
	object["width"] = static_cast<i64>(state.width);
	object["height"] = static_cast<i64>(state.height);
	object["x0"] = static_cast<f64>(state.x0);
	object["y0"] = static_cast<f64>(state.y0);
	object["x1"] = static_cast<f64>(state.x1);
	object["y1"] = static_cast<f64>(state.y1);
	object["thickness"] = static_cast<f64>(state.thickness);
	object["hasBackgroundColor"] = state.hasBackgroundColor;
	object["backgroundColor"] = static_cast<i64>(state.backgroundColor);
	object["lineHeight"] = static_cast<i64>(state.lineHeight);
	object["glyphs"] = encodeVector<VdpGlyphRunGlyphSaveState>(state.glyphs, encodeGlyphRunGlyphState);
	object["tiles"] = encodeVector<VdpTileRunBlitSaveState>(state.tiles, encodeTileRunBlitState);
	return BinValue(std::move(object));
}

VdpBlitterCommandSaveState decodeBlitterCommandState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpBlitterCommandSaveState state;
	state.opcode = decodeBlitterCommandType(requireU32(requireField(object, "opcode", label), "machine.vdp.command.opcode"), label);
	state.seq = requireU32(requireField(object, "seq", label), "machine.vdp.command.seq");
	state.renderCost = requireI32(requireField(object, "renderCost", label), "machine.vdp.command.renderCost");
	state.layer = static_cast<Layer2D>(requireBoundedU32(requireField(object, "layer", label), "machine.vdp.command.layer", 0u, 0xffu));
	state.priority = static_cast<f32>(requireNumber(requireField(object, "priority", label), "machine.vdp.command.priority"));
	state.source = decodeVdpSourceState<VdpBlitterSourceSaveState>(requireField(object, "source", label), "machine.vdp.command.source");
	state.dstX = static_cast<f32>(requireNumber(requireField(object, "dstX", label), "machine.vdp.command.dstX"));
	state.dstY = static_cast<f32>(requireNumber(requireField(object, "dstY", label), "machine.vdp.command.dstY"));
	state.scaleX = static_cast<f32>(requireNumber(requireField(object, "scaleX", label), "machine.vdp.command.scaleX"));
	state.scaleY = static_cast<f32>(requireNumber(requireField(object, "scaleY", label), "machine.vdp.command.scaleY"));
	state.flipH = requireBool(requireField(object, "flipH", label), "machine.vdp.command.flipH");
	state.flipV = requireBool(requireField(object, "flipV", label), "machine.vdp.command.flipV");
	state.color = requireU32(requireField(object, "color", label), "machine.vdp.command.color");
	state.parallaxWeight = static_cast<f32>(requireNumber(requireField(object, "parallaxWeight", label), "machine.vdp.command.parallaxWeight"));
	state.srcX = requireI32(requireField(object, "srcX", label), "machine.vdp.command.srcX");
	state.srcY = requireI32(requireField(object, "srcY", label), "machine.vdp.command.srcY");
	state.width = requireI32(requireField(object, "width", label), "machine.vdp.command.width");
	state.height = requireI32(requireField(object, "height", label), "machine.vdp.command.height");
	state.x0 = static_cast<f32>(requireNumber(requireField(object, "x0", label), "machine.vdp.command.x0"));
	state.y0 = static_cast<f32>(requireNumber(requireField(object, "y0", label), "machine.vdp.command.y0"));
	state.x1 = static_cast<f32>(requireNumber(requireField(object, "x1", label), "machine.vdp.command.x1"));
	state.y1 = static_cast<f32>(requireNumber(requireField(object, "y1", label), "machine.vdp.command.y1"));
	state.thickness = static_cast<f32>(requireNumber(requireField(object, "thickness", label), "machine.vdp.command.thickness"));
	state.hasBackgroundColor = requireBool(requireField(object, "hasBackgroundColor", label), "machine.vdp.command.hasBackgroundColor");
	state.backgroundColor = requireU32(requireField(object, "backgroundColor", label), "machine.vdp.command.backgroundColor");
	state.lineHeight = requireU32(requireField(object, "lineHeight", label), "machine.vdp.command.lineHeight");
	state.glyphs = decodeVector<VdpGlyphRunGlyphSaveState>(
		requireField(object, "glyphs", label),
		"machine.vdp.command.glyphs",
		[](const BinValue& entry, size_t) { return decodeGlyphRunGlyphState(entry, "machine.vdp.command.glyphs[]"); }
	);
	state.tiles = decodeVector<VdpTileRunBlitSaveState>(
		requireField(object, "tiles", label),
		"machine.vdp.command.tiles",
		[](const BinValue& entry, size_t) { return decodeTileRunBlitState(entry, "machine.vdp.command.tiles[]"); }
	);
	return state;
}

std::vector<VdpBlitterCommandSaveState> decodeBlitterCommandStates(const BinValue& value, const char* label) {
	std::vector<VdpBlitterCommandSaveState> commands = decodeVector<VdpBlitterCommandSaveState>(
		value,
		label,
		[](const BinValue& entry, size_t) { return decodeBlitterCommandState(entry, "machine.vdp.commands[]"); }
	);
	if (commands.size() > VDP_BLITTER_FIFO_CAPACITY) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " exceeds the VDP blitter FIFO capacity.");
	}
	size_t glyphCount = 0;
	size_t tileCount = 0;
	for (const VdpBlitterCommandSaveState& command : commands) {
		glyphCount += command.glyphs.size();
		tileCount += command.tiles.size();
	}
	if (glyphCount > VDP_BLITTER_RUN_ENTRY_CAPACITY || tileCount > VDP_BLITTER_RUN_ENTRY_CAPACITY) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " exceeds the VDP blitter run-entry capacity.");
	}
	return commands;
}

BinValue encodeBbuBillboardState(const VdpBbuBillboardSaveState& state) {
	return BinValue(BinObject{
		{"seq", static_cast<i64>(state.seq)},
		{"layer", static_cast<i64>(static_cast<u32>(state.layer))},
		{"priority", static_cast<i64>(state.priority)},
		{"positionX", static_cast<f64>(state.positionX)},
		{"positionY", static_cast<f64>(state.positionY)},
		{"positionZ", static_cast<f64>(state.positionZ)},
		{"size", static_cast<f64>(state.size)},
		{"color", static_cast<i64>(state.color)},
		{"source", encodeVdpSourceState(state.source)},
		{"surfaceWidth", static_cast<i64>(state.surfaceWidth)},
		{"surfaceHeight", static_cast<i64>(state.surfaceHeight)},
		{"slot", static_cast<i64>(state.slot)},
	});
}

VdpBbuBillboardSaveState decodeBbuBillboardState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpBbuBillboardSaveState state;
	state.seq = requireU32(requireField(object, "seq", label), "machine.vdp.billboard.seq");
	state.layer = static_cast<Layer2D>(requireBoundedU32(requireField(object, "layer", label), "machine.vdp.billboard.layer", 0u, 0xffu));
	state.priority = requireU32(requireField(object, "priority", label), "machine.vdp.billboard.priority");
	state.positionX = static_cast<f32>(requireNumber(requireField(object, "positionX", label), "machine.vdp.billboard.positionX"));
	state.positionY = static_cast<f32>(requireNumber(requireField(object, "positionY", label), "machine.vdp.billboard.positionY"));
	state.positionZ = static_cast<f32>(requireNumber(requireField(object, "positionZ", label), "machine.vdp.billboard.positionZ"));
	state.size = static_cast<f32>(requireNumber(requireField(object, "size", label), "machine.vdp.billboard.size"));
	state.color = requireU32(requireField(object, "color", label), "machine.vdp.billboard.color");
	state.source = decodeVdpSourceState<VdpBlitterSourceSaveState>(requireField(object, "source", label), "machine.vdp.billboard.source");
	state.surfaceWidth = requireU32(requireField(object, "surfaceWidth", label), "machine.vdp.billboard.surfaceWidth");
	state.surfaceHeight = requireU32(requireField(object, "surfaceHeight", label), "machine.vdp.billboard.surfaceHeight");
	state.slot = requireU32(requireField(object, "slot", label), "machine.vdp.billboard.slot");
	return state;
}

std::vector<VdpBbuBillboardSaveState> decodeBbuBillboardStates(const BinValue& value, const char* label) {
	std::vector<VdpBbuBillboardSaveState> billboards = decodeVector<VdpBbuBillboardSaveState>(
		value,
		label,
		[](const BinValue& entry, size_t) { return decodeBbuBillboardState(entry, "machine.vdp.billboards[]"); }
	);
	if (billboards.size() > VDP_BBU_BILLBOARD_LIMIT) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " exceeds the VDP BBU billboard capacity.");
	}
	return billboards;
}

BinValue encodeBuildingFrameState(const VdpBuildingFrameSaveState& state) {
	return BinValue(BinObject{
		{"state", static_cast<i64>(static_cast<u32>(state.state))},
		{"queue", encodeVector<VdpBlitterCommandSaveState>(state.queue, encodeBlitterCommandState)},
		{"billboards", encodeVector<VdpBbuBillboardSaveState>(state.billboards, encodeBbuBillboardState)},
		{"cost", static_cast<i64>(state.cost)},
	});
}

VdpBuildingFrameSaveState decodeBuildingFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpBuildingFrameSaveState state;
	state.state = static_cast<VdpDexFrameState>(requireBoundedU32(requireField(object, "state", label), "machine.vdp.buildFrame.state", 0u, 2u));
	state.queue = decodeBlitterCommandStates(requireField(object, "queue", label), "machine.vdp.buildFrame.queue");
	state.billboards = decodeBbuBillboardStates(requireField(object, "billboards", label), "machine.vdp.buildFrame.billboards");
	state.cost = requireI32(requireField(object, "cost", label), "machine.vdp.buildFrame.cost");
	return state;
}

BinValue encodeResolvedBlitterSampleState(const VdpResolvedBlitterSample& state) {
	return BinValue(BinObject{
		{"source", encodeVdpSourceState(state.source)},
		{"surfaceWidth", static_cast<i64>(state.surfaceWidth)},
		{"surfaceHeight", static_cast<i64>(state.surfaceHeight)},
		{"slot", static_cast<i64>(state.slot)},
	});
}

VdpResolvedBlitterSample decodeResolvedBlitterSampleState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpResolvedBlitterSample state;
	state.source = decodeVdpSourceState<VdpBlitterSource>(requireField(object, "source", label), "machine.vdp.sample.source");
	state.surfaceWidth = requireU32(requireField(object, "surfaceWidth", label), "machine.vdp.sample.surfaceWidth");
	state.surfaceHeight = requireU32(requireField(object, "surfaceHeight", label), "machine.vdp.sample.surfaceHeight");
	state.slot = requireU32(requireField(object, "slot", label), "machine.vdp.sample.slot");
	return state;
}

VdpSkyboxSamples decodeSkyboxSampleStates(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != SKYBOX_FACE_COUNT) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must contain one sample per skybox face.");
	}
	VdpSkyboxSamples samples{};
	for (size_t index = 0; index < SKYBOX_FACE_COUNT; ++index) {
		samples[index] = decodeResolvedBlitterSampleState(array[index], "machine.vdp.skyboxSamples[]");
	}
	return samples;
}

BinValue encodeSubmittedFrameState(const VdpSubmittedFrameSaveState& state) {
	return BinValue(BinObject{
		{"state", static_cast<i64>(static_cast<u32>(state.state))},
		{"queue", encodeVector<VdpBlitterCommandSaveState>(state.queue, encodeBlitterCommandState)},
		{"billboards", encodeVector<VdpBbuBillboardSaveState>(state.billboards, encodeBbuBillboardState)},
		{"hasCommands", state.hasCommands},
		{"hasFrameBufferCommands", state.hasFrameBufferCommands},
		{"cost", static_cast<i64>(state.cost)},
		{"workRemaining", static_cast<i64>(state.workRemaining)},
		{"ditherType", static_cast<i64>(state.ditherType)},
		{"frameBufferWidth", static_cast<i64>(state.frameBufferWidth)},
		{"frameBufferHeight", static_cast<i64>(state.frameBufferHeight)},
		{"xf", encodeVdpXfState(state.xf)},
		{"skyboxControl", static_cast<i64>(state.skyboxControl)},
		{"skyboxFaceWords", encodeFixedArray(state.skyboxFaceWords, encodeScalar<i64, u32>)},
		{"skyboxSamples", encodeFixedArray(state.skyboxSamples, encodeResolvedBlitterSampleState)},
	});
}

VdpSubmittedFrameSaveState decodeSubmittedFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpSubmittedFrameSaveState state;
	state.state = static_cast<VdpSubmittedFrameState>(requireBoundedU32(requireField(object, "state", label), "machine.vdp.submittedFrame.state", 0u, 3u));
	state.queue = decodeBlitterCommandStates(requireField(object, "queue", label), "machine.vdp.submittedFrame.queue");
	state.billboards = decodeBbuBillboardStates(requireField(object, "billboards", label), "machine.vdp.submittedFrame.billboards");
	state.hasCommands = requireBool(requireField(object, "hasCommands", label), "machine.vdp.submittedFrame.hasCommands");
	state.hasFrameBufferCommands = requireBool(requireField(object, "hasFrameBufferCommands", label), "machine.vdp.submittedFrame.hasFrameBufferCommands");
	state.cost = requireI32(requireField(object, "cost", label), "machine.vdp.submittedFrame.cost");
	state.workRemaining = requireI32(requireField(object, "workRemaining", label), "machine.vdp.submittedFrame.workRemaining");
	state.ditherType = requireI32(requireField(object, "ditherType", label), "machine.vdp.submittedFrame.ditherType");
	state.frameBufferWidth = requireU32(requireField(object, "frameBufferWidth", label), "machine.vdp.submittedFrame.frameBufferWidth");
	state.frameBufferHeight = requireU32(requireField(object, "frameBufferHeight", label), "machine.vdp.submittedFrame.frameBufferHeight");
	state.xf = decodeVdpXfState(requireField(object, "xf", label), "machine.vdp.submittedFrame.xf");
	state.skyboxControl = requireU32(requireField(object, "skyboxControl", label), "machine.vdp.submittedFrame.skyboxControl");
	state.skyboxFaceWords = decodeU32Array<SKYBOX_FACE_WORD_COUNT>(requireField(object, "skyboxFaceWords", label), "machine.vdp.submittedFrame.skyboxFaceWords");
	state.skyboxSamples = decodeSkyboxSampleStates(requireField(object, "skyboxSamples", label), "machine.vdp.submittedFrame.skyboxSamples");
	return state;
}

BinValue encodeVdpState(const VdpState& state) {
	BinObject object;
	object["xf"] = encodeVdpXfState(state.xf);
	object["vdpRegisterWords"] = encodeFixedArray(state.vdpRegisterWords, encodeScalar<i64, u32>);
	object["buildFrame"] = encodeBuildingFrameState(state.buildFrame);
	object["activeFrame"] = encodeSubmittedFrameState(state.activeFrame);
	object["pendingFrame"] = encodeSubmittedFrameState(state.pendingFrame);
	object["workCarry"] = static_cast<i64>(state.workCarry);
	object["availableWorkUnits"] = static_cast<i64>(state.availableWorkUnits);
	object["dmaSubmitActive"] = state.dmaSubmitActive;
	object["vdpFifoWordScratch"] = encodeFixedArray(state.vdpFifoWordScratch, encodeScalar<i64, u8>);
	object["vdpFifoWordByteCount"] = static_cast<i64>(state.vdpFifoWordByteCount);
	object["vdpFifoStreamWords"] = encodeVector<u32>(state.vdpFifoStreamWords, encodeScalar<i64, u32>);
	object["vdpFifoStreamWordCount"] = static_cast<i64>(state.vdpFifoStreamWordCount);
	object["blitterSequence"] = static_cast<i64>(state.blitterSequence);
	object["skyboxControl"] = static_cast<i64>(state.skyboxControl);
	object["skyboxFaceWords"] = encodeFixedArray(state.skyboxFaceWords, encodeScalar<i64, u32>);
	object["pmuSelectedBank"] = static_cast<i64>(state.pmuSelectedBank);
	object["pmuBankWords"] = encodeFixedArray(state.pmuBankWords, encodeScalar<i64, u32>);
	object["ditherType"] = static_cast<i64>(state.ditherType);
	object["vdpFaultCode"] = static_cast<i64>(state.vdpFaultCode);
	object["vdpFaultDetail"] = static_cast<i64>(state.vdpFaultDetail);
	return BinValue(std::move(object));
}

VdpState decodeVdpState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpState state;
	state.xf = decodeVdpXfState(requireField(object, "xf", label), "machine.vdp.xf");
	state.vdpRegisterWords = decodeU32Array<VDP_REGISTER_COUNT>(requireField(object, "vdpRegisterWords", label), "machine.vdp.vdpRegisterWords");
	state.buildFrame = decodeBuildingFrameState(requireField(object, "buildFrame", label), "machine.vdp.buildFrame");
	state.activeFrame = decodeSubmittedFrameState(requireField(object, "activeFrame", label), "machine.vdp.activeFrame");
	state.pendingFrame = decodeSubmittedFrameState(requireField(object, "pendingFrame", label), "machine.vdp.pendingFrame");
	state.workCarry = requireI64(requireField(object, "workCarry", label), "machine.vdp.workCarry");
	state.availableWorkUnits = requireI32(requireField(object, "availableWorkUnits", label), "machine.vdp.availableWorkUnits");
	state.dmaSubmitActive = requireBool(requireField(object, "dmaSubmitActive", label), "machine.vdp.dmaSubmitActive");
	state.vdpFifoWordScratch = decodeU8Array<4>(requireField(object, "vdpFifoWordScratch", label), "machine.vdp.vdpFifoWordScratch");
	state.vdpFifoWordByteCount = requireI32(requireField(object, "vdpFifoWordByteCount", label), "machine.vdp.vdpFifoWordByteCount");
	state.vdpFifoStreamWords = decodeVector<u32>(
		requireField(object, "vdpFifoStreamWords", label),
		"machine.vdp.vdpFifoStreamWords",
		[](const BinValue& entry, size_t) { return requireU32(entry, "machine.vdp.vdpFifoStreamWords[]"); }
	);
	state.vdpFifoStreamWordCount = requireU32(requireField(object, "vdpFifoStreamWordCount", label), "machine.vdp.vdpFifoStreamWordCount");
	if (state.vdpFifoWordByteCount < 0 || state.vdpFifoWordByteCount > 3 || state.vdpFifoStreamWords.size() != state.vdpFifoStreamWordCount || state.vdpFifoStreamWordCount > VDP_STREAM_CAPACITY_WORDS) {
		throw BMSX_RUNTIME_ERROR("[save-state] machine.vdp FIFO ingress state is inconsistent.");
	}
	state.blitterSequence = requireU32(requireField(object, "blitterSequence", label), "machine.vdp.blitterSequence");
	state.skyboxControl = requireU32(requireField(object, "skyboxControl", label), "machine.vdp.skyboxControl");
	state.skyboxFaceWords = decodeU32Array<SKYBOX_FACE_WORD_COUNT>(requireField(object, "skyboxFaceWords", label), "machine.vdp.skyboxFaceWords");
	state.pmuSelectedBank = requireU32(requireField(object, "pmuSelectedBank", label), "machine.vdp.pmuSelectedBank");
	state.pmuBankWords = decodeU32Array<VDP_PMU_BANK_WORD_COUNT>(requireField(object, "pmuBankWords", label), "machine.vdp.pmuBankWords");
	state.ditherType = requireI32(requireField(object, "ditherType", label), "machine.vdp.ditherType");
	state.vdpFaultCode = requireU32(requireField(object, "vdpFaultCode", label), "machine.vdp.vdpFaultCode");
	state.vdpFaultDetail = requireU32(requireField(object, "vdpFaultDetail", label), "machine.vdp.vdpFaultDetail");
	return state;
}

BinValue encodeVdpSurfacePixelsState(const VdpSurfacePixelsState& state) {
	BinObject object;
	object["surfaceId"] = static_cast<i64>(state.surfaceId);
	object["surfaceWidth"] = static_cast<i64>(state.surfaceWidth);
	object["surfaceHeight"] = static_cast<i64>(state.surfaceHeight);
	object["pixels"] = BinBinary(state.pixels);
	return BinValue(std::move(object));
}

VdpSurfacePixelsState decodeVdpSurfacePixelsState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpSurfacePixelsState state;
	state.surfaceId = requireU32(requireField(object, "surfaceId", label), "machine.vdp.surfacePixels.surfaceId");
	state.surfaceWidth = requireU32(requireField(object, "surfaceWidth", label), "machine.vdp.surfacePixels.surfaceWidth");
	state.surfaceHeight = requireU32(requireField(object, "surfaceHeight", label), "machine.vdp.surfacePixels.surfaceHeight");
	state.pixels = requireBinary(requireField(object, "pixels", label), "machine.vdp.surfacePixels.pixels");
	return state;
}

BinValue encodeVdpSaveState(const VdpSaveState& state) {
	BinObject object = encodeVdpState(state).asObject();
	object["vramStaging"] = BinBinary(state.vramStaging);
	object["surfacePixels"] = encodeVector<VdpSurfacePixelsState>(state.surfacePixels, encodeVdpSurfacePixelsState);
	object["displayFrameBufferPixels"] = BinBinary(state.displayFrameBufferPixels);
	return BinValue(std::move(object));
}

VdpSaveState decodeVdpSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const VdpState base = decodeVdpState(value, label);
	VdpSaveState state;
	state.xf = base.xf;
	state.vdpRegisterWords = base.vdpRegisterWords;
	state.skyboxControl = base.skyboxControl;
	state.skyboxFaceWords = base.skyboxFaceWords;
	state.pmuSelectedBank = base.pmuSelectedBank;
	state.pmuBankWords = base.pmuBankWords;
	state.ditherType = base.ditherType;
	state.buildFrame = base.buildFrame;
	state.activeFrame = base.activeFrame;
	state.pendingFrame = base.pendingFrame;
	state.workCarry = base.workCarry;
	state.availableWorkUnits = base.availableWorkUnits;
	state.dmaSubmitActive = base.dmaSubmitActive;
	state.vdpFifoWordScratch = base.vdpFifoWordScratch;
	state.vdpFifoWordByteCount = base.vdpFifoWordByteCount;
	state.vdpFifoStreamWords = base.vdpFifoStreamWords;
	state.vdpFifoStreamWordCount = base.vdpFifoStreamWordCount;
	state.blitterSequence = base.blitterSequence;
	state.vdpFaultCode = base.vdpFaultCode;
	state.vdpFaultDetail = base.vdpFaultDetail;
	state.vramStaging = requireBinary(requireField(object, "vramStaging", label), "machine.vdp.vramStaging");
	state.surfacePixels = decodeVector<VdpSurfacePixelsState>(
		requireField(object, "surfacePixels", label),
		"machine.vdp.surfacePixels",
		[](const BinValue& entry, size_t) { return decodeVdpSurfacePixelsState(entry, "machine.vdp.surfacePixels[]"); }
	);
	state.displayFrameBufferPixels = requireBinary(requireField(object, "displayFrameBufferPixels", label), "machine.vdp.displayFrameBufferPixels");
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

BinValue encodeAudioControllerState(const AudioControllerState& state) {
	BinObject object;
	object["registerWords"] = encodeFixedArray(state.registerWords, encodeScalar<f64, u32>);
	object["commandFifoCommands"] = encodeFixedArray(state.commandFifoCommands, encodeScalar<f64, u32>);
	object["commandFifoRegisterWords"] = encodeFixedArray(state.commandFifoRegisterWords, encodeScalar<f64, u32>);
	object["commandFifoReadIndex"] = encodeScalar<f64>(state.commandFifoReadIndex);
	object["commandFifoWriteIndex"] = encodeScalar<f64>(state.commandFifoWriteIndex);
	object["commandFifoCount"] = encodeScalar<f64>(state.commandFifoCount);
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
	state.commandFifoCommands = decodeU32Array<APU_COMMAND_FIFO_CAPACITY>(requireField(object, "commandFifoCommands", label), "machine.audio.commandFifoCommands");
	state.commandFifoRegisterWords = decodeU32Array<APU_COMMAND_FIFO_REGISTER_WORD_COUNT>(requireField(object, "commandFifoRegisterWords", label), "machine.audio.commandFifoRegisterWords");
	state.commandFifoReadIndex = requireBoundedU32(requireField(object, "commandFifoReadIndex", label), "machine.audio.commandFifoReadIndex", 0, APU_COMMAND_FIFO_CAPACITY - 1u);
	state.commandFifoWriteIndex = requireBoundedU32(requireField(object, "commandFifoWriteIndex", label), "machine.audio.commandFifoWriteIndex", 0, APU_COMMAND_FIFO_CAPACITY - 1u);
	state.commandFifoCount = requireBoundedU32(requireField(object, "commandFifoCount", label), "machine.audio.commandFifoCount", 0, APU_COMMAND_FIFO_CAPACITY);
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

BinValue encodeMachineSaveState(const MachineSaveState& state) {
	BinObject object;
	object["memory"] = encodeMemorySaveState(state.memory);
	object["geometry"] = encodeGeometryControllerState(state.geometry);
	object["irq"] = encodeIrqControllerState(state.irq);
	object["audio"] = encodeAudioControllerState(state.audio);
	object["stringPool"] = encodeStringPoolState(state.stringPool);
	object["input"] = encodeInputControllerState(state.input);
	object["vdp"] = encodeVdpSaveState(state.vdp);
	return BinValue(std::move(object));
}

MachineSaveState decodeMachineSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MachineSaveState state;
	state.memory = decodeMemorySaveState(requireField(object, "memory", label), "machineState.machine.memory");
	state.geometry = decodeGeometryControllerState(requireField(object, "geometry", label), "machineState.machine.geometry");
	state.irq = decodeIrqControllerState(requireField(object, "irq", label), "machineState.machine.irq");
	state.audio = decodeAudioControllerState(requireField(object, "audio", label), "machineState.machine.audio");
	state.stringPool = decodeStringPoolState(requireField(object, "stringPool", label), "machineState.machine.stringPool");
	state.input = decodeInputControllerState(requireField(object, "input", label), "machineState.machine.input");
	state.vdp = decodeVdpSaveState(requireField(object, "vdp", label), "machineState.machine.vdp");
	return state;
}

BinValue encodeRuntimeSaveMachineState(const RuntimeSaveMachineState& state) {
	BinObject object;
	object["machine"] = encodeMachineSaveState(state.machine);
	object["frameScheduler"] = encodeFrameSchedulerState(state.frameScheduler);
	object["vblank"] = encodeRuntimeVblankState(state.vblank);
	return BinValue(std::move(object));
}

RuntimeSaveMachineState decodeRuntimeSaveMachineState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveMachineState state;
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
		case CpuValueStateTag::Ref:
			object["tag"] = "ref";
			object["id"] = static_cast<i64>(state.refId);
			break;
		case CpuValueStateTag::StableRef: {
			object["tag"] = "stable_ref";
			BinArray path;
			path.reserve(state.path.size());
			for (const CpuRuntimeRefSegment& segment : state.path) {
				path.push_back(segment.isIndex ? BinValue(static_cast<i64>(segment.index)) : BinValue(segment.key));
			}
			object["path"] = BinValue(std::move(path));
			break;
		}
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
	if (tag == "ref") {
		state.tag = CpuValueStateTag::Ref;
		state.refId = requireI32(requireField(object, "id", label), "cpuValueState.id");
		return state;
	}
	if (tag == "stable_ref") {
		state.tag = CpuValueStateTag::StableRef;
		const BinArray& path = requireArray(requireField(object, "path", label), "cpuValueState.path");
		state.path.reserve(path.size());
		for (size_t index = 0; index < path.size(); ++index) {
			const BinValue& segmentValue = path[index];
			CpuRuntimeRefSegment segment;
			if (segmentValue.isString()) {
				segment.key = segmentValue.asString();
			} else {
				segment.isIndex = true;
				segment.index = requireI32(segmentValue, "cpuValueState.path[]");
			}
			state.path.push_back(std::move(segment));
		}
		return state;
	}
	throw BMSX_RUNTIME_ERROR("cpuValueState.tag is invalid.");
}

BinValue encodeCpuObjectState(const CpuObjectState& state) {
	BinObject object;
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
		state.protoIndex = requireI32(requireField(object, "protoIndex", label), "cpuObjectState.protoIndex");
		state.upvalues = decodeVector<int>(requireField(object, "upvalues", label), "cpuObjectState.upvalues",
			[](const BinValue& entryValue, size_t) {
				return requireI32(entryValue, "cpuObjectState.upvalues[]");
			});
		return state;
	}
	if (kind == "upvalue") {
		state.kind = CpuObjectState::Kind::Upvalue;
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
	object["randomSeed"] = static_cast<i64>(state.randomSeed);
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
	state.randomSeed = requireU32(requireField(object, "randomSeed", label), "runtimeSaveState.randomSeed");
	state.pendingEntryCall = requireBool(requireField(object, "pendingEntryCall", label), "runtimeSaveState.pendingEntryCall");
	return state;
}

} // namespace

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state) {
	return encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), RUNTIME_SAVE_STATE_PROP_NAMES);
}

RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size) {
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
