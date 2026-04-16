#pragma once

#include "machine/cpu/cpu.h"
#include "machine/firmware/font.h"
#include "input/inputtypes.h"
#include "core/types.h"
#include "render/shared/render_types.h"
#include <array>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

class Runtime;

class Api {
public:
	explicit Api(Runtime& runtime);
	~Api();

	void registerAllFunctions();
	void markRoots(GcHeap& heap);
	void appendRootValues(NativeResults& out) const;
	const std::string& cartDataNamespace() const { return m_cartDataNamespace; }
	const std::vector<double>& persistentData() const { return m_persistentData; }
	void restorePersistentData(const std::string& ns, const std::vector<double>& values);

	int display_width() const;
	int display_height() const;
	Value get_player_input(std::optional<int> playerIndex);
	bool mousebtn(int button) const;
	bool mousebtnp(int button) const;
	bool mousebtnr(int button) const;
	std::string get_lua_entry_path() const;
	std::string get_lua_resource_source(const std::string& path) const;
	double get_cpu_freq_hz() const;
	void set_cpu_freq_hz(double cpuHz);
	double stat(int index) const;
	Color palette_color(int index) const;

	BFont* resolveFontId(uint32_t id) const;
	BFont* resolveFontHandle(const Value& value);
	uint32_t getFontId(BFont* font) const;
	void put_mesh(const MeshRenderSubmission& submission);
	void put_particle(const ParticleRenderSubmission& submission);

	void cartdata(const std::string& ns);
	void dset(int index, double value);
	double dget(int index) const;

	void sfx(const std::string& id);
	void stop_sfx();
	void music(const std::string& id);
	void stop_music(std::optional<i32> fadeMs = std::nullopt);
	void set_master_volume(double volume);
	void set_sprite_parallax_rig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window);
	void pause_audio();
	void resume_audio();
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
	std::array<f32, 16> read_matrix(const Value& value);

	std::array<Value, PLAYERS_MAX> m_playerInputHandles = {
		valueNil(),
		valueNil(),
		valueNil(),
		valueNil(),
	};
};

} // namespace bmsx
