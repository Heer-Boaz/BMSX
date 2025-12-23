/*
 * vm_objects.h - VM-exposed world objects (sprites/text)
 *
 * Provides NativeObject wrappers for Lua access.
 */

#ifndef BMSX_VM_OBJECTS_H
#define BMSX_VM_OBJECTS_H

#include "../core/world.h"
#include "../component/spritecomponent.h"
#include "../core/font.h"
#include "cpu.h"
#include <optional>
#include <unordered_map>

namespace bmsx {

class VMWorldObject : public WorldObject {
public:
	explicit VMWorldObject(const Identifier& id);

	std::shared_ptr<NativeObject> nativeHandle();

	virtual Value getVmProperty(const std::string& key);
	virtual void setVmProperty(const std::string& key, const Value& value);

	void setDynamicProperty(const std::string& key, const Value& value);
	Value getDynamicProperty(const std::string& key) const;

protected:
	std::unordered_map<std::string, Value> m_vmFields;
	mutable std::unordered_map<std::string, std::shared_ptr<NativeFunction>> m_methodCache;
	std::shared_ptr<NativeObject> m_nativeHandle;

	Value getCachedMethod(const std::string& key, NativeFunctionInvoke invoke) const;
};

class VMSpriteObject : public VMWorldObject {
public:
	explicit VMSpriteObject(const Identifier& id);

	Value getVmProperty(const std::string& key) override;
	void setVmProperty(const std::string& key, const Value& value) override;
	void submitForRendering(GameView* view) override;

	SpriteComponent* spriteComponent() const { return m_sprite; }

private:
	void updateSizeFromImg();

	SpriteComponent* m_sprite = nullptr;
};

class VMTextObject : public VMWorldObject {
public:
	VMTextObject(const Identifier& id, BFont* defaultFont);

	Value getVmProperty(const std::string& key) override;
	void setVmProperty(const std::string& key, const Value& value) override;
	void submitForRendering(GameView* view) override;

private:
	void setText(const Value& textOrLines);
	void typeNext();
	void updateDisplayedText();
	void recenterTextBlock();
	std::vector<std::string> toStringLines(const Value& value) const;

	std::vector<std::string> m_text;
	std::vector<std::string> m_fullTextLines;
	std::vector<std::string> m_displayedLines;
	i32 m_currentLineIndex = 0;
	i32 m_currentCharIndex = 0;
	i32 m_maxCharsPerLine = 0;
	std::optional<i32> m_highlightedLine;
	bool m_isTyping = false;
	BFont* m_font = nullptr;
	Color m_highlightColor{0.0f, 0.0f, 0.5f, 1.0f};
	Color m_textColor{1.0f, 1.0f, 1.0f, 1.0f};
	RectBounds m_dimensions;
	f32 m_centeredBlockX = 0.0f;
};

std::shared_ptr<NativeObject> createComponentNative(Component* component);

} // namespace bmsx

#endif // BMSX_VM_OBJECTS_H
