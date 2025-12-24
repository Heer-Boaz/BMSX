#pragma once

#include "cpu.h"
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace bmsx {

// Forward declarations
class VMRuntime;
class WorldObject;

/**
 * Pointer button indices for mouse/touch input.
 */
enum class VMPointerButton : int {
	Primary = 0,
	Secondary = 1,
	Aux = 2,
	Back = 3,
	Forward = 4
};

/**
 * Pointer position in viewport coordinates.
 */
struct VMPointerViewport {
	int x = 0;
	int y = 0;
};

/**
 * Pointer position as floating point.
 */
struct VMPointerVector {
	float x = 0.0f;
	float y = 0.0f;
};

/**
 * Mouse wheel delta.
 */
struct VMPointerWheel {
	float x = 0.0f;
	float y = 0.0f;
};

/**
 * VMApi - the API exposed to Lua scripts.
 *
 * Provides functions for:
 * - Display (display_width, display_height, cls, rect, etc.)
 * - Input (mousebtn, mousepos, action_triggered, etc.)
 * - Audio (sfx, music, etc.)
 * - World/objects (spawn_object, world_object, etc.)
 */
class VMApi {
public:
	explicit VMApi(VMRuntime& runtime);
	~VMApi();

	// Non-copyable
	VMApi(const VMApi&) = delete;
	VMApi& operator=(const VMApi&) = delete;

	/**
	 * Register all API functions as globals in the VM.
	 */
	void registerAllFunctions();

	// ==========================================================================
	// Display functions
	// ==========================================================================

	/**
	 * Get display width in pixels.
	 */
	int display_width() const;

	/**
	 * Get display height in pixels.
	 */
	int display_height() const;

	/**
	 * Clear the screen with a palette color.
	 */
	void cls(int colorIndex = 0);

	/**
	 * Draw a rectangle outline.
	 */
	void rect(int x0, int y0, int x1, int y1, int z, int colorIndex);

	/**
	 * Draw a filled rectangle.
	 */
	void rectfill(int x0, int y0, int x1, int y1, int z, int colorIndex);

	/**
	 * Draw text at position.
	 */
	void write(const std::string& text, int x, int y, int z, int colorIndex);

	// ==========================================================================
	// Input functions
	// ==========================================================================

	/**
	 * Check if mouse button is pressed.
	 */
	bool mousebtn(VMPointerButton button) const;

	/**
	 * Check if mouse button was just pressed this frame.
	 */
	bool mousebtnp(VMPointerButton button) const;

	/**
	 * Check if mouse button was just released this frame.
	 */
	bool mousebtnr(VMPointerButton button) const;

	/**
	 * Get mouse position in viewport coordinates.
	 */
	VMPointerViewport mousepos() const;

	/**
	 * Get mouse position in screen coordinates.
	 */
	VMPointerVector pointer_screen_position() const;

	/**
	 * Get mouse movement delta.
	 */
	VMPointerVector pointer_delta() const;

	/**
	 * Get mouse wheel delta.
	 */
	VMPointerWheel mousewheel() const;

	/**
	 * Check if an action was triggered this frame.
	 */
	bool action_triggered(const std::string& actionDefinition, int playerIndex = 1) const;

	// ==========================================================================
	// Audio functions
	// ==========================================================================

	/**
	 * Play a sound effect.
	 */
	void sfx(const std::string& id);

	/**
	 * Stop sound effects.
	 */
	void stop_sfx();

	/**
	 * Play music.
	 */
	void music(const std::string& id);

	/**
	 * Stop music.
	 */
	void stop_music();

	// ==========================================================================
	// Storage functions
	// ==========================================================================

	/**
	 * Initialize cart data namespace.
	 */
	void cartdata(const std::string& ns);

	/**
	 * Set persistent data value.
	 */
	void dset(int index, double value);

	/**
	 * Get persistent data value.
	 */
	double dget(int index) const;

	// ==========================================================================
	// System functions
	// ==========================================================================

	/**
	 * Get system stat.
	 */
	double stat(int index) const;

	/**
	 * Reboot the VM.
	 */
	void reboot();

private:
	VMRuntime& m_runtime;

	// Text cursor state
	int m_textCursorX = 0;
	int m_textCursorY = 0;
	int m_textCursorHomeX = 0;
	int m_textCursorColorIndex = 15;

	// Persistent storage
	std::string m_cartDataNamespace;
	std::vector<double> m_persistentData;
	static constexpr int PERSISTENT_DATA_SIZE = 256;

	void reset_print_cursor();
	std::string pointer_action(VMPointerButton button) const;

	struct VmWorldObjectDefinition {
		std::string defId;
		std::shared_ptr<Table> classTable;
		std::shared_ptr<Table> defaults;
		std::vector<std::string> fsms;
	};

	std::vector<std::unique_ptr<WorldObject>> m_spawnedObjects;
	std::unordered_map<std::string, VmWorldObjectDefinition> m_worldObjectDefs;

	std::unordered_map<const WorldObject*, std::unordered_map<std::string, std::shared_ptr<NativeFunction>>> m_methodCache;
	std::unordered_map<const WorldObject*, std::shared_ptr<NativeObject>> m_nativeHandles;

	std::shared_ptr<NativeObject> getNativeHandle(WorldObject* obj);
	Value getObjectProperty(WorldObject* obj, const std::string& key);
	Value getNativeProperty(WorldObject* obj, const std::string& key);
	void setObjectProperty(WorldObject* obj, const std::string& key, const Value& value);
	bool setNativeProperty(WorldObject* obj, const std::string& key, const Value& value);
	bool isNativeProperty(WorldObject* obj, const std::string& key) const;
	Value getCachedMethod(WorldObject* obj, const std::string& key, NativeFunctionInvoke invoke);

	void applyTableToObject(WorldObject* obj, const std::shared_ptr<Table>& table,
	                        const std::unordered_set<std::string>* exclusions = nullptr);
	void applyClassAddons(WorldObject* obj, const std::shared_ptr<Table>& table,
	                      const std::unordered_set<std::string>* exclusions = nullptr);
	void callObjectHook(WorldObject* obj, const std::string& hook, const std::vector<Value>& args);
};

} // namespace bmsx
