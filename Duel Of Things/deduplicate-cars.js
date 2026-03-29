const fs = require('fs-extra');
const path = require('path');

const CARS_DATA_FILE = path.join(__dirname, 'cars-data.js');

async function deduplicateCars() {
  console.log('Loading cars data...');
  
  // Load existing cars
  let cars = [];
  if (await fs.pathExists(CARS_DATA_FILE)) {
    try {
      delete require.cache[require.resolve(CARS_DATA_FILE)];
      cars = require(CARS_DATA_FILE);
      console.log(`Loaded ${cars.length} cars`);
    } catch (error) {
      console.error('Error loading cars data:', error.message);
      return;
    }
  } else {
    console.error(`Cars data file not found: ${CARS_DATA_FILE}`);
    return;
  }

  console.log('\nDeduplicating by make and maxSpeedKmh...');
  
  // Track seen combinations: make -> maxSpeedKmh -> first car
  const seen = new Map();
  const deduplicated = [];
  
  for (const car of cars) {
    const make = car.make || '';
    const maxSpeed = car.maxSpeedKmh || 0;
    
    // Create key for this make
    if (!seen.has(make)) {
      seen.set(make, new Map());
    }
    
    const makeMap = seen.get(make);
    
    // If we haven't seen this (make, maxSpeed) combination, keep it
    if (!makeMap.has(maxSpeed)) {
      makeMap.set(maxSpeed, car);
      deduplicated.push(car);
    }
  }
  
  console.log(`After deduplication: ${deduplicated.length} cars (removed ${cars.length - deduplicated.length} duplicates)`);
  
  // Sort by make, then by maxSpeedKmh (descending - faster first)
  deduplicated.sort((a, b) => {
    // First sort by make
    if (a.make !== b.make) {
      return a.make.localeCompare(b.make);
    }
    // Then by maxSpeedKmh descending (higher speed = better rank)
    return (b.maxSpeedKmh || 0) - (a.maxSpeedKmh || 0);
  });
  
  // Re-assign ranks
  deduplicated.forEach((car, index) => {
    car.rank = index + 1;
  });
  
  // Write back to file
  const jsContent = `module.exports = ${JSON.stringify(deduplicated, null, 2)};`;
  await fs.writeFile(CARS_DATA_FILE, jsContent, 'utf-8');
  
  console.log(`\n✅ Deduplication complete!`);
  console.log(`   Original: ${cars.length} cars`);
  console.log(`   Deduplicated: ${deduplicated.length} cars`);
  console.log(`   Removed: ${cars.length - deduplicated.length} duplicates`);
  console.log(`   Saved to: ${CARS_DATA_FILE}`);
  
  // Show some stats by make
  console.log('\n📊 Cars per make (sample):');
  const makeCounts = new Map();
  deduplicated.forEach(car => {
    const make = car.make || 'Unknown';
    makeCounts.set(make, (makeCounts.get(make) || 0) + 1);
  });
  
  const sortedMakes = Array.from(makeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  sortedMakes.forEach(([make, count]) => {
    console.log(`   ${make}: ${count} unique max speeds`);
  });
}

deduplicateCars().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
