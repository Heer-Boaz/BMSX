#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/font.h"
#include "machine/firmware/input_state_tables.h"
#include "input/models.h"
#include "core/primitives.h"
#include "render/shared/submissions.h"
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
	Color palette_color(int index) const;

	BFont* resolveFontId(uint32_t id) const;
	BFont* resolveFontHandle(const Value& value);
	uint32_t getFontId(BFont* font) const;
	void put_mesh(const MeshRenderSubmission& submission);
	void put_particle(const ParticleRenderSubmission& submission);
	void skybox(const std::string& posx,
				const std::string& negx,
				const std::string& posy,
				const std::string& negy,
				const std::string& posz,
				const std::string& negz);
	void set_camera(const std::array<f32, 16>& view, const std::array<f32, 16>& proj, const Vec3& eye);
	void put_ambient_light(const std::string& id, const std::array<f32, 3>& color, f32 intensity);
	void put_directional_light(const std::string& id, const Vec3& orientation, const std::array<f32, 3>& color, f32 intensity);
	void put_point_light(const std::string& id, const Vec3& position, const std::array<f32, 3>& color, f32 range, f32 intensity);

	void cartdata(const std::string& ns);
	void dset(int index, double value);
	double dget(int index) const;

	void set_sprite_parallax_rig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window);
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
	Value get_player_input_handle(int playerIndex);
	BFont* resolve_font(const Value& value);
	BFont* create_font(const Value& definition);

	std::string pointer_button_code(int button) const;
	uint32_t fontId(BFont* font) const;
	Color resolve_color(const Value& value);
	Vec3 read_vec3(const Value& value);
	std::array<f32, 3> read_light_color(const Value& value);
	std::array<f32, 16> read_matrix(const Value& value);

	std::array<Value, PLAYERS_MAX> m_playerInputHandles = {
		valueNil(),
		valueNil(),
		valueNil(),
		valueNil(),
	};
};

} // namespace bmsx
