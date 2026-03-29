require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const CITIES_DATA_FILE = path.join(__dirname, 'cities-data.js');
const OUTPUT_DIR = path.join(__dirname, 'cities');
const UPDATED_DATA_FILE = path.join(__dirname, 'cities-data.js');

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Ensure directories exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image from URL
async function downloadImage(imageUrl, cityId) {
  try {
    if (!imageUrl) {
      return null;
    }

    const imagePath = path.join(OUTPUT_DIR, `${cityId}.jpg`);
    if (await fs.pathExists(imagePath)) {
      return imagePath; // Skip if already exists
    }

    console.log(`  Downloading from: ${imageUrl.substring(0, 80)}...`);

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });

    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`  ✓ Saved to: ${imagePath}`);
        resolve(imagePath);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    if (error.response) {
      console.error(`  ✗ HTTP ${error.response.status} for ${cityId}: ${error.response.statusText}`);
    } else {
      console.error(`  ✗ Failed to download image:`, error.message);
    }
    return null;
  }
}

// Search for city image using Pexels API
async function searchCityImagePexels(cityName, country = null) {
  try {
    if (!PEXELS_API_KEY) {
      console.error('  ⚠ Pexels API key not found!');
      console.error('  Get a free API key from: https://www.pexels.com/api/');
      console.error('  Add to .env: PEXELS_API_KEY=your_api_key');
      return null;
    }

    // Build search queries - try multiple variations
    const queries = [];
    
    // Try different query variations
    if (country) {
      queries.push(`${cityName} ${country} city`);
      queries.push(`${cityName} ${country} skyline`);
      queries.push(`${cityName} city`);
    } else {
      queries.push(`${cityName} city`);
      queries.push(`${cityName} skyline`);
    }
    
    // Clean city name (remove parentheses content)
    const cleanCityName = cityName.replace(/\s*\([^)]+\)\s*/g, '').trim();
    if (cleanCityName !== cityName && country) {
      queries.push(`${cleanCityName} ${country} city`);
    }

    // Try each query variation
    for (const query of queries) {
      try {
        const response = await axios.get(PEXELS_API_URL, {
          params: {
            query: query,
            per_page: 1, // Just get the first/best result
            orientation: 'landscape', // Prefer landscape for city images
            size: 'large'
          },
          headers: {
            'Authorization': PEXELS_API_KEY
          },
          timeout: 15000
        });

        if (response.data && response.data.photos && response.data.photos.length > 0) {
          const photo = response.data.photos[0];
          // Get large size (good quality)
          const imageUrl = photo.src?.large || photo.src?.medium || photo.src?.original;
          return imageUrl;
        }
      } catch (queryError) {
        // If rate limited, break and handle retry
        if (queryError.response?.status === 429) {
          throw queryError; // Re-throw to handle rate limit
        }
        // Otherwise continue to next query
        continue;
      }
    }

    return null;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('  ✗ Pexels API authentication failed. Check your API key.');
      return null;
    } else if (error.response?.status === 429) {
      // Rate limit exceeded
      console.error('  ✗ Pexels API rate limit exceeded.');
      return null;
    } else {
      console.error(`  ✗ Error searching Pexels:`, error.message);
      return null;
    }
  }
}

// Fetch images for cities
async function fetchCityImages() {
  await ensureDirectory(OUTPUT_DIR);
  
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
    console.error('Run "npm run parse-cities" first to create the data file.');
    return;
  }

  if (!PEXELS_API_KEY) {
    console.error('\n❌ Pexels API key not found!');
    console.error('\nTo get a free Pexels API key:');
    console.error('1. Go to https://www.pexels.com/api/');
    console.error('2. Click "Get Started"');
    console.error('3. Sign up for free account');
    console.error('4. Create a new application');
    console.error('5. Copy your API key');
    console.error('6. Add to .env file: PEXELS_API_KEY=your_api_key');
    console.error('\nFree tier: 200 requests/hour (much better than Unsplash!)');
    return;
  }

  console.log(`\nStarting image fetch for ${cities.length} cities...`);
  console.log(`Using Pexels API (free tier: 200 requests/hour)`);
  console.log(`At 200/hour, this will take approximately ${Math.ceil(cities.length / 200)} hours\n`);

  let processed = 0;
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    console.log(`[${i + 1}/${cities.length}] Processing: ${city.name}${city.country ? `, ${city.country}` : ''} (Rank #${city.rank})`);

    // Skip if already has image
    if (city.imagePath && await fs.pathExists(path.join(__dirname, city.imagePath))) {
      console.log(`  ✓ Already has image, skipping...`);
      skipCount++;
      continue;
    }

    // Search for image
    console.log(`  🔍 Searching Pexels...`);
    const imageUrl = await searchCityImagePexels(city.name, city.country);

    if (imageUrl) {
      console.log(`  ✓ Found image URL`);
      
      // Download image
      const imagePath = await downloadImage(imageUrl, city.id);
      
      if (imagePath) {
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        city.imagePath = relativeImagePath;
        successCount++;
        console.log(`  ✓ Successfully processed ${city.name}`);
      } else {
        failCount++;
        console.log(`  ⚠ Failed to download image for ${city.name}`);
      }
    } else {
      failCount++;
      console.log(`  ⚠ Could not find image for ${city.name}`);
    }

    processed++;

    // Save progress every 50 cities
    if (processed % 50 === 0) {
      const jsContent = `module.exports = ${JSON.stringify(cities, null, 2)};`;
      await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf-8');
      console.log(`\n💾 Progress saved: ${processed} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
    }

    // Rate limiting: Pexels free tier is 200/hour = ~3.3 requests/minute
    // Use 20 seconds between requests to be safe (3/minute = 180/hour)
    await new Promise(resolve => setTimeout(resolve, 20000));
  }

  // Final save
  const jsContent = `module.exports = ${JSON.stringify(cities, null, 2)};`;
  await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf-8');

  console.log(`\n✅ Image fetching complete!`);
  console.log(`Total cities: ${cities.length}`);
  console.log(`Processed: ${processed}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Skipped (already had images): ${skipCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Data saved to: ${UPDATED_DATA_FILE}`);
}

// Run
fetchCityImages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
