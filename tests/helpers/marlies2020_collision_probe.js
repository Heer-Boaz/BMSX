module.exports.schedule = async function schedule({ logger }) {
  logger('collision probe init');
  setTimeout(() => {
    const game = globalThis.$;
    if (!game) {
      console.log('[COLLISION_TEST] missing game instance');
      return;
    }
    const world = game.world;
    const objects = Array.from(world.objects({ scope: 'all' }));
    const player = objects.find(o => o.__lua_definition_id === 'marlies2020.player');
    if (!player) {
      console.log('[COLLISION_TEST] player not found');
      return;
    }
    const ingredient = objects.find(o => o.__lua_definition_id === 'marlies2020.ingredient');
    if (!ingredient) {
      console.log('[COLLISION_TEST] ingredient missing');
      return;
    }
    const playerCollider = typeof player.getComponentById === 'function'
      ? player.getComponentById('player_collider')
      : null;
    const ingredientCollider = typeof ingredient.getComponentById === 'function'
      ? ingredient.getComponentById('ingredient_collider')
      : null;
    if (playerCollider && ingredientCollider) {
      const playerWidth = playerCollider.worldArea.end.x - playerCollider.worldArea.start.x;
      const playerHeight = playerCollider.worldArea.end.y - playerCollider.worldArea.start.y;
      const ingredientWidth = ingredientCollider.worldArea.end.x - ingredientCollider.worldArea.start.x;
      const ingredientHeight = ingredientCollider.worldArea.end.y - ingredientCollider.worldArea.start.y;
      const targetX = ingredientCollider.worldArea.start.x + (ingredientWidth - playerWidth) * 0.5;
      const targetY = ingredientCollider.worldArea.start.y + (ingredientHeight - playerHeight) * 0.5;
      player.x = targetX;
      player.y = targetY;
      console.log('[COLLISION_TEST] repositioned player', { x: player.x, y: player.y });
    }
    game.event_emitter.on('overlap.begin', (eventName, emitter, payload) => {
      if (emitter.id === player.id) {
        console.log('[COLLISION_DETECTED]', emitter.id, payload.other_id);
      }
    }, 'collision-probe');
    console.log('[COLLISION_TEST] listener ready', player.id);
  }, 500);
};
