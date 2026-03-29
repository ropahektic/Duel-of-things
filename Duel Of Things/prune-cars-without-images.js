const fs = require('fs-extra');
const path = require('path');

const CARS_DATA_FILE = path.join(__dirname, 'cars-data.js');
const CARS_DIR = path.join(__dirname, 'cars');

function normalizeRelative(p) {
  return String(p || '').replace(/\\/g, '/').trim();
}

async function pruneCarsWithoutImages() {
  console.log('Loading cars data...');

  let cars = [];
  if (await fs.pathExists(CARS_DATA_FILE)) {
    delete require.cache[require.resolve(CARS_DATA_FILE)];
    cars = require(CARS_DATA_FILE);
  } else {
    console.error(`Cars data file not found: ${CARS_DATA_FILE}`);
    process.exit(1);
  }

  console.log(`Loaded ${cars.length} cars`);

  if (!await fs.pathExists(CARS_DIR)) {
    console.error(`Cars images folder not found: ${CARS_DIR}`);
    process.exit(1);
  }

  let removedNoPath = 0;
  let removedMissingFile = 0;
  let kept = 0;

  const filtered = [];

  for (const car of cars) {
    // Prefer explicit imagePath; otherwise assume standard naming: cars/<id>.jpg
    const relImagePath = normalizeRelative(car.imagePath || `cars/${car.id}.jpg`);
    const absImagePath = path.join(__dirname, relImagePath);

    if (!relImagePath) {
      removedNoPath++;
      continue;
    }

    const exists = await fs.pathExists(absImagePath);
    if (!exists) {
      removedMissingFile++;
      continue;
    }

    car.imagePath = relImagePath; // normalize + ensure present
    filtered.push(car);
    kept++;
  }

  // Keep existing ordering (already grouped by make in your file), just re-rank
  filtered.forEach((car, idx) => {
    car.rank = idx + 1;
  });

  await fs.writeFile(
    CARS_DATA_FILE,
    `module.exports = ${JSON.stringify(filtered, null, 2)};\n`,
    'utf-8'
  );

  console.log('\n✅ Prune complete!');
  console.log(`   Original: ${cars.length}`);
  console.log(`   Kept: ${kept}`);
  console.log(`   Removed (no imagePath): ${removedNoPath}`);
  console.log(`   Removed (missing image file): ${removedMissingFile}`);
  console.log(`   Saved: ${CARS_DATA_FILE}`);
}

pruneCarsWithoutImages().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

