const fs = require('fs-extra');
const path = require('path');

const CITIES_DATA_FILE = path.join(__dirname, 'cities-data.js');
const OUTPUT_FILE = path.join(__dirname, 'cities-by-country.js');

// Load cities data
function loadCitiesData() {
  try {
    delete require.cache[require.resolve(CITIES_DATA_FILE)];
    return require(CITIES_DATA_FILE);
  } catch (error) {
    console.error('Error loading cities data:', error);
    return [];
  }
}

// Organize cities by country
function organizeCitiesByCountry() {
  console.log('🌍 Organizing cities by country...\n');
  
  const cities = loadCitiesData();
  console.log(`Loaded ${cities.length} cities\n`);
  
  // Group cities by country
  const countriesMap = {};
  
  for (const city of cities) {
    const country = city.country || 'Unknown';
    
    if (!countriesMap[country]) {
      countriesMap[country] = [];
    }
    
    countriesMap[country].push(city.name);
  }
  
  // Filter to only countries with 2+ cities
  const countriesWithMultipleCities = {};
  
  for (const [country, cityNames] of Object.entries(countriesMap)) {
    if (cityNames.length >= 2) {
      countriesWithMultipleCities[country] = cityNames;
    }
  }
  
  // Sort countries alphabetically
  const sortedCountries = Object.keys(countriesWithMultipleCities).sort();
  
  // Create output data
  const output = {};
  for (const country of sortedCountries) {
    output[country] = countriesWithMultipleCities[country];
  }
  
  // Generate output file
  const jsContent = `// Cities organized by country (only countries with 2+ cities)
// Generated automatically - do not edit manually
// Total countries: ${sortedCountries.length}

module.exports = ${JSON.stringify(output, null, 2)};
`;
  
  fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf8');
  
  console.log(`✅ Organized cities by country!`);
  console.log(`\n📊 Summary:`);
  console.log(`   Total countries with 2+ cities: ${sortedCountries.length}`);
  console.log(`   Total cities in filtered list: ${Object.values(countriesWithMultipleCities).reduce((sum, cities) => sum + cities.length, 0)}`);
  
  console.log(`\n📋 Sample countries:`);
  const sampleCountries = sortedCountries.slice(0, 10);
  for (const country of sampleCountries) {
    const cities = countriesWithMultipleCities[country];
    console.log(`   ${country}: ${cities.join(', ')}`);
  }
  
  if (sortedCountries.length > 10) {
    console.log(`   ... and ${sortedCountries.length - 10} more countries`);
  }
  
  console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
}

// Run
organizeCitiesByCountry();
