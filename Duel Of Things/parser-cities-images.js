require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const CITIES_DATA_FILE = path.join(__dirname, 'cities-data.js');
const OUTPUT_DIR = path.join(__dirname, 'cities');
const UPDATED_DATA_FILE = path.join(__dirname, 'cities-data.js');

const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

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

// Search for city image using Unsplash API with retry logic
async function searchCityImageUnsplash(cityName, country = null, retryCount = 0) {
  try {
    if (!UNSPLASH_ACCESS_KEY) {
      console.error('  ⚠ Unsplash API key not found!');
      console.error('  Get a free API key from: https://unsplash.com/developers');
      console.error('  Add to .env: UNSPLASH_ACCESS_KEY=your_access_key');
      return null;
    }

    // Build search queries - try multiple variations for better results
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
    
    // Clean city name (remove parentheses content like "(FL)" or "(NY)")
    const cleanCityName = cityName.replace(/\s*\([^)]+\)\s*/g, '').trim();
    if (cleanCityName !== cityName && country) {
      queries.push(`${cleanCityName} ${country} city`);
    }

    // Try each query variation
    for (const query of queries) {
      try {
        const response = await axios.get(UNSPLASH_API_URL, {
          params: {
            query: query,
            per_page: 1, // Just get the first/best result
            orientation: 'landscape', // Prefer landscape for city images
            order_by: 'relevance'
          },
          headers: {
            'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`
          },
          timeout: 15000
        });

        if (response.data && response.data.results && response.data.results.length > 0) {
          const photo = response.data.results[0];
          // Get regular size (good quality, not too large)
          const imageUrl = photo.urls?.regular || photo.urls?.small || photo.urls?.thumb;
          return imageUrl;
        }
      } catch (queryError) {
        // If rate limited, break and handle retry
        if (queryError.response?.status === 403) {
          throw queryError; // Re-throw to handle rate limit
        }
        // Otherwise continue to next query
        continue;
      }
    }

    return null;
  } catch (error) {
    if (error.response?.status === 401) {
      console.error('  ✗ Unsplash API authentication failed. Check your API key.');
      return null;
    } else if (error.response?.status === 403) {
      // Rate limit exceeded - retry with exponential backoff
      if (retryCount < 3) {
        const waitTime = Math.pow(2, retryCount) * 60; // 60s, 120s, 240s
        console.log(`  ⏳ Rate limited. Waiting ${waitTime} seconds before retry ${retryCount + 1}/3...`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        return searchCityImageUnsplash(cityName, country, retryCount + 1);
      } else {
        console.error('  ✗ Unsplash API rate limit exceeded after retries. Please wait and resume later.');
        return null;
      }
    } else {
      console.error(`  ✗ Error searching Unsplash:`, error.message);
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

  if (!UNSPLASH_ACCESS_KEY) {
    console.error('\n❌ Unsplash API key not found!');
    console.error('\nTo get a free Unsplash API key:');
    console.error('1. Go to https://unsplash.com/developers');
    console.error('2. Click "Register as a developer"');
    console.error('3. Create a new application');
    console.error('4. Copy your "Access Key"');
    console.error('5. Add to .env file: UNSPLASH_ACCESS_KEY=your_access_key');
    console.error('\nFree tier: 5,000 requests per hour');
    return;
  }

  console.log(`\nStarting image fetch for ${cities.length} cities...`);
  console.log(`Using Unsplash API (free tier: 5,000 requests/hour)\n`);

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
    console.log(`  🔍 Searching Unsplash...`);
    const imageUrl = await searchCityImageUnsplash(city.name, city.country);

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

    // Rate limiting: Unsplash free tier is 5,000/hour = ~83 requests/minute
    // Use 2 seconds between requests to be safe (30/minute = 1,800/hour, well under 5,000 limit)
    // This prevents hitting rate limits and gives API time to process
    await new Promise(resolve => setTimeout(resolve, 2000));
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
