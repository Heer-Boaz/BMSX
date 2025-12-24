/*
 * component.cpp - Component base class implementation
 */

#include "component.h"
#include "../core/world.h"

namespace bmsx {

/* ============================================================================
 * Component static members
 * ============================================================================ */

std::unordered_set<ComponentTag> Component::s_tagsPre;
std::unordered_set<ComponentTag> Component::s_tagsPost;

/* ============================================================================
 * Component implementation
 * ============================================================================ */

Component::Component(const ComponentAttachOptions& opts)
	: m_parent(opts.parent)
	, m_enabled(true)
	, id_local(opts.id_local)
{
	// Determine the type name from the actual class
	type = typeName();
	
	// Build component id
	if (m_parent) {
		const std::string& parentId = m_parent->id;
		id = parentId + "_" + type;
		if (!id_local.empty()) {
			id += "_" + id_local;
		}
	}
}

const std::unordered_set<ComponentTag>& Component::tagsPre() const {
	return s_tagsPre;
}

const std::unordered_set<ComponentTag>& Component::tagsPost() const {
	return s_tagsPost;
}

bool Component::hasPreprocessingTag(ComponentTag tag) const {
	return s_tagsPre.find(tag) != s_tagsPre.end();
}

bool Component::hasPostprocessingTag(ComponentTag tag) const {
	return s_tagsPost.find(tag) != s_tagsPost.end();
}

void Component::attach(WorldObject* newParent) {
	if (newParent) {
		if (isAttached()) {
			detach();
		}
		m_parent = newParent;
	}

	if (!m_parent) {
		throw std::runtime_error("[Component] Cannot attach without a parent.");
	}

	// Note: The parent should add this component via addComponentExternal()
	// This method just sets up the parent relationship
	bind();
	onAttach();
}

void Component::detach() {
	if (m_parent) {
		m_parent->removeComponent(this);
		m_parent = nullptr;
	}
}

void Component::dispose() {
	if (isAttached()) {
		detach();
	}
	setEnabled(false);
	unbind();
}

void Component::bind() {
	// Register the component with the global registry
	// Derived classes can override to add event subscriptions
}

void Component::unbind() {
	// Remove event subscriptions
	// Derived classes can override to clean up
}

/* ============================================================================
 * ComponentRegistry implementation
 * ============================================================================ */

ComponentRegistry& ComponentRegistry::instance() {
	static ComponentRegistry s_instance;
	return s_instance;
}

void ComponentRegistry::registerType(const std::string& typeName, ComponentFactory factory) {
	m_factories[typeName] = std::move(factory);
}

std::unique_ptr<Component> ComponentRegistry::create(const std::string& typeName, const ComponentAttachOptions& opts) {
	auto it = m_factories.find(typeName);
	if (it == m_factories.end()) {
		throw std::runtime_error("[ComponentRegistry] Unknown component type: " + typeName);
	}
	return it->second(opts);
}

bool ComponentRegistry::hasType(const std::string& typeName) const {
	return m_factories.find(typeName) != m_factories.end();
}

/* ============================================================================
 * ComponentContainer implementation
 * ============================================================================ */

Component* ComponentContainer::getComponentById(const ComponentId& id) {
	for (auto& [key, components] : componentMap) {
		for (Component* c : components) {
			if (c->id == id) return c;
		}
	}
	return nullptr;
}

void ComponentContainer::addComponent(Component* component) {
	const std::string& key = component->type;
	componentMap[key].push_back(component);
	updateComponentId(component);
}

void ComponentContainer::removeComponent(Component* component) {
	const std::string& key = component->type;
	auto it = componentMap.find(key);
	if (it != componentMap.end()) {
		auto& vec = it->second;
		vec.erase(std::remove(vec.begin(), vec.end(), component), vec.end());
		if (vec.empty()) {
			componentMap.erase(it);
		}
	}
}

void ComponentContainer::removeComponentsWithTag(ComponentTag tag) {
	std::vector<Component*> toRemove;
	for (auto& [key, components] : componentMap) {
		for (Component* c : components) {
			if (c->hasPreprocessingTag(tag) || c->hasPostprocessingTag(tag)) {
				toRemove.push_back(c);
			}
		}
	}
	for (Component* c : toRemove) {
		c->dispose();
		removeComponent(c);
	}
}

void ComponentContainer::removeAllComponents() {
	for (auto& [key, components] : componentMap) {
		for (Component* c : components) {
			c->dispose();
		}
	}
	componentMap.clear();
}

void ComponentContainer::updateComponentId(Component* component) {
	// Ensure unique id by appending index if needed
	const std::string baseId = component->id;
	const std::string& key = component->type;
	auto& vec = componentMap[key];
	
	// Check for duplicates
	size_t count = 0;
	for (Component* c : vec) {
		if (c != component && c->id.find(baseId) == 0) {
			count++;
		}
	}
	
	if (count > 0) {
		component->id = baseId + "_" + std::to_string(count);
	}
}

} // namespace bmsx
