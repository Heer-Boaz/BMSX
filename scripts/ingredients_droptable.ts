interface Ingredient {
  name: string;
  rarity: number;
}

const ingredients: Ingredient[] = [
  { name: 'Herb', rarity: 4 },
  { name: 'Mushroom', rarity: 3 },
  { name: 'Crystal', rarity: 1 },
  { name: 'Scale', rarity: 2 },
];

interface Enemy {
  name: string;
  dropTable: Ingredient[];
}

const enemies: Enemy[] = [
  {
    name: 'Goblin',
    dropTable: [ingredients[0], ingredients[1]],
  },
  {
    name: 'Dragon',
    dropTable: [ingredients[2], ingredients[3]],
  },
];

function dropIngredient(enemy: Enemy): Ingredient | undefined {
  const totalRarity = enemy.dropTable.reduce((acc, curr) => acc + curr.rarity, 0);
  let randomRarity = Math.floor(Math.random() * totalRarity);

  for (const ingredient of enemy.dropTable) {
    if (randomRarity < ingredient.rarity) {
      return ingredient;
    }
    randomRarity -= ingredient.rarity;
  }
  return undefined;
}

const defeatedEnemy = enemies[0];
const droppedIngredient = dropIngredient(defeatedEnemy);

if (droppedIngredient) {
  console.log(`You have obtained ${droppedIngredient.name} from defeating ${defeatedEnemy.name}`);
} else {
  console.log(`You didn't obtain any ingredients from defeating ${defeatedEnemy.name}`);
}
