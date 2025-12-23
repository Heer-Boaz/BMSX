/*
 * vm_objects.cpp - VM-exposed world object implementations
 */

#include "vm_objects.h"
#include "../core/engine.h"
#include "../render/gameview.h"
#include "../render/glyphs.h"
#include <sstream>

namespace bmsx {
namespace {

std::shared_ptr<Table> makeVec2Table(const Vec2& v) {
	auto tbl = std::make_shared<Table>();
	tbl->set(std::string("x"), static_cast<double>(v.x));
	tbl->set(std::string("y"), static_cast<double>(v.y));
	return tbl;
}

std::shared_ptr<Table> makeVec3Table(const Vec3& v) {
	auto tbl = std::make_shared<Table>();
	tbl->set(std::string("x"), static_cast<double>(v.x));
	tbl->set(std::string("y"), static_cast<double>(v.y));
	tbl->set(std::string("z"), static_cast<double>(v.z));
	return tbl;
}

Vec2 readVec2(const Value& value) {
	auto tbl = std::get<std::shared_ptr<Table>>(value);
	Vec2 out;
	out.x = static_cast<f32>(asNumber(tbl->get(std::string("x"))));
	out.y = static_cast<f32>(asNumber(tbl->get(std::string("y"))));
	return out;
}

Vec3 readVec3(const Value& value) {
	auto tbl = std::get<std::shared_ptr<Table>>(value);
	Vec3 out;
	out.x = static_cast<f32>(asNumber(tbl->get(std::string("x"))));
	out.y = static_cast<f32>(asNumber(tbl->get(std::string("y"))));
	out.z = static_cast<f32>(asNumber(tbl->get(std::string("z"))));
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

std::shared_ptr<Table> toTable(const std::vector<std::string>& lines) {
	auto tbl = std::make_shared<Table>();
	for (size_t i = 0; i < lines.size(); ++i) {
		tbl->set(static_cast<double>(i + 1), lines[i]);
	}
	return tbl;
}

std::string joinLines(const std::vector<std::string>& lines) {
	if (lines.empty()) {
		return std::string();
	}
	std::ostringstream oss;
	for (size_t i = 0; i < lines.size(); ++i) {
		if (i > 0) {
			oss << "\n";
		}
		oss << lines[i];
	}
	return oss.str();
}

} // namespace

VMWorldObject::VMWorldObject(const Identifier& id)
	: WorldObject(id)
{
}

std::shared_ptr<NativeObject> VMWorldObject::nativeHandle() {
	if (!m_nativeHandle) {
		m_nativeHandle = createNativeObject(
			this,
			[this](const Value& key) -> Value {
				const std::string& keyName = asString(key);
				return getVmProperty(keyName);
			},
			[this](const Value& key, const Value& value) {
				const std::string& keyName = asString(key);
				setVmProperty(keyName, value);
			}
		);
	}
	return m_nativeHandle;
}

Value VMWorldObject::getVmProperty(const std::string& key) {
	if (key == "id") return id;
	if (key == "x") return static_cast<double>(x());
	if (key == "y") return static_cast<double>(y());
	if (key == "z") return static_cast<double>(z());
	if (key == "sx") return static_cast<double>(sx());
	if (key == "sy") return static_cast<double>(sy());
	if (key == "sz") return static_cast<double>(sz());
	if (key == "pos") return makeVec3Table(pos());
	if (key == "visible") return visible;
	if (key == "get_component_by_id") {
		return getCachedMethod(key, [this](const std::vector<Value>& args) -> std::vector<Value> {
			const std::string& targetId = asString(args.at(0));
			Component* component = getComponentById(targetId);
			if (!component) {
				return {std::monostate{}};
			}
			return {createComponentNative(component)};
		});
	}

	auto it = m_vmFields.find(key);
	if (it != m_vmFields.end()) {
		return it->second;
	}
	return std::monostate{};
}

void VMWorldObject::setVmProperty(const std::string& key, const Value& value) {
	if (key == "pos") {
		setPos(readVec3(value));
		return;
	}
	if (key == "x") {
		setX(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "y") {
		setY(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "z") {
		setZ(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "sx") {
		setSx(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "sy") {
		setSy(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "sz") {
		setSz(static_cast<f32>(asNumber(value)));
		return;
	}
	if (key == "visible") {
		visible = isTruthy(value);
		return;
	}
	m_vmFields[key] = value;
}

void VMWorldObject::setDynamicProperty(const std::string& key, const Value& value) {
	setVmProperty(key, value);
}

Value VMWorldObject::getDynamicProperty(const std::string& key) const {
	auto it = m_vmFields.find(key);
	if (it == m_vmFields.end()) {
		return std::monostate{};
	}
	return it->second;
}

Value VMWorldObject::getCachedMethod(const std::string& key, NativeFunctionInvoke invoke) const {
	auto it = m_methodCache.find(key);
	if (it != m_methodCache.end()) {
		return it->second;
	}
	auto fn = createNativeFunction(key, std::move(invoke));
	m_methodCache[key] = fn;
	return fn;
}

VMSpriteObject::VMSpriteObject(const Identifier& id)
	: VMWorldObject(id)
{
	SpriteComponentOptions opts;
	opts.parent = this;
	opts.idLocal = "base_sprite";
	m_sprite = addComponent<SpriteComponent>(opts);
}

Value VMSpriteObject::getVmProperty(const std::string& key) {
	if (key == "imgid") return m_sprite->imgid;
	if (key == "colorize") return makeColorTable(m_sprite->colorize);
	if (key == "flip_h") return m_sprite->flip.flip_h;
	if (key == "flip_v") return m_sprite->flip.flip_v;
	return VMWorldObject::getVmProperty(key);
}

void VMSpriteObject::setVmProperty(const std::string& key, const Value& value) {
	if (key == "imgid") {
		m_sprite->imgid = asString(value);
		updateSizeFromImg();
		return;
	}
	if (key == "colorize") {
		m_sprite->colorize = readColor(value);
		return;
	}
	if (key == "flip_h") {
		m_sprite->flip.flip_h = isTruthy(value);
		return;
	}
	if (key == "flip_v") {
		m_sprite->flip.flip_v = isTruthy(value);
		return;
	}
	VMWorldObject::setVmProperty(key, value);
}

void VMSpriteObject::submitForRendering(GameView* view) {
	ImgRenderSubmission submission;
	submission.imgid = m_sprite->imgid;
	submission.pos = pos();
	submission.scale = m_sprite->scale;
	submission.flip = m_sprite->flip;
	submission.colorize = m_sprite->colorize;
	view->renderer.submit.sprite(submission);
}

void VMSpriteObject::updateSizeFromImg() {
	if (m_sprite->imgid == "none") {
		return;
	}
	auto* imgAsset = EngineCore::instance().assets().getImg(m_sprite->imgid);
	if (!imgAsset) {
		throw std::runtime_error("[VMSpriteObject] Missing sprite asset '" + m_sprite->imgid + "'.");
	}
	setSx(static_cast<f32>(imgAsset->meta.width));
	setSy(static_cast<f32>(imgAsset->meta.height));
}

VMTextObject::VMTextObject(const Identifier& id, BFont* defaultFont)
	: VMWorldObject(id)
	, m_font(defaultFont)
{
	auto* view = EngineCore::instance().view();
	m_dimensions.left = 0.0f;
	m_dimensions.top = 0.0f;
	m_dimensions.right = view ? view->viewportSize.x : 0.0f;
	m_dimensions.bottom = view ? view->viewportSize.y : 0.0f;
	m_maxCharsPerLine = static_cast<i32>((m_dimensions.right - m_dimensions.left) / m_font->char_width(' '));
	m_fullTextLines = {""};
	m_displayedLines = {""};
	m_text = m_displayedLines;
	recenterTextBlock();
}

Value VMTextObject::getVmProperty(const std::string& key) {
	if (key == "text") return toTable(m_text);
	if (key == "full_text_lines") return toTable(m_fullTextLines);
	if (key == "displayed_lines") return toTable(m_displayedLines);
	if (key == "current_line_index") return static_cast<double>(m_currentLineIndex);
	if (key == "current_char_index") return static_cast<double>(m_currentCharIndex);
	if (key == "maximum_characters_per_line") return static_cast<double>(m_maxCharsPerLine);
	if (key == "highlighted_line_index") {
		return m_highlightedLine.has_value() ? Value{static_cast<double>(*m_highlightedLine)} : Value{std::monostate{}};
	}
	if (key == "is_typing") return m_isTyping;
	if (key == "text_color") return makeColorTable(m_textColor);
	if (key == "highlight_color") return makeColorTable(m_highlightColor);
	if (key == "dimensions") return makeRectBoundsTable(m_dimensions);
	if (key == "centered_block_x") return static_cast<double>(m_centeredBlockX);
	if (key == "set_text") {
		return getCachedMethod(key, [this](const std::vector<Value>& args) -> std::vector<Value> {
			setText(args.at(0));
			return {};
		});
	}
	if (key == "type_next") {
		return getCachedMethod(key, [this](const std::vector<Value>&) -> std::vector<Value> {
			typeNext();
			return {};
		});
	}
	return VMWorldObject::getVmProperty(key);
}

void VMTextObject::setVmProperty(const std::string& key, const Value& value) {
	if (key == "text") {
		m_text = toStringLines(value);
		m_displayedLines = m_text;
		return;
	}
	if (key == "full_text_lines") {
		m_fullTextLines = toStringLines(value);
		recenterTextBlock();
		return;
	}
	if (key == "displayed_lines") {
		m_displayedLines = toStringLines(value);
		updateDisplayedText();
		return;
	}
	if (key == "current_line_index") {
		m_currentLineIndex = static_cast<i32>(asNumber(value));
		return;
	}
	if (key == "current_char_index") {
		m_currentCharIndex = static_cast<i32>(asNumber(value));
		return;
	}
	if (key == "maximum_characters_per_line") {
		m_maxCharsPerLine = static_cast<i32>(asNumber(value));
		return;
	}
	if (key == "highlighted_line_index") {
		if (isNil(value)) {
			m_highlightedLine.reset();
		} else {
			m_highlightedLine = static_cast<i32>(asNumber(value));
		}
		return;
	}
	if (key == "is_typing") {
		m_isTyping = isTruthy(value);
		return;
	}
	if (key == "text_color") {
		m_textColor = readColor(value);
		return;
	}
	if (key == "highlight_color") {
		m_highlightColor = readColor(value);
		return;
	}
	if (key == "dimensions") {
		m_dimensions = readRectBounds(value);
		m_maxCharsPerLine = static_cast<i32>((m_dimensions.right - m_dimensions.left) / m_font->char_width(' '));
		recenterTextBlock();
		return;
	}
	if (key == "centered_block_x") {
		m_centeredBlockX = static_cast<f32>(asNumber(value));
		return;
	}
	VMWorldObject::setVmProperty(key, value);
}

void VMTextObject::submitForRendering(GameView* view) {
	if (m_text.empty()) return;

	const f32 lineHeight = static_cast<f32>(m_font->char_height(' ')) * 2.0f;
	const f32 margin = static_cast<f32>(m_font->char_width(' ')) / 2.0f;

	Color normalBg{0.0f, 0.0f, 0.0f, m_textColor.a};
	Color highlightBg{
		m_highlightColor.r,
		m_highlightColor.g,
		m_highlightColor.b,
		m_highlightColor.a * m_textColor.a
	};

	for (size_t i = 0; i < m_text.size(); ++i) {
		f32 lineY = m_dimensions.top + lineHeight * static_cast<f32>(i);
		bool highlighted = m_highlightedLine.has_value() && static_cast<size_t>(*m_highlightedLine) == i;

		if (highlighted) {
			RectRenderSubmission rect;
			rect.kind = RectRenderSubmission::Kind::Fill;
			rect.color = highlightBg;
			rect.area.left = m_dimensions.left - margin;
			rect.area.right = m_dimensions.right + margin;
			rect.area.top = lineY - margin;
			rect.area.bottom = m_dimensions.top + lineHeight * (static_cast<f32>(i) + 0.5f) + margin;
			view->renderer.submit.rect(rect);
		}

		GlyphRenderSubmission glyphs;
		glyphs.text = m_text[i];
		glyphs.x = m_centeredBlockX;
		glyphs.y = lineY;
		glyphs.z = z();
		glyphs.font = m_font;
		glyphs.color = m_textColor;
		glyphs.background_color = highlighted ? highlightBg : normalBg;
		view->renderer.submit.glyphs(glyphs);
	}
}

void VMTextObject::setText(const Value& textOrLines) {
	std::string joined = joinLines(toStringLines(textOrLines));
	if (m_maxCharsPerLine > 0) {
		m_fullTextLines = wrapGlyphs(joined, m_maxCharsPerLine);
	} else {
		m_fullTextLines = {joined};
	}

	m_displayedLines.clear();
	m_displayedLines.resize(m_fullTextLines.size());
	m_currentLineIndex = 0;
	m_currentCharIndex = 0;
	m_isTyping = true;
	recenterTextBlock();
	updateDisplayedText();
}

void VMTextObject::typeNext() {
	if (!m_isTyping) {
		return;
	}

	if (m_currentLineIndex >= static_cast<i32>(m_fullTextLines.size())) {
		m_isTyping = false;
		return;
	}

	const std::string& line = m_fullTextLines[static_cast<size_t>(m_currentLineIndex)];
	if (m_currentCharIndex < static_cast<i32>(line.size())) {
		m_displayedLines[static_cast<size_t>(m_currentLineIndex)].push_back(line[static_cast<size_t>(m_currentCharIndex)]);
		++m_currentCharIndex;
		updateDisplayedText();
		return;
	}

	++m_currentLineIndex;
	m_currentCharIndex = 0;
	if (m_currentLineIndex >= static_cast<i32>(m_fullTextLines.size())) {
		m_isTyping = false;
	}
	updateDisplayedText();
}

void VMTextObject::updateDisplayedText() {
	m_text = m_displayedLines;
}

void VMTextObject::recenterTextBlock() {
	f32 longestWidth = 0.0f;
	for (const auto& line : m_fullTextLines) {
		f32 width = static_cast<f32>(m_font->measure(line));
		if (width > longestWidth) {
			longestWidth = width;
		}
	}
	m_centeredBlockX = ((m_dimensions.right - m_dimensions.left) - longestWidth) / 2.0f + m_dimensions.left;
}

std::vector<std::string> VMTextObject::toStringLines(const Value& value) const {
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
		if (!std::holds_alternative<double>(key)) {
			continue;
		}
		lines.push_back(valueToString(val));
	}
	return lines;
}

std::shared_ptr<NativeObject> createComponentNative(Component* component) {
	if (auto* sprite = dynamic_cast<SpriteComponent*>(component)) {
		return createNativeObject(
			sprite,
			[sprite](const Value& key) -> Value {
				const std::string& keyName = asString(key);
				if (keyName == "scale") {
					return makeVec2Table(sprite->scale);
				}
				if (keyName == "imgid") {
					return sprite->imgid;
				}
				if (keyName == "colorize") {
					return makeColorTable(sprite->colorize);
				}
				return std::monostate{};
			},
			[sprite](const Value& key, const Value& value) {
				const std::string& keyName = asString(key);
				if (keyName == "scale") {
					sprite->scale = readVec2(value);
					return;
				}
				if (keyName == "imgid") {
					sprite->imgid = asString(value);
					return;
				}
				if (keyName == "colorize") {
					sprite->colorize = readColor(value);
				}
			}
		);
	}

	return createNativeObject(
		component,
		[](const Value&) -> Value {
			return std::monostate{};
		},
		[](const Value&, const Value&) {}
	);
}

} // namespace bmsx
