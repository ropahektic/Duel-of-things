require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

const CITIES_DATA_FILE = path.join(__dirname, 'cities-data.js');
const BACKUP_FILE = path.join(__dirname, 'cities-data-backup.js');

async function filterChineseCities() {
  console.log('Loading cities data...');
  
  // Load existing cities data
  let cities = [];
  if (await fs.pathExists(CITIES_DATA_FILE)) {
    try {
      cities = require(CITIES_DATA_FILE);
      console.log(`Loaded ${cities.length} cities from ${CITIES_DATA_FILE}`);
    } catch (error) {
      console.error('Error loading cities data:', error.message);
      return;
    }
  } else {
    console.error(`Cities data file not found: ${CITIES_DATA_FILE}`);
    return;
  }

  // Create backup
  console.log('Creating backup...');
  await fs.copyFile(CITIES_DATA_FILE, BACKUP_FILE);
  console.log(`Backup saved to: ${BACKUP_FILE}`);

  // Separate Chinese cities from others
  const chineseCities = [];
  const otherCities = [];

  for (const city of cities) {
    const country = city.country ? city.country.toLowerCase() : '';
    if (country.includes('china') || country.includes('hong kong') || country.includes('taiwan')) {
      chineseCities.push(city);
    } else {
      otherCities.push(city);
    }
  }

  console.log(`\nFound ${chineseCities.length} Chinese cities`);
  console.log(`Found ${otherCities.length} cities from other countries`);

  // Sort Chinese cities by rank and keep only top 10
  chineseCities.sort((a, b) => a.rank - b.rank);
  const top10ChineseCities = chineseCities.slice(0, 10);

  console.log(`\nTop 10 Chinese cities (by rank):`);
  top10ChineseCities.forEach(city => {
    console.log(`  ${city.rank}. ${city.name}, ${city.country || 'N/A'}`);
  });

  // Combine: top 10 Chinese cities + all other cities
  const filteredCities = [...top10ChineseCities, ...otherCities];

  // Re-sort by rank to maintain correct order
  filteredCities.sort((a, b) => a.rank - b.rank);

  // Re-assign ranks to be sequential (1, 2, 3, ...)
  filteredCities.forEach((city, index) => {
    city.rank = index + 1;
  });

  console.log(`\n✅ Filtered to ${filteredCities.length} cities (${top10ChineseCities.length} Chinese + ${otherCities.length} others)`);
  console.log(`Removed ${chineseCities.length - top10ChineseCities.length} Chinese cities`);

  // Write filtered data back to file
  const jsContent = `module.exports = ${JSON.stringify(filteredCities, null, 2)};`;
  await fs.writeFile(CITIES_DATA_FILE, jsContent, 'utf-8');

  console.log(`\n✅ Filtered data saved to: ${CITIES_DATA_FILE}`);
  console.log(`\nSample filtered cities:`);
  filteredCities.slice(0, 10).forEach(city => {
    console.log(`  ${city.rank}. ${city.name}, ${city.country || 'N/A'} - Population: ${city.population.toLocaleString()}`);
  });
}

// Run
filterChineseCities().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
