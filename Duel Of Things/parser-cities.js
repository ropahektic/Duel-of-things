require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

const CITIES_TXT_FILE = path.join(__dirname, 'cities.txt');
const DATA_FILE = path.join(__dirname, 'cities-data.js');

// Parse cities from cities.txt file and create data file
async function parseCities() {
  console.log(`Reading cities from cities.txt...`);
  
  try {
    const fileContent = await fs.readFile(CITIES_TXT_FILE, 'utf-8');
    const lines = fileContent.split('\n');
    const cities = [];
    
    // Find start of data (skip header lines)
    let startIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('TOKYO') || lines[i].includes('JAKARTA')) {
        startIndex = i;
        break;
      }
    }
    
    console.log(`Found data starting at line ${startIndex + 1}`);
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Split by tab character
      const columns = line.split('\t');
      
      // Need at least 3 columns: City, Rank, Population
      if (columns.length < 3) continue;
      
      // Column 0: City name with country (e.g., "TOKYO, Japan" or "New York (NY), United States")
      const cityCountry = columns[0].trim();
      if (!cityCountry || cityCountry.length < 2) continue;
      
      // Split city name and country
      const lastCommaIndex = cityCountry.lastIndexOf(',');
      let cityName = cityCountry;
      let country = null;
      
      if (lastCommaIndex > 0) {
        cityName = cityCountry.substring(0, lastCommaIndex).trim();
        country = cityCountry.substring(lastCommaIndex + 1).trim();
      }
      
      // Column 1: World Rank (may have quotes like "182'")
      const rankText = columns[1].trim().replace(/'/g, '');
      const rank = parseInt(rankText.replace(/[^0-9]/g, ''));
      if (!rank || isNaN(rank) || rank < 1 || rank > 1000) continue;
      
      // Column 2: 2008 estimate (population)
      // Some cities might not have population in column 2, try to find it in other columns
      let population = null;
      
      // Try column 2 first (2008 estimate)
      const popText = columns[2] ? columns[2].trim() : '';
      if (popText && popText !== '...' && !popText.includes("'")) {
        const cleanPop = popText.replace(/[, ]/g, '');
        if (cleanPop.includes('.')) {
          const millions = parseFloat(cleanPop);
          if (!isNaN(millions) && millions > 0) {
            population = Math.round(millions * 1000000);
          }
        } else {
          const num = parseInt(cleanPop);
          if (!isNaN(num) && num > 0) {
            population = num;
          }
        }
      }
      
      // If no population found in column 2, try other columns (city population, urban area population, etc.)
      if (!population) {
        for (let colIdx = 3; colIdx < Math.min(columns.length, 10); colIdx++) {
          const colText = columns[colIdx] ? columns[colIdx].trim() : '';
          if (!colText || colText === '...' || colText.includes("'") || colText.length < 4) continue;
          
          // Check if it looks like a population number
          const cleanPop = colText.replace(/[, ]/g, '');
          const num = parseInt(cleanPop);
          if (!isNaN(num) && num > 100000 && num < 100000000) {
            population = num;
            break;
          }
        }
      }
      
      // Skip if still no valid population found
      if (!population || population < 100000) continue;
      
      // Generate city ID
      const cityId = cityName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40) + `-${rank}`;
      
      cities.push({
        id: cityId,
        name: cityName,
        country: country,
        rank: rank,
        population: population,
        lat: null,
        lng: null,
        imagePath: null
      });
    }
    
    // Sort by rank to ensure correct order
    cities.sort((a, b) => a.rank - b.rank);
    
    console.log(`\n✅ Parsed ${cities.length} cities from cities.txt`);
    
    if (cities.length === 0) {
      throw new Error('No cities found in cities.txt');
    }
    
    // Write to JS file
    const jsContent = `module.exports = ${JSON.stringify(cities, null, 2)};`;
    await fs.writeFile(DATA_FILE, jsContent, 'utf-8');
    
    console.log(`✅ Data saved to: ${DATA_FILE}`);
    console.log(`\nSample cities:`);
    cities.slice(0, 5).forEach(city => {
      console.log(`  ${city.rank}. ${city.name}, ${city.country || 'N/A'} - Population: ${city.population.toLocaleString()}`);
    });
    
  } catch (error) {
    console.error('❌ Error parsing cities:', error.message);
    throw error;
  }
}

// Run parser
parseCities().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
