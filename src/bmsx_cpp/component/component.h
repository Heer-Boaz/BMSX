/*
 * component.h - Base component types for BMSX ECS
 *
 * Mirrors TypeScript component/basecomponent.ts
 * Provides the Component base class and ComponentContainer interface.
 */

#ifndef BMSX_COMPONENT_H
#define BMSX_COMPONENT_H

#include "../core/types.h"
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <memory>
#include <functional>
#include <typeinfo>
#include <typeindex>
#include <any>

namespace bmsx {

// Forward declarations
class WorldObject;
class Component;

/* ============================================================================
 * Component type aliases
 * ============================================================================ */

using ComponentId = std::string;  // Format: ${parentid}_${typename} or ${parentid}_${typename}_${localid}
using ComponentTag = std::string;
using KeyToComponentMap = std::unordered_map<std::string, std::vector<Component*>>;

/* ============================================================================
 * Component attach options
 * ============================================================================ */

struct ComponentAttachOptions {
	WorldObject* parent = nullptr;
	std::string parentId;  // Alternative: parent id for deferred resolution
	std::string idLocal;   // Human-friendly, per-owner suffix (e.g., 'left', 'primary')
};

/* ============================================================================
 * Component update parameters
 * ============================================================================ */

struct ComponentUpdateParams {
	std::vector<std::any> params;
	std::any returnValue;
};

/* ============================================================================
 * Component base class
 *
 * Abstract base for all components that can be attached to WorldObjects.
 * ============================================================================ */

class Component {
public:
	// Static type information
	static bool unique() { return false; }
	static const char* typeName() { return "Component"; }

	// Instance members
	std::string id;
	std::string idLocal;
	std::string type;
	
protected:
	WorldObject* m_parent = nullptr;
	bool m_enabled = true;

	// Tags for preprocessing/postprocessing
	static std::unordered_set<ComponentTag> s_tagsPre;
	static std::unordered_set<ComponentTag> s_tagsPost;

public:
	Component() = default;
	explicit Component(const ComponentAttachOptions& opts);
	virtual ~Component() = default;

	// Disable copying
	Component(const Component&) = delete;
	Component& operator=(const Component&) = delete;

	// Allow moving
	Component(Component&&) = default;
	Component& operator=(Component&&) = default;

	// Accessors
	WorldObject* parent() const { return m_parent; }
	void setParent(WorldObject* parent) { m_parent = parent; }
	
	bool enabled() const { return m_enabled; }
	void setEnabled(bool value) { m_enabled = value; }
	
	bool isAttached() const { return m_parent != nullptr; }

	virtual const char* name() const { return typeName(); }

	// Tag accessors
	const std::unordered_set<ComponentTag>& tagsPre() const;
	const std::unordered_set<ComponentTag>& tagsPost() const;
	bool hasPreprocessingTag(ComponentTag tag) const;
	bool hasPostprocessingTag(ComponentTag tag) const;

	// Lifecycle
	virtual void attach(WorldObject* newParent = nullptr);
	virtual void detach();
	virtual void dispose();
	virtual void onAttach() {}

	// Event binding
	virtual void bind();
	virtual void unbind();

	// Update hooks (called by ECS systems)
	virtual void preprocessingUpdate() {}
	virtual void postprocessingUpdate(const ComponentUpdateParams& params) {}
};

/* ============================================================================
 * Component registry (static registry for type lookup)
 * ============================================================================ */

class ComponentRegistry {
public:
	using ComponentFactory = std::function<std::unique_ptr<Component>(const ComponentAttachOptions&)>;

	static ComponentRegistry& instance();

	void registerType(const std::string& typeName, ComponentFactory factory);
	std::unique_ptr<Component> create(const std::string& typeName, const ComponentAttachOptions& opts);
	bool hasType(const std::string& typeName) const;

private:
	ComponentRegistry() = default;
	std::unordered_map<std::string, ComponentFactory> m_factories;
};

/* ============================================================================
 * ComponentContainer interface
 *
 * Interface for objects that can hold components.
 * ============================================================================ */

class ComponentContainer {
public:
	virtual ~ComponentContainer() = default;

	// Component storage
	KeyToComponentMap componentMap;

	// Component access
	template<typename T>
	std::vector<T*> getComponents();

	template<typename T>
	T* getComponentAt(size_t index);

	template<typename T>
	T* getUniqueComponent();

	Component* getComponentById(const ComponentId& id);

	// Component manipulation
	void addComponent(Component* component);
	void removeComponent(Component* component);

	template<typename T>
	void removeComponents();

	void removeComponentsWithTag(ComponentTag tag);
	void removeAllComponents();

protected:
	// Internal helpers
	void updateComponentId(Component* component);
};

/* ============================================================================
 * Template implementations
 * ============================================================================ */

template<typename T>
std::vector<T*> ComponentContainer::getComponents() {
	std::vector<T*> result;
	const std::string key = T::typeName();
	auto it = componentMap.find(key);
	if (it != componentMap.end()) {
		for (Component* c : it->second) {
			if (T* typed = dynamic_cast<T*>(c)) {
				result.push_back(typed);
			}
		}
	}
	return result;
}

template<typename T>
T* ComponentContainer::getComponentAt(size_t index) {
	const std::string key = T::typeName();
	auto it = componentMap.find(key);
	if (it != componentMap.end() && index < it->second.size()) {
		return dynamic_cast<T*>(it->second[index]);
	}
	return nullptr;
}

template<typename T>
T* ComponentContainer::getUniqueComponent() {
	auto components = getComponents<T>();
	if (components.empty()) return nullptr;
	if (components.size() > 1) {
		throw std::runtime_error("[ComponentContainer] Multiple instances of unique component.");
	}
	return components[0];
}

template<typename T>
void ComponentContainer::removeComponents() {
	const std::string key = T::typeName();
	auto it = componentMap.find(key);
	if (it != componentMap.end()) {
		for (Component* c : it->second) {
			c->dispose();
		}
		it->second.clear();
		componentMap.erase(it);
	}
}

} // namespace bmsx

#endif // BMSX_COMPONENT_H
