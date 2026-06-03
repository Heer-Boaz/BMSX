/*
 * registry.cpp - Global object registry implementation
 */

#include "common/registry.h"

namespace bmsx {

Registry& Registry::instance() {
	static Registry s_instance;
	return s_instance;
}

void Registry::registerObject(Registerable* entity) {
	m_registry[entity->getId()] = entity;
}

bool Registry::deregister(const std::string& id, bool removePersistent) {
	auto it = m_registry.find(id);
	if (it == m_registry.end()) {
		return false;
	}

	// Don't remove persistent objects unless explicitly requested
	if (it->second->isRegistryPersistent() && !removePersistent) {
		return false;
	}

	m_registry.erase(it);
	return true;
}

bool Registry::deregister(Registerable* entity, bool removePersistent) {
	return deregister(entity->getId(), removePersistent);
}

bool Registry::has(const std::string& id) const {
	return m_registry.find(id) != m_registry.end();
}

void Registry::clear() {
	// Remove all non-persistent entries
	for (auto it = m_registry.begin(); it != m_registry.end(); ) {
		if (!it->second->isRegistryPersistent()) {
			it = m_registry.erase(it);
		} else {
			++it;
		}
	}
}

std::vector<Registerable*> Registry::getAll() const {
	std::vector<Registerable*> result;
	result.reserve(m_registry.size());
	for (const auto& [id, entity] : m_registry) {
		result.push_back(entity);
	}
	return result;
}

std::vector<std::string> Registry::getAllIds() const {
	std::vector<std::string> result;
	result.reserve(m_registry.size());
	for (const auto& [id, entity] : m_registry) {
		result.push_back(id);
	}
	return result;
}

std::vector<Registerable*> Registry::getPersistentEntities() const {
	std::vector<Registerable*> result;
	for (const auto& [id, entity] : m_registry) {
		if (entity->isRegistryPersistent()) {
			result.push_back(entity);
		}
	}
	return result;
}

} // namespace bmsx
