#include "vm_api.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <sstream>
#include <unordered_set>

#include "../component/component.h"
#include "../component/spritecomponent.h"
#include "../core/engine.h"
#include "../core/registry.h"
#include "../core/textobject.h"
#include "../fsm/fsmcontroller.h"
#include "../fsm/fsmlibrary.h"
#include "../fsm/state.h"
#include "vm_runtime.h"

namespace bmsx {

static const std::array<Color, 16> MSX1_PALETTE = {
    Color::fromRGBA8(0, 0, 0, 0),         Color::fromRGBA8(0, 0, 0, 255),
    Color::fromRGBA8(0, 241, 20, 255),    Color::fromRGBA8(68, 249, 86, 255),
    Color::fromRGBA8(85, 79, 255, 255),   Color::fromRGBA8(128, 111, 255, 255),
    Color::fromRGBA8(250, 80, 51, 255),   Color::fromRGBA8(12, 255, 255, 255),
    Color::fromRGBA8(255, 81, 52, 255),   Color::fromRGBA8(255, 115, 86, 255),
    Color::fromRGBA8(226, 210, 4, 255),   Color::fromRGBA8(242, 217, 71, 255),
    Color::fromRGBA8(4, 212, 19, 255),    Color::fromRGBA8(231, 80, 229, 255),
    Color::fromRGBA8(208, 208, 208, 255), Color::fromRGBA8(255, 255, 255, 255),
};

static const Color& paletteColor(int index) {
  return MSX1_PALETTE[static_cast<size_t>(index)];
}

namespace {

struct VmTimelineHandle {
  std::unique_ptr<Timeline<std::any>> timeline;

  std::unique_ptr<Timeline<std::any>> take() { return std::move(timeline); }
};

const std::unordered_set<std::string> CLASS_OVERRIDE_EXCLUSIONS = {
    "def_id",      "class",     "defaults", "metatable",
    "constructor", "prototype", "super",    "__index",
};

std::string toLower(std::string value) {
  std::transform(
      value.begin(), value.end(), value.begin(),
      [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return value;
}

TimelinePlaybackMode parsePlaybackMode(const std::string& value) {
  const std::string normalized = toLower(value);
  if (normalized == "once") return TimelinePlaybackMode::Once;
  if (normalized == "loop") return TimelinePlaybackMode::Loop;
  if (normalized == "pingpong") return TimelinePlaybackMode::PingPong;
  throw std::runtime_error("[VMApi] Unknown timeline playback mode '" + value +
                           "'.");
}

std::shared_ptr<Table> makeVec3Table(const Vec3& v) {
  auto tbl = std::make_shared<Table>();
  tbl->set(std::string("x"), static_cast<double>(v.x));
  tbl->set(std::string("y"), static_cast<double>(v.y));
  tbl->set(std::string("z"), static_cast<double>(v.z));
  return tbl;
}

std::shared_ptr<Table> makeVec2Table(const Vec2& v) {
  auto tbl = std::make_shared<Table>();
  tbl->set(std::string("x"), static_cast<double>(v.x));
  tbl->set(std::string("y"), static_cast<double>(v.y));
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

Vec2 readVec2(const Value& value) {
  auto tbl = std::get<std::shared_ptr<Table>>(value);
  Vec2 out;
  out.x = static_cast<f32>(asNumber(tbl->get(std::string("x"))));
  out.y = static_cast<f32>(asNumber(tbl->get(std::string("y"))));
  return out;
}

RectBounds readRectBounds(const Value& value) {
  auto tbl = std::get<std::shared_ptr<Table>>(value);
  RectBounds out;
  out.left = static_cast<f32>(asNumber(tbl->get(std::string("left"))));
  out.right = static_cast<f32>(asNumber(tbl->get(std::string("right"))));
  out.top = static_cast<f32>(asNumber(tbl->get(std::string("top"))));
  out.bottom = static_cast<f32>(asNumber(tbl->get(std::string("bottom"))));
  return out;
}

std::shared_ptr<Table> makeRectBoundsTable(const RectBounds& rect) {
  auto tbl = std::make_shared<Table>();
  tbl->set(std::string("left"), static_cast<double>(rect.left));
  tbl->set(std::string("right"), static_cast<double>(rect.right));
  tbl->set(std::string("top"), static_cast<double>(rect.top));
  tbl->set(std::string("bottom"), static_cast<double>(rect.bottom));
  return tbl;
}

Color readColor(const Value& value) {
  auto tbl = std::get<std::shared_ptr<Table>>(value);
  Color out;
  out.r = static_cast<f32>(asNumber(tbl->get(std::string("r"))));
  out.g = static_cast<f32>(asNumber(tbl->get(std::string("g"))));
  out.b = static_cast<f32>(asNumber(tbl->get(std::string("b"))));
  out.a = static_cast<f32>(asNumber(tbl->get(std::string("a"))));
  return out;
}

std::shared_ptr<Table> makeColorTable(const Color& color) {
  auto tbl = std::make_shared<Table>();
  tbl->set(std::string("r"), static_cast<double>(color.r));
  tbl->set(std::string("g"), static_cast<double>(color.g));
  tbl->set(std::string("b"), static_cast<double>(color.b));
  tbl->set(std::string("a"), static_cast<double>(color.a));
  return tbl;
}

std::shared_ptr<NativeObject> makeComponentHandle(Component* comp) {
  return createNativeObject(
      comp,
      [comp](const Value& key) -> Value {
      });
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

std::shared_ptr<Table> toTable(const std::vector<std::string>& lines) {
  auto tbl = std::make_shared<Table>();
  for (size_t i = 0; i < lines.size(); ++i)
    tbl->set(static_cast<double>(i + 1), lines[i]);
  return tbl;
}

std::string joinLines(const std::vector<std::string>& lines) {
  if (lines.empty()) return std::string();
  std::ostringstream oss;
  for (size_t i = 0; i < lines.size(); ++i) {
    if (i > 0) oss << "\n";
    oss << lines[i];
  }
  return oss.str();
}

std::vector<std::string> toStringLines(const Value& value) {
  if (auto* s = std::get_if<std::string>(&value)) {
    std::vector<std::string> lines;
    std::string current;
    for (char c : *s) {
      if (c == '\n') {
        lines.push_back(current);
        current.clear();
        continue;
      }
      current.push_back(c);
    }
    lines.push_back(current);
    return lines;
  }

  auto tbl = std::get<std::shared_ptr<Table>>(value);
  std::vector<std::string> lines;
  const auto entries = tbl->entries();
  for (const auto& [key, val] : entries) {
    if (!std::holds_alternative<double>(key)) continue;
    lines.push_back(valueToString(val));
  }
  return lines;
}

std::any valueToAny(const Value& value) { return value; }

Value anyToValue(const std::any& value) {
  if (!value.has_value()) return std::monostate{};
  if (value.type() == typeid(Value)) return std::any_cast<Value>(value);
  if (value.type() == typeid(std::string))
    return std::any_cast<std::string>(value);
  if (value.type() == typeid(const char*))
    return std::string(std::any_cast<const char*>(value));
  if (value.type() == typeid(double)) return std::any_cast<double>(value);
  if (value.type() == typeid(float))
    return static_cast<double>(std::any_cast<float>(value));
  if (value.type() == typeid(int))
    return static_cast<double>(std::any_cast<int>(value));
  if (value.type() == typeid(bool)) return std::any_cast<bool>(value);
  if (value.type() == typeid(std::shared_ptr<Table>))
    return std::any_cast<std::shared_ptr<Table>>(value);
  if (value.type() == typeid(std::shared_ptr<NativeObject>))
    return std::any_cast<std::shared_ptr<NativeObject>>(value);
  if (value.type() == typeid(std::shared_ptr<NativeFunction>))
    return std::any_cast<std::shared_ptr<NativeFunction>>(value);
  return std::monostate{};
}

VMApi::VMApi(VMRuntime& runtime)
    : m_runtime(runtime), m_persistentData(PERSISTENT_DATA_SIZE, 0.0) {
  reset_print_cursor();
}

VMApi::~VMApi() = default;

void VMApi::registerAllFunctions() {
  // Register display functions
  m_runtime.registerNativeFunction(
      "display_width", [this](const std::vector<Value>&) -> std::vector<Value> {
        return {static_cast<double>(display_width())};
      });

  m_runtime.registerNativeFunction(
      "display_height",
      [this](const std::vector<Value>&) -> std::vector<Value> {
        return {static_cast<double>(display_height())};
      });

  m_runtime.registerNativeFunction(
      "cls", [this](const std::vector<Value>& args) -> std::vector<Value> {
        int colorIndex = args.empty() ? 0 : static_cast<int>(asNumber(args[0]));
        cls(colorIndex);
        return {};
      });

  m_runtime.registerNativeFunction(
      "rect", [this](const std::vector<Value>& args) -> std::vector<Value> {
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

  m_runtime.registerNativeFunction(
      "rectfill", [this](const std::vector<Value>& args) -> std::vector<Value> {
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

  m_runtime.registerNativeFunction(
      "write", [this](const std::vector<Value>& args) -> std::vector<Value> {
        const std::string& text = asString(args.at(0));
        int x = args.size() > 1 ? static_cast<int>(asNumber(args[1]))
                                : m_textCursorX;
        int y = args.size() > 2 ? static_cast<int>(asNumber(args[2]))
                                : m_textCursorY;
        int z = args.size() > 3 ? static_cast<int>(asNumber(args[3])) : 0;
        int colorIndex = args.size() > 4 ? static_cast<int>(asNumber(args[4]))
                                         : m_textCursorColorIndex;
        bool autoAdvance = args.size() <= 1;
        write(text, x, y, z, colorIndex);
        if (autoAdvance) {
          m_textCursorX = m_textCursorHomeX;
          m_textCursorY += 8;
        }
        return {};
      });

  m_runtime.registerNativeFunction(
      "action_triggered",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {false};
        std::string action = asString(args[0]);
        int playerIndex =
            args.size() > 1 ? static_cast<int>(asNumber(args[1])) : 1;
        return {action_triggered(action, playerIndex)};
      });

  // Register audio functions
  m_runtime.registerNativeFunction(
      "sfx", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {};
        sfx(asString(args[0]));
        return {};
      });

  m_runtime.registerNativeFunction(
      "stop_sfx", [this](const std::vector<Value>&) -> std::vector<Value> {
        stop_sfx();
        return {};
      });

  m_runtime.registerNativeFunction(
      "music", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {};
        music(asString(args[0]));
        return {};
      });

  m_runtime.registerNativeFunction(
      "stop_music", [this](const std::vector<Value>&) -> std::vector<Value> {
        stop_music();
        return {};
      });

  // Register storage functions
  m_runtime.registerNativeFunction(
      "cartdata", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {};
        cartdata(asString(args[0]));
        return {};
      });

  m_runtime.registerNativeFunction(
      "dset", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.size() < 2) return {};
        dset(static_cast<int>(asNumber(args[0])), asNumber(args[1]));
        return {};
      });

  m_runtime.registerNativeFunction(
      "dget", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {0.0};
        return {dget(static_cast<int>(asNumber(args[0])))};
      });

  // Register system functions
  m_runtime.registerNativeFunction(
      "stat", [this](const std::vector<Value>& args) -> std::vector<Value> {
        if (args.empty()) return {0.0};
        return {stat(static_cast<int>(asNumber(args[0])))};
      });

  m_runtime.registerNativeFunction(
      "reboot", [this](const std::vector<Value>&) -> std::vector<Value> {
        reboot();
        return {};
      });

  // World object definitions
  m_runtime.registerNativeFunction(
      "define_world_object",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        VmWorldObjectDefinition def;
        def.defId =
            std::get<std::string>(descriptor->get(std::string("def_id")));

        Value classVal = descriptor->get(std::string("class"));
        if (!isNil(classVal))
          def.classTable = std::get<std::shared_ptr<Table>>(classVal);

        Value defaultsVal = descriptor->get(std::string("defaults"));
        if (!isNil(defaultsVal))
          def.defaults = std::get<std::shared_ptr<Table>>(defaultsVal);

        Value fsmsVal = descriptor->get(std::string("fsms"));
        if (!isNil(fsmsVal)) {
          auto fsmsTable = std::get<std::shared_ptr<Table>>(fsmsVal);
          def.fsms = readStringArray(fsmsTable);
        }

        m_worldObjectDefs[def.defId] = std::move(def);
        return {};
      });

  // FSM definitions
  m_runtime.registerNativeFunction(
      "define_fsm",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
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
  m_runtime.registerNativeFunction(
      "new_timeline", [](const std::vector<Value>& args) -> std::vector<Value> {
        auto table = std::get<std::shared_ptr<Table>>(args.at(0));
        auto definition = readTimelineDefinition(table);
        auto handle = std::make_shared<VmTimelineHandle>();
        handle->timeline = std::make_unique<Timeline<std::any>>(definition);

        auto native = createNativeObject(
            handle.get(),
            [handle](const Value& key) -> Value {
              auto* keyStr = std::get_if<std::string>(&key);
              if (!keyStr) return std::monostate{};
              if (*keyStr == "id") {
                return handle->timeline ? Value{handle->timeline->id}
                                        : Value{std::monostate{}};
              }
              if (*keyStr == "length") {
                return handle->timeline ? Value{static_cast<double>(
                                              handle->timeline->length())}
                                        : Value{std::monostate{}};
              }
              return std::monostate{};
            },
            [](const Value&, const Value&) {});

        return {native};
      });

  // World object access
  m_runtime.registerNativeFunction(
      "world_object",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        const std::string& id = std::get<std::string>(args.at(0));
        auto* obj = EngineCore::instance().world()->getObject(id);
        if (!obj)
          throw std::runtime_error("[VMApi] World object '" + id +
                                   "' not found.");
        return {getNativeHandle(obj)};
      });

  // Spawn world objects
  m_runtime.registerNativeFunction(
      "spawn_object",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        throw std::runtime_error(
            "[VMApi] spawn_object is not implemented "
            "yet, because Codex cannot "
            "understand how to do it properly.");
      });

  m_runtime.registerNativeFunction(
      "spawn_sprite",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        throw std::runtime_error(
            "[VMApi] spawn_sprite is not implemented "
            "yet, because Codex cannot "
            "understand how to do it properly.");
      });

  m_runtime.registerNativeFunction(
      "spawn_textobject",
      [this](const std::vector<Value>& args) -> std::vector<Value> {
        throw std::runtime_error(
            "[VMApi] spawn_textobject is not implemented yet, because Codex "
            "cannot understand how to do it properly.");
      });

  // Global $ helpers
  auto dollarTable = std::make_shared<Table>();
  dollarTable->set(
      std::string("emit"),
      createNativeFunction(
          "$.emit",
          [this](const std::vector<Value>& args) -> std::vector<Value> {
            const std::string& eventName = std::get<std::string>(args.at(0));
            std::string emitter;
            if (args.size() > 1 && !isNil(args[1]))
              emitter = std::get<std::string>(args[1]);

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
              if (!obj->eventhandling_enabled || !obj->stateController())
                continue;
              obj->stateController()->dispatch(evt);
            }
            if (world->sc) world->sc->dispatch(evt);

            return {};
          }));
  dollarTable->set(
      std::string("consume_action"),
      createNativeFunction(
          "$.consume_action",
          [](const std::vector<Value>&) -> std::vector<Value> { return {}; }));
  m_runtime.setGlobal("$", dollarTable);
}

std::shared_ptr<NativeObject> VMApi::getNativeHandle(WorldObject* obj) {
  auto it = m_nativeHandles.find(obj);
  if (it != m_nativeHandles.end()) return it->second;
  auto native = createNativeObject(
      obj,
      [this, obj](const Value& key) -> Value {
        const std::string& prop = std::get<std::string>(key);
        return getObjectProperty(obj, prop);
      },
      [this, obj](const Value& key, const Value& value) {
        const std::string& prop = std::get<std::string>(key);
        setObjectProperty(obj, prop, value);
      });
  m_nativeHandles.emplace(obj, native);
  return native;
}

Value VMApi::getObjectProperty(WorldObject* obj, const std::string& key) {
  if (obj->hasDynamicProperty(key)) {
    return anyToValue(obj->getDynamicProperty(key));
  }
  return getNativeProperty(obj, key);
}

void VMApi::setObjectProperty(WorldObject* obj, const std::string& key,
                              const Value& value) {
  if (setNativeProperty(obj, key, value)) return;
  obj->setDynamicProperty(key, valueToAny(value));
}

Value VMApi::getCachedMethod(WorldObject* obj, const std::string& key,
                             NativeFunctionInvoke invoke) {
  auto& cache = m_methodCache[obj];
  auto it = cache.find(key);
  if (it != cache.end()) return it->second;
  auto fn = createNativeFunction(key, std::move(invoke));
  cache.emplace(key, fn);
  return fn;
}

void VMApi::applyTableToObject(WorldObject* obj,
                               const std::shared_ptr<Table>& table,
                               const std::unordered_set<std::string>* exclusions) {
  if (!table) return;
  const auto entries = table->entries();
  for (const auto& [key, value] : entries) {
    const std::string& prop = std::get<std::string>(key);
    if (exclusions && exclusions->count(prop) > 0) continue;
    setObjectProperty(obj, prop, value);
  }
}

void VMApi::applyClassAddons(WorldObject* obj,
                             const std::shared_ptr<Table>& table,
                             const std::unordered_set<std::string>* exclusions) {
  const auto* filter = exclusions ? exclusions : &CLASS_OVERRIDE_EXCLUSIONS;
  applyTableToObject(obj, table, filter);
}

void VMApi::callObjectHook(WorldObject* obj, const std::string& hook,
                           const std::vector<Value>& args) {
  Value hookValue = getObjectProperty(obj, hook);
  if (auto fn = std::get_if<std::shared_ptr<NativeFunction>>(&hookValue)) {
    (*fn)->invoke(args);
    return;
  }
  if (auto closure = std::get_if<std::shared_ptr<Closure>>(&hookValue)) {
    m_runtime.callLuaFunction(*closure, args);
    return;
  }
}

void VMApi::reset_print_cursor() {
  m_textCursorX = 0;
  m_textCursorY = 0;
  m_textCursorHomeX = 0;
  m_textCursorColorIndex = 15;
}

// ==========================================================================
// Display functions implementation
// ==========================================================================

int VMApi::display_width() const { return m_runtime.viewport().x; }

int VMApi::display_height() const { return m_runtime.viewport().y; }

void VMApi::cls(int colorIndex) {
  auto* view = EngineCore::instance().view();
  RectBounds area{0.0f, 0.0f, static_cast<f32>(display_width()),
                  static_cast<f32>(display_height())};
  view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
  reset_print_cursor();
}

void VMApi::rect(int x0, int y0, int x1, int y1, int /*z*/, int colorIndex) {
  auto* view = EngineCore::instance().view();
  RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0),
                  static_cast<f32>(x1), static_cast<f32>(y1)};
  view->drawRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::rectfill(int x0, int y0, int x1, int y1, int /*z*/,
                     int colorIndex) {
  auto* view = EngineCore::instance().view();
  RectBounds area{static_cast<f32>(x0), static_cast<f32>(y0),
                  static_cast<f32>(x1), static_cast<f32>(y1)};
  view->fillRectangle(area, paletteColor(colorIndex), RenderLayer::World);
}

void VMApi::write(const std::string& text, int x, int y, int z,
                  int colorIndex) {
  auto* view = EngineCore::instance().view();
  GlyphRenderSubmission submission;
  submission.text = text;
  submission.x = static_cast<f32>(x);
  submission.y = static_cast<f32>(y);
  submission.z = static_cast<f32>(z);
  submission.color = paletteColor(colorIndex);
  view->renderer.submit.glyphs(submission);
}

bool VMApi::action_triggered(const std::string& /*actionDefinition*/,
                             int /*playerIndex*/) const {
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
  if (index >= 0 && index < PERSISTENT_DATA_SIZE)
    return m_persistentData[index];
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
    case 30:  // Key input
      return 0.0;
    case 31:  // Key input repeat
      return 0.0;
    case 32:  // Mouse X
      return mousepos().x;
    case 33:  // Mouse Y
      return mousepos().y;
    case 34:  // Mouse button bitmask
      return 0.0;
    case 36:  // Mouse wheel X
      return mousewheel().x;
    case 37:  // Mouse wheel Y
      return mousewheel().y;
    default:
      return 0.0;
  }
}

void VMApi::reboot() { m_runtime.requestProgramReload(); }

}  // namespace bmsx
