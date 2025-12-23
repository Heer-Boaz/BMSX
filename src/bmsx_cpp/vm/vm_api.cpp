#include "vm_api.h"
#include "vm_runtime.h"
#include "vm_objects.h"
#include "../core/engine.h"
#include "../core/registry.h"
#include "../fsm/fsmlibrary.h"
#include "../fsm/fsmcontroller.h"
#include "../fsm/state.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <unordered_set>

namespace bmsx {

// Pointer action names
static const std::vector<std::string> POINTER_ACTIONS = {
	"pointer_primary",
	"pointer_secondary",
	"pointer_aux",
	"pointer_back",
	"pointer_forward",
};

static const std::array<Color, 16> MSX1_PALETTE = {
	Color::fromRGBA8(0, 0, 0, 0),
	Color::fromRGBA8(0, 0, 0, 255),
	Color::fromRGBA8(0, 241, 20, 255),
	Color::fromRGBA8(68, 249, 86, 255),
	Color::fromRGBA8(85, 79, 255, 255),
	Color::fromRGBA8(128, 111, 255, 255),
	Color::fromRGBA8(250, 80, 51, 255),
	Color::fromRGBA8(12, 255, 255, 255),
	Color::fromRGBA8(255, 81, 52, 255),
	Color::fromRGBA8(255, 115, 86, 255),
	Color::fromRGBA8(226, 210, 4, 255),
	Color::fromRGBA8(242, 217, 71, 255),
	Color::fromRGBA8(4, 212, 19, 255),
	Color::fromRGBA8(231, 80, 229, 255),
	Color::fromRGBA8(208, 208, 208, 255),
	Color::fromRGBA8(255, 255, 255, 255),
};

static const Color& paletteColor(int index) {
	return MSX1_PALETTE[static_cast<size_t>(index)];
}

namespace {

struct VmTimelineHandle {
	std::unique_ptr<Timeline<std::any>> timeline;

	std::unique_ptr<Timeline<std::any>> take() {
		return std::move(timeline);
	}
};

const std::unordered_set<std::string> CLASS_OVERRIDE_EXCLUSIONS = {
	"def_id",
	"class",
	"defaults",
	"metatable",
	"constructor",
	"prototype",
	"super",
	"__index",
};

std::string toLower(std::string value) {
	std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
		return static_cast<char>(std::tolower(c));
	});
	return value;
}

TimelinePlaybackMode parsePlaybackMode(const std::string& value) {
	const std::string normalized = toLower(value);
	if (normalized == "once") return TimelinePlaybackMode::Once;
	if (normalized == "loop") return TimelinePlaybackMode::Loop;
	if (normalized == "pingpong") return TimelinePlaybackMode::PingPong;
	throw std::runtime_error("[VMApi] Unknown timeline playback mode '" + value + "'.");
}

std::shared_ptr<Table> makeVec3Table(const Vec3& v) {
	auto tbl = std::make_shared<Table>();
	tbl->set(std::string("x"), static_cast<double>(v.x));
	tbl->set(std::string("y"), static_cast<double>(v.y));
	tbl->set(std::string("z"), static_cast<double>(v.z));
	return tbl;
}

Vec3 readVec3(const Value& value) {
	auto tbl = std::get<std::shared_ptr<Table>>(value);
	Vec3 out;
	out.x = static_cast<f32>(asNumber(tbl->get(std::string("x"))));
	out.y = static_cast<f32>(asNumber(tbl->get(std::string("y"))));
	out.z = static_cast<f32>(asNumber(tbl->get(std::string("z"))));
	return out;
}

std::vector<std::string> readStringArray(const std::shared_ptr<Table>& table) {
	const int len = table->length();
	std::vector<std::string> result;
	result.reserve(static_cast<size_t>(len));
	for (int i = 1; i <= len; ++i) {
		Value entry = table->get(static_cast<double>(i));
		result.push_back(std::get<std::string>(entry));
	}
	return result;
}

std::any valueToAny(const Value& value) {
	return value;
}

Value anyToValue(const std::any& value) {
	if (value.type() == typeid(Value)) return std::any_cast<Value>(value);
	if (value.type() == typeid(std::string)) return std::any_cast<std::string>(value);
	if (value.type() == typeid(const char*)) return std::string(std::any_cast<const char*>(value));
	if (value.type() == typeid(double)) return std::any_cast<double>(value);
	if (value.type() == typeid(float)) return static_cast<double>(std::any_cast<float>(value));
	if (value.type() == typeid(int)) return static_cast<double>(std::any_cast<int>(value));
	if (value.type() == typeid(bool)) return std::any_cast<bool>(value);
	if (value.type() == typeid(std::shared_ptr<Table>)) return std::any_cast<std::shared_ptr<Table>>(value);
	if (value.type() == typeid(std::shared_ptr<NativeObject>)) return std::any_cast<std::shared_ptr<NativeObject>>(value);
	if (value.type() == typeid(std::shared_ptr<NativeFunction>)) return std::any_cast<std::shared_ptr<NativeFunction>>(value);
	return std::monostate{};
}

std::shared_ptr<Table> makeEventTable(const GameEvent& event) {
	auto tbl = std::make_shared<Table>();
	tbl->set(std::string("type"), event.type);
	tbl->set(std::string("emitter"), event.emitter);
	tbl->set(std::string("timestamp"), event.timestamp);
	for (const auto& [key, val] : event.payload) {
		tbl->set(key, anyToValue(val));
	}
	return tbl;
}

std::string buildStateId(const State* state) {
	if (state->is_root()) {
		return state->target_id + "." + state->localdef_id;
	}
	const State* parent = state->parent();
	std::string parentId = buildStateId(parent);
	const char* separator = parent->is_root() ? ":/" : "/";
	return parentId + separator + state->localdef_id;
}

std::shared_ptr<Table> makeStateTable(const State* state) {
	auto tbl = std::make_shared<Table>();
	tbl->set(std::string("id"), buildStateId(state));
	tbl->set(std::string("localdef_id"), state->localdef_id);
	tbl->set(std::string("def_id"), state->def_id);
	tbl->set(std::string("target_id"), state->target_id);
	tbl->set(std::string("path"), state->path());
	tbl->set(std::string("currentid"), state->currentid);
	return tbl;
}

TimelinePlayOptions readTimelinePlayOptions(const std::shared_ptr<Table>& table) {
	TimelinePlayOptions opts;
	Value rewindVal = table->get(std::string("rewind"));
	if (!isNil(rewindVal)) {
		opts.rewind = isTruthy(rewindVal);
	}
	Value snapVal = table->get(std::string("snap_to_start"));
	if (!isNil(snapVal)) {
		opts.snap_to_start = isTruthy(snapVal);
	}
	Value startVal = table->get(std::string("start_frame"));
	if (!isNil(startVal)) {
		opts.start_frame = static_cast<i32>(asNumber(startVal));
	}
	Value modeVal = table->get(std::string("mode"));
	if (!isNil(modeVal)) {
		opts.mode = parsePlaybackMode(std::get<std::string>(modeVal));
	}
	return opts;
}

TimelineDefinition<std::any> readTimelineDefinition(const std::shared_ptr<Table>& table) {
	TimelineDefinition<std::any> def;
	def.id = std::get<std::string>(table->get(std::string("id")));

	Value framesVal = table->get(std::string("frames"));
	if (!isNil(framesVal)) {
		auto framesTable = std::get<std::shared_ptr<Table>>(framesVal);
		const int len = framesTable->length();
		def.frames.reserve(static_cast<size_t>(len));
		for (int i = 1; i <= len; ++i) {
			def.frames.push_back(framesTable->get(static_cast<double>(i)));
		}
	}

	Value ticksVal = table->get(std::string("ticks_per_frame"));
	if (!isNil(ticksVal)) {
		def.ticks_per_frame = static_cast<i32>(asNumber(ticksVal));
	}

	Value modeVal = table->get(std::string("playback_mode"));
	if (!isNil(modeVal)) {
		def.playback_mode = parsePlaybackMode(std::get<std::string>(modeVal));
	}

	Value easingVal = table->get(std::string("easing"));
	if (!isNil(easingVal)) {
		def.easing = std::get<std::string>(easingVal);
	}

	Value repsVal = table->get(std::string("repetitions"));
	if (!isNil(repsVal)) {
		def.repetitions = static_cast<i32>(asNumber(repsVal));
	}

	Value autoVal = table->get(std::string("autotick"));
	if (!isNil(autoVal)) {
		def.autotick = isTruthy(autoVal);
	}

	return def;
}

std::unique_ptr<Timeline<std::any>> takeTimelineFromValue(const Value& value) {
	auto* native = std::get_if<std::shared_ptr<NativeObject>>(&value);
	if (!native || !(*native)) {
		throw std::runtime_error("[VMApi] Timeline factory did not return a timeline object.");
	}
	auto* handle = static_cast<VmTimelineHandle*>((*native)->raw);
	if (!handle) {
		throw std::runtime_error("[VMApi] Timeline factory did not return a valid timeline handle.");
	}
	auto timeline = handle->take();
	if (!timeline) {
		throw std::runtime_error("[VMApi] Timeline handle did not contain a timeline instance.");
	}
	return timeline;
}

std::unordered_map<std::string, std::any> readPayloadMap(const std::shared_ptr<Table>& table) {
	std::unordered_map<std::string, std::any> payload;
	const auto entries = table->entries();
	for (const auto& [key, value] : entries) {
		if (!std::holds_alternative<std::string>(key)) {
			continue;
		}
		payload[std::get<std::string>(key)] = valueToAny(value);
	}
	return payload;
}

void applyTableToObject(VMWorldObject* obj, const std::shared_ptr<Table>& table,
                        const std::unordered_set<std::string>* exclusions = nullptr) {
	const auto entries = table->entries();
	for (const auto& [key, value] : entries) {
		if (!std::holds_alternative<std::string>(key)) {
			continue;
		}
		const std::string& keyName = std::get<std::string>(key);
		if (exclusions && exclusions->find(keyName) != exclusions->end()) {
			continue;
		}
		if (keyName == "id") {
			obj->id = std::get<std::string>(value);
			continue;
		}
		obj->setDynamicProperty(keyName, value);
	}
}

void callObjectHook(VMRuntime& runtime, VMWorldObject* obj, const std::string& hook,
                    const std::vector<Value>& args) {
	Value value = obj->getDynamicProperty(hook);
	if (isNil(value)) {
		return;
	}
	if (auto* closure = std::get_if<std::shared_ptr<Closure>>(&value)) {
		runtime.callLuaFunction(*closure, args);
		return;
	}
	if (auto* native = std::get_if<std::shared_ptr<NativeFunction>>(&value)) {
		(*native)->invoke(args);
		return;
	}
	throw std::runtime_error("[VMApi] Hook '" + hook + "' is not a function.");
}

VMWorldObject* resolveStateTarget(State* state) {
	auto* obj = Registry::instance().get<WorldObject>(state->target_id);
	if (!obj) {
		throw std::runtime_error("[VMApi] FSM target '" + state->target_id + "' not found in registry.");
	}
	auto* vmObj = dynamic_cast<VMWorldObject*>(obj);
	if (!vmObj) {
		throw std::runtime_error("[VMApi] FSM target '" + state->target_id + "' is not a VMWorldObject.");
	}
	return vmObj;
}

std::optional<TransitionTarget> parseTransitionResult(const std::vector<Value>& results) {
	if (results.empty() || isNil(results[0])) {
		return std::nullopt;
	}
	if (auto* str = std::get_if<std::string>(&results[0])) {
		return *str;
	}
	if (auto* flag = std::get_if<bool>(&results[0])) {
		if (!*flag) {
			return std::nullopt;
		}
	}
	if (auto* num = std::get_if<double>(&results[0])) {
		if (*num == 0.0) {
			return std::nullopt;
		}
	}
	throw std::runtime_error("[VMApi] FSM handler returned a non-string transition.");
}

StateTickHandler makeLuaTickHandler(VMRuntime& runtime, const std::shared_ptr<Closure>& closure) {
	return [&runtime, closure](State* state) -> std::optional<TransitionTarget> {
		VMWorldObject* obj = resolveStateTarget(state);
		std::vector<Value> args;
		args.reserve(2);
		args.push_back(obj->nativeHandle());
		args.push_back(makeStateTable(state));
		auto results = runtime.callLuaFunction(closure, args);
		return parseTransitionResult(results);
	};
}

StateEventHandler makeLuaEventHandler(VMRuntime& runtime, const std::shared_ptr<Closure>& closure) {
	return [&runtime, closure](State* state, const GameEvent& event) -> std::optional<TransitionTarget> {
		VMWorldObject* obj = resolveStateTarget(state);
		std::vector<Value> args;
		args.reserve(3);
		args.push_back(obj->nativeHandle());
		args.push_back(makeStateTable(state));
		args.push_back(makeEventTable(event));
		auto results = runtime.callLuaFunction(closure, args);
		return parseTransitionResult(results);
	};
}

StateEnterHandler makeLuaEnterHandler(VMRuntime& runtime, const std::shared_ptr<Closure>& closure) {
	return [&runtime, closure](State* state, const EventPayload* payload) -> std::optional<TransitionTarget> {
		VMWorldObject* obj = resolveStateTarget(state);
		std::vector<Value> args;
		args.reserve(payload ? 3 : 2);
		args.push_back(obj->nativeHandle());
		args.push_back(makeStateTable(state));
		if (payload) {
			auto payloadTable = std::make_shared<Table>();
			for (const auto& [key, val] : *payload) {
				payloadTable->set(key, anyToValue(val));
			}
			args.push_back(payloadTable);
		}
		auto results = runtime.callLuaFunction(closure, args);
		return parseTransitionResult(results);
	};
}

StateExitHandler makeLuaExitHandler(VMRuntime& runtime, const std::shared_ptr<Closure>& closure) {
	return [&runtime, closure](State* state, const EventPayload* payload) {
		VMWorldObject* obj = resolveStateTarget(state);
		std::vector<Value> args;
		args.reserve(payload ? 3 : 2);
		args.push_back(obj->nativeHandle());
		args.push_back(makeStateTable(state));
		if (payload) {
			auto payloadTable = std::make_shared<Table>();
			for (const auto& [key, val] : *payload) {
				payloadTable->set(key, anyToValue(val));
			}
			args.push_back(payloadTable);
		}
		runtime.callLuaFunction(closure, args);
	};
}

StateEventDefinition readStateEventDefinition(const Value& value, VMRuntime& runtime) {
	StateEventDefinition def;

	if (auto* str = std::get_if<std::string>(&value)) {
		def.target = *str;
		return def;
	}
	if (auto* closure = std::get_if<std::shared_ptr<Closure>>(&value)) {
		def.handler = makeLuaEventHandler(runtime, *closure);
		return def;
	}

	auto* table = std::get_if<std::shared_ptr<Table>>(&value);
	if (!table || !(*table)) {
		throw std::runtime_error("[VMApi] Invalid state event definition.");
	}
	Value goVal = (*table)->get(std::string("go"));
	if (auto* goStr = std::get_if<std::string>(&goVal)) {
		def.target = *goStr;
		return def;
	}
	if (auto* closure = std::get_if<std::shared_ptr<Closure>>(&goVal)) {
		def.handler = makeLuaEventHandler(runtime, *closure);
		return def;
	}
	if (auto* native = std::get_if<std::shared_ptr<NativeFunction>>(&goVal)) {
		def.handler = [&runtime, native](State* state, const GameEvent& event) -> std::optional<TransitionTarget> {
			VMWorldObject* obj = resolveStateTarget(state);
			std::vector<Value> args;
			args.reserve(3);
			args.push_back(obj->nativeHandle());
			args.push_back(makeStateTable(state));
			args.push_back(makeEventTable(event));
			auto results = (*native)->invoke(args);
			return parseTransitionResult(results);
		};
		return def;
	}

	throw std::runtime_error("[VMApi] State event handler is missing a go() function.");
}

void populateStateDefinition(StateDefinition* def, const std::shared_ptr<Table>& table, VMRuntime& runtime) {
	Value initialVal = table->get(std::string("initial"));
	if (!isNil(initialVal)) {
		def->initial = std::get<std::string>(initialVal);
	}

	Value concurrentVal = table->get(std::string("is_concurrent"));
	if (!isNil(concurrentVal)) {
		def->is_concurrent = isTruthy(concurrentVal);
	}

	Value inputEvalVal = table->get(std::string("input_eval"));
	if (!isNil(inputEvalVal)) {
		const std::string& evalStr = std::get<std::string>(inputEvalVal);
		def->input_eval = (toLower(evalStr) == "first") ? InputEvalMode::First : InputEvalMode::All;
	}

	Value dataVal = table->get(std::string("data"));
	if (!isNil(dataVal)) {
		auto dataTable = std::get<std::shared_ptr<Table>>(dataVal);
		for (const auto& [key, value] : dataTable->entries()) {
			if (!std::holds_alternative<std::string>(key)) {
				continue;
			}
			def->data[std::get<std::string>(key)] = valueToAny(value);
		}
	}

	Value tickVal = table->get(std::string("tick"));
	if (!isNil(tickVal)) {
		auto closure = std::get<std::shared_ptr<Closure>>(tickVal);
		def->tick = makeLuaTickHandler(runtime, closure);
	}

	Value enterVal = table->get(std::string("entering_state"));
	if (!isNil(enterVal)) {
		auto closure = std::get<std::shared_ptr<Closure>>(enterVal);
		def->entering_state = makeLuaEnterHandler(runtime, closure);
	}

	Value exitVal = table->get(std::string("exiting_state"));
	if (!isNil(exitVal)) {
		auto closure = std::get<std::shared_ptr<Closure>>(exitVal);
		def->exiting_state = makeLuaExitHandler(runtime, closure);
	}

	Value processVal = table->get(std::string("process_input"));
	if (!isNil(processVal)) {
		auto closure = std::get<std::shared_ptr<Closure>>(processVal);
		def->process_input = makeLuaEventHandler(runtime, closure);
	}

	Value onVal = table->get(std::string("on"));
	if (!isNil(onVal)) {
		auto onTable = std::get<std::shared_ptr<Table>>(onVal);
		for (const auto& [key, value] : onTable->entries()) {
			if (!std::holds_alternative<std::string>(key)) {
				continue;
			}
			def->on[std::get<std::string>(key)] = readStateEventDefinition(value, runtime);
		}
	}

	Value inputHandlersVal = table->get(std::string("input_event_handlers"));
	if (!isNil(inputHandlersVal)) {
		auto inputTable = std::get<std::shared_ptr<Table>>(inputHandlersVal);
		for (const auto& [key, value] : inputTable->entries()) {
			if (!std::holds_alternative<std::string>(key)) {
				continue;
			}
			def->input_event_handlers[std::get<std::string>(key)] = readStateEventDefinition(value, runtime);
		}
	}

	Value timelinesVal = table->get(std::string("timelines"));
	if (!isNil(timelinesVal)) {
		auto timelinesTable = std::get<std::shared_ptr<Table>>(timelinesVal);
		StateTimelineMap timelineMap;
		for (const auto& [key, value] : timelinesTable->entries()) {
			if (!std::holds_alternative<std::string>(key)) {
				continue;
			}
			auto configTable = std::get<std::shared_ptr<Table>>(value);
			StateTimelineConfig config;
			config.autoplay = true;
			config.stop_on_exit = true;

			Value idVal = configTable->get(std::string("id"));
			if (!isNil(idVal)) {
				config.id = std::get<std::string>(idVal);
			}

			Value autoplayVal = configTable->get(std::string("autoplay"));
			if (!isNil(autoplayVal)) {
				config.autoplay = isTruthy(autoplayVal);
			}

			Value stopVal = configTable->get(std::string("stop_on_exit"));
			if (!isNil(stopVal)) {
				config.stop_on_exit = isTruthy(stopVal);
			}

			Value playOptionsVal = configTable->get(std::string("play_options"));
			if (!isNil(playOptionsVal)) {
				auto optsTable = std::get<std::shared_ptr<Table>>(playOptionsVal);
				config.play_options = readTimelinePlayOptions(optsTable);
			}

			Value createVal = configTable->get(std::string("create"));
			auto closure = std::get<std::shared_ptr<Closure>>(createVal);
			config.create = [&runtime, closure]() -> std::unique_ptr<Timeline<std::any>> {
				auto results = runtime.callLuaFunction(closure, {});
				if (results.empty()) {
					throw std::runtime_error("[VMApi] Timeline create() returned no value.");
				}
				return takeTimelineFromValue(results[0]);
			};

			timelineMap[std::get<std::string>(key)] = std::move(config);
		}
		if (!timelineMap.empty()) {
			def->timelines = std::move(timelineMap);
		}
	}

	Value statesVal = table->get(std::string("states"));
	if (!isNil(statesVal)) {
		auto statesTable = std::get<std::shared_ptr<Table>>(statesVal);
		for (const auto& [key, value] : statesTable->entries()) {
			if (!std::holds_alternative<std::string>(key)) {
				continue;
			}
			const std::string& stateId = std::get<std::string>(key);
			auto stateTable = std::get<std::shared_ptr<Table>>(value);
			StateDefinition* childDef = def->addState(stateId);
			populateStateDefinition(childDef, stateTable, runtime);
			if (childDef->isStartState()) {
				if (def->initial && def->initial.value() != childDef->id) {
					throw std::runtime_error("[VMApi] Multiple start states defined for '" + def->id + "'.");
				}
				def->initial = childDef->id;
			}
		}
	}
}

} // namespace

VMApi::VMApi(VMRuntime& runtime)
	: m_runtime(runtime)
	, m_persistentData(PERSISTENT_DATA_SIZE, 0.0)
{
	reset_print_cursor();
}

VMApi::~VMApi() = default;

void VMApi::registerAllFunctions() {
	// Register display functions
	m_runtime.registerNativeFunction("display_width", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_width())};
	});

	m_runtime.registerNativeFunction("display_height", [this](const std::vector<Value>&) -> std::vector<Value> {
		return {static_cast<double>(display_height())};
	});

	m_runtime.registerNativeFunction("cls", [this](const std::vector<Value>& args) -> std::vector<Value> {
		int colorIndex = args.empty() ? 0 : static_cast<int>(asNumber(args[0]));
		cls(colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("rect", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 6) return {};
		int x0 = static_cast<int>(asNumber(args[0]));
		int y0 = static_cast<int>(asNumber(args[1]));
		int x1 = static_cast<int>(asNumber(args[2]));
		int y1 = static_cast<int>(asNumber(args[3]));
		int z = static_cast<int>(asNumber(args[4]));
		int colorIndex = static_cast<int>(asNumber(args[5]));
		rect(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("rectfill", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 6) return {};
		int x0 = static_cast<int>(asNumber(args[0]));
		int y0 = static_cast<int>(asNumber(args[1]));
		int x1 = static_cast<int>(asNumber(args[2]));
		int y1 = static_cast<int>(asNumber(args[3]));
		int z = static_cast<int>(asNumber(args[4]));
		int colorIndex = static_cast<int>(asNumber(args[5]));
		rectfill(x0, y0, x1, y1, z, colorIndex);
		return {};
	});

	m_runtime.registerNativeFunction("write", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& text = asString(args.at(0));
		int x = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : m_textCursorX;
		int y = args.size() > 2 ? static_cast<int>(asNumber(args[2])) : m_textCursorY;
		int z = args.size() > 3 ? static_cast<int>(asNumber(args[3])) : 0;
		int colorIndex = args.size() > 4 ? static_cast<int>(asNumber(args[4])) : m_textCursorColorIndex;
		bool autoAdvance = args.size() <= 1;
		write(text, x, y, z, colorIndex);
		if (autoAdvance) {
			m_textCursorX = m_textCursorHomeX;
			m_textCursorY += 8;
		}
		return {};
	});

	// Register input functions
	m_runtime.registerNativeFunction("mousebtn", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtn(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousebtnp", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtnp(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousebtnr", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		int btn = static_cast<int>(asNumber(args[0]));
		return {mousebtnr(static_cast<VMPointerButton>(btn))};
	});

	m_runtime.registerNativeFunction("mousepos", [this](const std::vector<Value>&) -> std::vector<Value> {
		auto pos = mousepos();
		auto result = std::make_shared<Table>();
		result->set(std::string("x"), static_cast<double>(pos.x));
		result->set(std::string("y"), static_cast<double>(pos.y));
		return {result};
	});

	m_runtime.registerNativeFunction("action_triggered", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {false};
		std::string action = asString(args[0]);
		int playerIndex = args.size() > 1 ? static_cast<int>(asNumber(args[1])) : 1;
		return {action_triggered(action, playerIndex)};
	});

	// Register audio functions
	m_runtime.registerNativeFunction("sfx", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		sfx(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("stop_sfx", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_sfx();
		return {};
	});

	m_runtime.registerNativeFunction("music", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		music(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("stop_music", [this](const std::vector<Value>&) -> std::vector<Value> {
		stop_music();
		return {};
	});

	// Register storage functions
	m_runtime.registerNativeFunction("cartdata", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {};
		cartdata(asString(args[0]));
		return {};
	});

	m_runtime.registerNativeFunction("dset", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.size() < 2) return {};
		dset(static_cast<int>(asNumber(args[0])), asNumber(args[1]));
		return {};
	});

	m_runtime.registerNativeFunction("dget", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {dget(static_cast<int>(asNumber(args[0])))};
	});

	// Register system functions
	m_runtime.registerNativeFunction("stat", [this](const std::vector<Value>& args) -> std::vector<Value> {
		if (args.empty()) return {0.0};
		return {stat(static_cast<int>(asNumber(args[0])))};
	});

	m_runtime.registerNativeFunction("reboot", [this](const std::vector<Value>&) -> std::vector<Value> {
		reboot();
		return {};
	});

	// World object definitions
	m_runtime.registerNativeFunction("define_world_object", [this](const std::vector<Value>& args) -> std::vector<Value> {
		auto descriptor = std::get<std::shared_ptr<Table>>(args.at(0));
		VmWorldObjectDefinition def;
		def.defId = std::get<std::string>(descriptor->get(std::string("def_id")));

		Value classVal = descriptor->get(std::string("class"));
		if (!isNil(classVal)) {
			def.classTable = std::get<std::shared_ptr<Table>>(classVal);
		}

		Value defaultsVal = descriptor->get(std::string("defaults"));
		if (!isNil(defaultsVal)) {
			def.defaults = std::get<std::shared_ptr<Table>>(defaultsVal);
		}

		Value fsmsVal = descriptor->get(std::string("fsms"));
		if (!isNil(fsmsVal)) {
			auto fsmsTable = std::get<std::shared_ptr<Table>>(fsmsVal);
			def.fsms = readStringArray(fsmsTable);
		}

		m_worldObjectDefs[def.defId] = std::move(def);
		return {};
	});

	// FSM definitions
	m_runtime.registerNativeFunction("define_fsm", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& defId = std::get<std::string>(args.at(0));
		auto blueprint = std::get<std::shared_ptr<Table>>(args.at(1));
		auto def = std::make_unique<StateDefinition>(defId);
		populateStateDefinition(def.get(), blueprint, m_runtime);
		def->validate();
		StateDefinitions::instance().unregister(defId);
		StateDefinitions::instance().registerDefinition(std::move(def));
		return {};
	});

	// Timeline creation
	m_runtime.registerNativeFunction("new_timeline", [](const std::vector<Value>& args) -> std::vector<Value> {
		auto table = std::get<std::shared_ptr<Table>>(args.at(0));
		auto definition = readTimelineDefinition(table);
		auto handle = std::make_shared<VmTimelineHandle>();
		handle->timeline = std::make_unique<Timeline<std::any>>(definition);

		auto native = createNativeObject(
			handle.get(),
			[handle](const Value& key) -> Value {
				auto* keyStr = std::get_if<std::string>(&key);
				if (!keyStr) {
					return std::monostate{};
				}
				if (*keyStr == "id") {
					return handle->timeline ? Value{handle->timeline->id} : Value{std::monostate{}};
				}
				if (*keyStr == "length") {
					return handle->timeline ? Value{static_cast<double>(handle->timeline->length())} : Value{std::monostate{}};
				}
				return std::monostate{};
			},
			[](const Value&, const Value&) {}
		);

		return {native};
	});

	// World object access
	m_runtime.registerNativeFunction("world_object", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& id = std::get<std::string>(args.at(0));
		auto* obj = EngineCore::instance().world()->getObject(id);
		if (!obj) {
			throw std::runtime_error("[VMApi] World object '" + id + "' not found.");
		}
		auto* vmObj = dynamic_cast<VMWorldObject*>(obj);
		if (!vmObj) {
			throw std::runtime_error("[VMApi] World object '" + id + "' is not a VMWorldObject.");
		}
		return {vmObj->nativeHandle()};
	});

	// Spawn world objects
	m_runtime.registerNativeFunction("spawn_object", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& defId = std::get<std::string>(args.at(0));
		std::shared_ptr<Table> overrides;
		if (args.size() > 1 && !isNil(args[1])) {
			overrides = std::get<std::shared_ptr<Table>>(args[1]);
		}

		VmWorldObjectDefinition* def = nullptr;
		auto defIt = m_worldObjectDefs.find(defId);
		if (defIt != m_worldObjectDefs.end()) {
			def = &defIt->second;
		}

		std::string classId;
		if (def && def->classTable) {
			Value idVal = def->classTable->get(std::string("id"));
			if (!isNil(idVal)) {
				classId = std::get<std::string>(idVal);
			}
		}

		std::string overrideId;
		if (overrides) {
			Value idVal = overrides->get(std::string("id"));
			if (!isNil(idVal)) {
				overrideId = std::get<std::string>(idVal);
			}
		}

		const std::string instanceId = !overrideId.empty() ? overrideId : (!classId.empty() ? classId : defId);

		auto obj = std::make_unique<VMWorldObject>(instanceId);
		if (def && def->defaults) {
			applyTableToObject(obj.get(), def->defaults);
		}
		if (def && def->classTable) {
			applyTableToObject(obj.get(), def->classTable, &CLASS_OVERRIDE_EXCLUSIONS);
		}
		if (overrides) {
			applyTableToObject(obj.get(), overrides);
		}

		if (def && !def->fsms.empty()) {
			const std::string& fsmId = def->fsms.front();
			auto* fsmDef = StateDefinitions::instance().get(fsmId);
			if (!fsmDef) {
				throw std::runtime_error("[VMApi] FSM definition '" + fsmId + "' not found for '" + defId + "'.");
			}
			obj->sc = std::make_unique<StateMachineController>(fsmDef, obj.get());
		}

		std::optional<Vec3> spawnPos;
		if (overrides) {
			Value posVal = overrides->get(std::string("pos"));
			if (!isNil(posVal)) {
				spawnPos = readVec3(posVal);
			}
		}

		VMWorldObject* objPtr = obj.get();
		m_spawnedObjects.push_back(std::move(obj));
		EngineCore::instance().spawn(objPtr, spawnPos ? &(*spawnPos) : nullptr);

		auto spawnEvent = std::make_shared<Table>();
		if (spawnPos) {
			spawnEvent->set(std::string("pos"), makeVec3Table(*spawnPos));
		}
		spawnEvent->set(std::string("reason"), std::string("fresh"));
		callObjectHook(m_runtime, objPtr, "on_spawn", {objPtr->nativeHandle(), spawnEvent});

		return {objPtr->nativeHandle()};
	});

	m_runtime.registerNativeFunction("spawn_sprite", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& defId = std::get<std::string>(args.at(0));
		std::shared_ptr<Table> overrides;
		if (args.size() > 1 && !isNil(args[1])) {
			overrides = std::get<std::shared_ptr<Table>>(args[1]);
		}

		VmWorldObjectDefinition* def = nullptr;
		auto defIt = m_worldObjectDefs.find(defId);
		if (defIt != m_worldObjectDefs.end()) {
			def = &defIt->second;
		}

		std::string classId;
		if (def && def->classTable) {
			Value idVal = def->classTable->get(std::string("id"));
			if (!isNil(idVal)) {
				classId = std::get<std::string>(idVal);
			}
		}

		std::string overrideId;
		if (overrides) {
			Value idVal = overrides->get(std::string("id"));
			if (!isNil(idVal)) {
				overrideId = std::get<std::string>(idVal);
			}
		}

		const std::string instanceId = !overrideId.empty() ? overrideId : (!classId.empty() ? classId : defId);

		auto obj = std::make_unique<VMSpriteObject>(instanceId);
		if (def && def->defaults) {
			applyTableToObject(obj.get(), def->defaults);
		}
		if (def && def->classTable) {
			applyTableToObject(obj.get(), def->classTable, &CLASS_OVERRIDE_EXCLUSIONS);
		}
		if (overrides) {
			applyTableToObject(obj.get(), overrides);
		}

		if (def && !def->fsms.empty()) {
			const std::string& fsmId = def->fsms.front();
			auto* fsmDef = StateDefinitions::instance().get(fsmId);
			if (!fsmDef) {
				throw std::runtime_error("[VMApi] FSM definition '" + fsmId + "' not found for '" + defId + "'.");
			}
			obj->sc = std::make_unique<StateMachineController>(fsmDef, obj.get());
		}

		std::optional<Vec3> spawnPos;
		if (overrides) {
			Value posVal = overrides->get(std::string("pos"));
			if (!isNil(posVal)) {
				spawnPos = readVec3(posVal);
			}
		}

		VMSpriteObject* objPtr = obj.get();
		m_spawnedObjects.push_back(std::move(obj));
		EngineCore::instance().spawn(objPtr, spawnPos ? &(*spawnPos) : nullptr);

		auto spawnEvent = std::make_shared<Table>();
		if (spawnPos) {
			spawnEvent->set(std::string("pos"), makeVec3Table(*spawnPos));
		}
		spawnEvent->set(std::string("reason"), std::string("fresh"));
		callObjectHook(m_runtime, objPtr, "on_spawn", {objPtr->nativeHandle(), spawnEvent});

		return {objPtr->nativeHandle()};
	});

	m_runtime.registerNativeFunction("spawn_textobject", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& defId = std::get<std::string>(args.at(0));
		std::shared_ptr<Table> overrides;
		if (args.size() > 1 && !isNil(args[1])) {
			overrides = std::get<std::shared_ptr<Table>>(args[1]);
		}

		VmWorldObjectDefinition* def = nullptr;
		auto defIt = m_worldObjectDefs.find(defId);
		if (defIt != m_worldObjectDefs.end()) {
			def = &defIt->second;
		}

		std::string classId;
		if (def && def->classTable) {
			Value idVal = def->classTable->get(std::string("id"));
			if (!isNil(idVal)) {
				classId = std::get<std::string>(idVal);
			}
		}

		std::string overrideId;
		if (overrides) {
			Value idVal = overrides->get(std::string("id"));
			if (!isNil(idVal)) {
				overrideId = std::get<std::string>(idVal);
			}
		}

		const std::string instanceId = !overrideId.empty() ? overrideId : (!classId.empty() ? classId : defId);

		auto* view = EngineCore::instance().view();
		auto obj = std::make_unique<VMTextObject>(instanceId, view->default_font);
		if (def && def->defaults) {
			applyTableToObject(obj.get(), def->defaults);
		}
		if (def && def->classTable) {
			applyTableToObject(obj.get(), def->classTable, &CLASS_OVERRIDE_EXCLUSIONS);
		}
		if (overrides) {
			applyTableToObject(obj.get(), overrides);
		}

		if (def && !def->fsms.empty()) {
			const std::string& fsmId = def->fsms.front();
			auto* fsmDef = StateDefinitions::instance().get(fsmId);
			if (!fsmDef) {
				throw std::runtime_error("[VMApi] FSM definition '" + fsmId + "' not found for '" + defId + "'.");
			}
			obj->sc = std::make_unique<StateMachineController>(fsmDef, obj.get());
		}

		std::optional<Vec3> spawnPos;
		if (overrides) {
			Value posVal = overrides->get(std::string("pos"));
			if (!isNil(posVal)) {
				spawnPos = readVec3(posVal);
			}
		}

		VMTextObject* objPtr = obj.get();
		m_spawnedObjects.push_back(std::move(obj));
		EngineCore::instance().spawn(objPtr, spawnPos ? &(*spawnPos) : nullptr);

		auto spawnEvent = std::make_shared<Table>();
		if (spawnPos) {
			spawnEvent->set(std::string("pos"), makeVec3Table(*spawnPos));
		}
		spawnEvent->set(std::string("reason"), std::string("fresh"));
		callObjectHook(m_runtime, objPtr, "on_spawn", {objPtr->nativeHandle(), spawnEvent});

		return {objPtr->nativeHandle()};
	});

	// Global $ helpers
	auto dollarTable = std::make_shared<Table>();
	dollarTable->set(std::string("emit"), createNativeFunction("$.emit", [this](const std::vector<Value>& args) -> std::vector<Value> {
		const std::string& eventName = std::get<std::string>(args.at(0));
		std::string emitter;
		if (args.size() > 1 && !isNil(args[1])) {
			emitter = std::get<std::string>(args[1]);
		}

		GameEvent evt;
		evt.type = eventName;
		evt.emitter = emitter;
		evt.timestamp = EngineCore::instance().clock()->now();

		if (args.size() > 2 && !isNil(args[2])) {
			auto payloadTable = std::get<std::shared_ptr<Table>>(args[2]);
			evt.payload = readPayloadMap(payloadTable);
		}

		auto* world = EngineCore::instance().world();
		for (auto* obj : world->objects()) {
			if (!obj->eventhandling_enabled || !obj->stateController()) {
				continue;
			}
			obj->stateController()->dispatch(evt);
		}
		if (world->sc) {
			world->sc->dispatch(evt);
		}

		return {};
	}));
	dollarTable->set(std::string("consume_action"), createNativeFunction("$.consume_action", [](const std::vector<Value>&) -> std::vector<Value> {
		return {};
	}));
	m_runtime.setGlobal("$", dollarTable);
}

void VMApi::reset_print_cursor() {
	m_textCursorX = 0;
	m_textCursorY = 0;
	m_textCursorHomeX = 0;
	m_textCursorColorIndex = 15;
}

std::string VMApi::pointer_action(VMPointerButton button) const {
	int index = static_cast<int>(button);
	if (index >= 0 && index < static_cast<int>(POINTER_ACTIONS.size())) {
		return POINTER_ACTIONS[index];
	}
	return "pointer_primary";
}

// ==========================================================================
// Display functions implementation
// ==========================================================================

int VMApi::display_width() const {
	return m_runtime.viewport().x;
}

int VMApi::display_height() const {
	return m_runtime.viewport().y;
}

void VMApi::cls(int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{0.0f, 0.0f, static_cast<f32>(display_width()), static_cast<f32>(display_height())};
	view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
	reset_print_cursor();
}

void VMApi::rect(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	view->drawRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::rectfill(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
	auto* view = EngineCore::instance().view();
	RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0), static_cast<f32>(x1), static_cast<f32>(y1)};
	view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::write(const std::string& text, int x, int y, int z, int colorIndex) {
	auto* view = EngineCore::instance().view();
	GlyphRenderSubmission submission;
	submission.text = text;
	submission.x = static_cast<f32>(x);
	submission.y = static_cast<f32>(y);
	submission.z = static_cast<f32>(z);
	submission.color = paletteColor(colorIndex);
	view->renderer.submit.glyphs(submission);
}

// ==========================================================================
// Input functions implementation
// ==========================================================================

bool VMApi::mousebtn(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

bool VMApi::mousebtnp(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

bool VMApi::mousebtnr(VMPointerButton /*button*/) const {
	// TODO: Query input system
	return false;
}

VMPointerViewport VMApi::mousepos() const {
	// TODO: Query input system
	return {0, 0};
}

VMPointerVector VMApi::pointer_screen_position() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

VMPointerVector VMApi::pointer_delta() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

VMPointerWheel VMApi::mousewheel() const {
	// TODO: Query input system
	return {0.0f, 0.0f};
}

bool VMApi::action_triggered(const std::string& /*actionDefinition*/, int /*playerIndex*/) const {
	// TODO: Query input system
	return false;
}

// ==========================================================================
// Audio functions implementation
// ==========================================================================

void VMApi::sfx(const std::string& /*id*/) {
	// TODO: Play sound effect
}

void VMApi::stop_sfx() {
	// TODO: Stop sound effects
}

void VMApi::music(const std::string& /*id*/) {
	// TODO: Play music
}

void VMApi::stop_music() {
	// TODO: Stop music
}

// ==========================================================================
// Storage functions implementation
// ==========================================================================

void VMApi::cartdata(const std::string& ns) {
	m_cartDataNamespace = ns;
	// TODO: Load persistent data from storage
}

void VMApi::dset(int index, double value) {
	if (index >= 0 && index < PERSISTENT_DATA_SIZE) {
		m_persistentData[index] = value;
		// TODO: Save to persistent storage
	}
}

double VMApi::dget(int index) const {
	if (index >= 0 && index < PERSISTENT_DATA_SIZE) {
		return m_persistentData[index];
	}
	return 0.0;
}

// ==========================================================================
// System functions implementation
// ==========================================================================

double VMApi::stat(int index) const {
	switch (index) {
		case 0:  // Memory usage (KB)
			return 0.0;
		case 1:  // CPU usage (fraction)
			return 0.0;
		case 4:  // Clipboard contents (as string - not returning string here)
			return 0.0;
		case 7:  // Frame rate
			return 60.0;
		case 30: // Key input
			return 0.0;
		case 31: // Key input repeat
			return 0.0;
		case 32: // Mouse X
			return mousepos().x;
		case 33: // Mouse Y
			return mousepos().y;
		case 34: // Mouse button bitmask
			return 0.0;
		case 36: // Mouse wheel X
			return mousewheel().x;
		case 37: // Mouse wheel Y
			return mousewheel().y;
		default:
			return 0.0;
	}
}

void VMApi::reboot() {
	m_runtime.requestProgramReload();
}

} // namespace bmsx
