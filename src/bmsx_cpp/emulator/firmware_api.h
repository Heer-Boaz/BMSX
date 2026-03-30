#pragma once

#include "cpu.h"
#include "font.h"
#include "../input/inputtypes.h"
#include "../core/types.h"
#include "../render/shared/render_types.h"
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
	void appendRootValues(std::vector<Value>& out) const;
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

	void cls(int colorIndex = 0);
	void blit_rect(int x0, int y0, int x1, int y1, int z, int colorIndex);
	void fill_rect(int x0, int y0, int x1, int y1, int z, int colorIndex);
	void fill_rect_color(int x0, int y0, int x1, int y1, int z, const Color& color, std::optional<RenderLayer> layer);
	void blit(const ImgRenderSubmission& submission);
	void dma_blit_tiles(const Value& desc);
	void blit_poly(const PolyRenderSubmission& submission);
	void put_mesh(const MeshRenderSubmission& submission);
	void put_particle(const ParticleRenderSubmission& submission);

	void blit_text(const std::string& text, std::optional<int> x, std::optional<int> y,
				std::optional<int> z, std::optional<int> colorIndex, const Value& options);
	void blit_text_color(const std::string& text, std::optional<int> x, std::optional<int> y,
						std::optional<int> z, const Value& colorValue);
	void blit_text_with_font(const std::string& text, std::optional<int> x, std::optional<int> y,
							std::optional<int> z, std::optional<int> colorIndex, BFont* font);
	void blit_text_inline_with_font(const std::string& text, int x, int y, int z, int colorIndex, BFont* font);
	void blit_text_inline_span_with_font(const std::string& text, int start, int end,
										int x, int y, int z, int colorIndex, BFont* font);

	bool action_triggered(const std::string& actionDefinition, std::optional<int> playerIndex) const;
	void consume_action(const std::string& action, std::optional<int> playerIndex);

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
	Runtime& m_runtime;
	std::unique_ptr<Font> m_font;
	std::vector<std::unique_ptr<BFont>> m_runtime_fonts;

	int m_textCursorX = 0;
	int m_textCursorY = 0;
	int m_textCursorHomeX = 0;
	int m_textCursorColorIndex = 0;
	int m_defaultPrintColorIndex = 15;

	std::string m_cartDataNamespace;
	std::vector<double> m_persistentData;

	static constexpr int PERSISTENT_DATA_SIZE = 256;

	std::string expand_tabs(const std::string& text) const;
	void draw_multiline_text(const std::string& text, int x, int y, int z, const Color& color, BFont& font);
	void advance_print_cursor(int lineHeight);
	void reset_print_cursor();
	Value build_font_descriptor(BFont* font);
	Value make_font_handle(BFont* font);
	Value get_player_input_handle(int playerIndex);
	BFont* resolve_font(const Value& value);
	BFont* create_font(const Value& definition);

	std::string pointer_button_code(int button) const;
	void writeIoArg(uint32_t base, int index, double value);
	void writeIoColor(uint32_t base, int offset, const Color& value);
	uint32_t allocIoCommand(int opcode);
	void commitIoCommand();
	uint32_t allocIoPayload(uint32_t words);
	void queueClear(const Color& color);
	void queueFillRect(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color);
	void queueDrawLine(f32 x0, f32 y0, f32 x1, f32 y1, f32 z, Layer2D layer, const Color& color, f32 thickness);
	void queueBlit(u32 handle, f32 x, f32 y, f32 z, Layer2D layer, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const Color& color, f32 parallaxWeight);
	void queueGlyphLine(const std::string& text, f32 x, f32 y, f32 z, BFont* font, const Color& color, const std::optional<Color>& backgroundColor, i32 start, i32 end, Layer2D layer);
	void queueTileRun(const std::vector<u32>& handles, i32 cols, i32 rows, i32 tileW, i32 tileH, i32 originX, i32 originY, i32 scrollX, i32 scrollY, f32 z, Layer2D layer);
	uint32_t fontId(BFont* font) const;
	Color resolve_color(const Value& value);
	RenderLayer resolve_layer(const Value& value);
	std::vector<f32> read_polygon(const Value& value);
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
