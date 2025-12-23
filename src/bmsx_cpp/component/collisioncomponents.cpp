/*
 * collisioncomponents.cpp - Collision components implementation
 */

#include "collisioncomponents.h"
#include "../core/world.h"
#include "../core/engine.h"

namespace bmsx {

/* ============================================================================
 * Collider2DComponent implementation
 * ============================================================================ */

Collider2DComponent::Collider2DComponent(const Collider2DComponentOptions& opts)
	: Component(opts)
	, hittable(opts.hittable)
	, layer(opts.layer)
	, mask(opts.mask)
	, isTrigger(opts.isTrigger)
	, generateOverlapEvents(opts.generateOverlapEvents)
	, spaceEvents(opts.spaceEvents)
{
	if (idLocal.empty()) {
		idLocal = "collider2d";
	}
}

RectBounds Collider2DComponent::worldArea() const {
	WorldObject* parent = m_parent;
	f32 px = parent->x();
	f32 py = parent->y();
	
	if (!m_localArea.has_value()) {
		// Fall back to object size
		f32 sx = parent->sx();
		f32 sy = parent->sy();
		return RectBounds{px, py, px + sx, py + sy};
	}
	
	const RectBounds& local = m_localArea.value();
	return RectBounds{
		px + local.left,
		py + local.top,
		px + local.right,
		py + local.bottom
	};
}

std::vector<Polygon> Collider2DComponent::worldPolygons() const {
	if (m_localPolys.empty()) return {};
	
	WorldObject* parent = m_parent;
	f32 px = parent->x();
	f32 py = parent->y();
	
	std::vector<Polygon> result;
	result.reserve(m_localPolys.size());
	
	for (const Polygon& poly : m_localPolys) {
		Polygon worldPoly;
		worldPoly.reserve(poly.size());
		for (size_t i = 0; i < poly.size(); i += 2) {
			worldPoly.push_back(poly[i] + px);
			worldPoly.push_back(poly[i + 1] + py);
		}
		result.push_back(std::move(worldPoly));
	}
	
	return result;
}

std::optional<Circle> Collider2DComponent::worldCircle() const {
	if (!m_localCircle.has_value()) return std::nullopt;
	
	WorldObject* parent = m_parent;
	f32 px = parent->x();
	f32 py = parent->y();
	const Circle& local = m_localCircle.value();
	
	return Circle(px + local.x, py + local.y, local.r);
}

/* ============================================================================
 * PositionUpdateAxisComponent implementation
 * ============================================================================ */

PositionUpdateAxisComponent::PositionUpdateAxisComponent(const ComponentAttachOptions& opts)
	: Component(opts)
	, oldPos(0.0f, 0.0f)
{
}

void PositionUpdateAxisComponent::preprocessingUpdate() {
	if (!m_parent) return;
	oldPos = Vec2{m_parent->x(), m_parent->y()};
}

/* ============================================================================
 * ProhibitLeavingScreenComponent implementation
 * ============================================================================ */

ProhibitLeavingScreenComponent::ProhibitLeavingScreenComponent(const ProhibitLeavingScreenOptions& opts)
	: ScreenBoundaryComponent(opts)
	, stickToEdge(opts.stickToEdge)
{
}

void ProhibitLeavingScreenComponent::bind() {
	ScreenBoundaryComponent::bind();
	
	// Register for screen.leaving and screen.leave events
	// Note: Event system integration would go here
	// The actual event subscription depends on the event system implementation
}

void ProhibitLeavingScreenComponent::onLeavingScreen(const std::string& direction, f32 oldXOrY) {
	if (!m_parent) return;
	
	ScreenDirection dir;
	if (direction == "left") dir = ScreenDirection::Left;
	else if (direction == "right") dir = ScreenDirection::Right;
	else if (direction == "up") dir = ScreenDirection::Up;
	else if (direction == "down") dir = ScreenDirection::Down;
	else return;
	
	leavingScreenHandler_prohibit(*m_parent, dir, oldXOrY, stickToEdge);
}

/* ============================================================================
 * Helper function implementation
 * ============================================================================ */

void leavingScreenHandler_prohibit(
	WorldObject& obj,
	ScreenDirection direction,
	f32 oldXOrY,
	bool stickToEdge)
{
	World* worldPtr = EngineCore::instance().world();
	f32 width = static_cast<f32>(worldPtr->gameWidth());
	f32 height = static_cast<f32>(worldPtr->gameHeight());
	
	switch (direction) {
		case ScreenDirection::Left:
			obj.setX(stickToEdge ? 0.0f : oldXOrY);
			break;
		case ScreenDirection::Right:
			obj.setX(stickToEdge ? width - obj.sx() : oldXOrY);
			break;
		case ScreenDirection::Up:
			obj.setY(stickToEdge ? 0.0f : oldXOrY);
			break;
		case ScreenDirection::Down:
			obj.setY(stickToEdge ? height - obj.sy() : oldXOrY);
			break;
	}
}

} // namespace bmsx
