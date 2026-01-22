#pragma once

#include "cpu.h"
#include "font.h"
#include "../core/types.h"
#include "../render/shared/render_types.h"
#include <array>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

class VMRuntime;

class VMApi {
public:
	explicit VMApi(VMRuntime& runtime);
	~VMApi();

	void registerAllFunctions();

	int display_width() const;
	int display_height() const;
	double stat(int index) const;

	void cls(int colorIndex = 0);
	void put_rect(int x0, int y0, int x1, int y1, int z, int colorIndex);
	void put_rectfill(int x0, int y0, int x1, int y1, int z, int colorIndex);
	void put_rectfillcolor(int x0, int y0, int x1, int y1, int z, const Color& color, std::optional<RenderLayer> layer);
	void put_sprite(const ImgRenderSubmission& submission);
	void put_poly(const PolyRenderSubmission& submission);
	void put_mesh(const MeshRenderSubmission& submission);
	void put_particle(const ParticleRenderSubmission& submission);

	void write(const std::string& text, std::optional<int> x, std::optional<int> y,
				std::optional<int> z, std::optional<int> colorIndex, const Value& options);
	void write_color(const std::string& text, std::optional<int> x, std::optional<int> y,
						std::optional<int> z, const Value& colorValue);
	void write_with_font(const std::string& text, std::optional<int> x, std::optional<int> y,
							std::optional<int> z, std::optional<int> colorIndex, VMFont* font);
	void write_inline_with_font(const std::string& text, int x, int y, int z, int colorIndex, VMFont* font);
	void write_inline_span_with_font(const std::string& text, int start, int end,
										int x, int y, int z, int colorIndex, VMFont* font);

	bool action_triggered(const std::string& actionDefinition, std::optional<int> playerIndex) const;

	void cartdata(const std::string& ns);
	void dset(int index, double value);
	double dget(int index) const;

	void sfx(const std::string& id);
	void stop_sfx();
	void music(const std::string& id);
	void stop_music();
	void set_master_volume(double volume);
	void set_sprite_parallax_rig(f32 vy, f32 scale, f32 impact, f32 impact_t,
									f32 bias_px, f32 parallax_strength,
									f32 scale_strength, f32 flip_strength,
									f32 flip_window);
	void pause_audio();
	void resume_audio();
	void reboot();

private:
	VMRuntime& m_runtime;
	std::unique_ptr<VMFont> m_font;

	int m_textCursorX = 0;
	int m_textCursorY = 0;
	int m_textCursorHomeX = 0;
	int m_textCursorColorIndex = 0;
	int m_defaultPrintColorIndex = 15;

	std::string m_cartDataNamespace;
	std::vector<double> m_persistentData;

	static constexpr int PERSISTENT_DATA_SIZE = 256;

	std::string expand_tabs(const std::string& text) const;
	void draw_multiline_text(const std::string& text, int x, int y, int z, const Color& color, VMFont& font);
	void advance_print_cursor(int lineHeight);
	void reset_print_cursor();

	Color palette_color(int index) const;
	Color resolve_color(const Value& value);
	RenderLayer resolve_layer(const Value& value);
	std::vector<f32> read_polygon(const Value& value);
	Vec3 read_vec3(const Value& value);
	std::array<f32, 16> read_matrix(const Value& value);
};

} // namespace bmsx
