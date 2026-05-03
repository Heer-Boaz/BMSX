#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/font.h"
#include "machine/firmware/input_state_tables.h"
#include "input/models.h"
#include "core/primitives.h"
#include <array>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

class Runtime;

struct RuntimeStorageStateEntry {
	int index = 0;
	double value = 0.0;
};

struct RuntimeStorageState {
	std::string storageNamespace;
	std::vector<RuntimeStorageStateEntry> entries;
};

class Api {
public:
	explicit Api(Runtime& runtime);
	~Api();

	void initializeRuntimeKeys();
	void registerAllFunctions();
	void markRoots(GcHeap& heap);
	void appendRootValues(NativeResults& out) const;
	RuntimeStorageState captureStorageState() const;
	void restoreStorageState(const RuntimeStorageState& state);

	int display_width() const;
	int display_height() const;
	double get_cpu_freq_hz() const;
	void set_cpu_freq_hz(double cpuHz);

	BFont* resolveFontId(uint32_t id) const;
	BFont* resolveFontHandle(const Value& value);
	uint32_t getFontId(BFont* font) const;

	void cartdata(const std::string& ns);

	void reboot();

private:
	struct HotKeys {
		Value x = valueNil();
		Value y = valueNil();
		Value z = valueNil();
		Value r = valueNil();
		Value g = valueNil();
		Value b = valueNil();
		Value a = valueNil();
		Value definition = valueNil();
		Value action = valueNil();
		Value name = valueNil();
		Value valid = valueNil();
		Value inside = valueNil();
		Value value = valueNil();
		Value slot = valueNil();
		Value u = valueNil();
		Value v = valueNil();
		Value w = valueNil();
		Value h = valueNil();
	} m_keys;
	InputStateTableKeys m_inputStateKeys;

	Runtime& m_runtime;
	std::unique_ptr<Font> m_font;
	std::vector<std::unique_ptr<BFont>> m_runtime_fonts;

	std::string m_cartDataNamespace;
	std::vector<double> m_persistentData;

	static constexpr int PERSISTENT_DATA_SIZE = 256;

	Value build_font_descriptor(BFont* font);
	Value make_font_handle(BFont* font);
	BFont* resolve_font(const Value& value);
	BFont* create_font(const Value& definition);

	std::string pointer_button_code(int button) const;
	uint32_t fontId(BFont* font) const;

	std::array<Value, PLAYERS_MAX> m_playerInputHandles = {
		valueNil(),
		valueNil(),
		valueNil(),
		valueNil(),
	};
};

} // namespace bmsx
