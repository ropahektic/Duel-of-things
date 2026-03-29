require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const NOT_FOUND_FILE = path.join(__dirname, 'games-not-found.json');
const OUTPUT_DIR = path.join(__dirname, 'games');
const GAMES_DATA_FILE = path.join(__dirname, 'games-data.js');

// Download image
async function downloadImage(imageUrl, gameId) {
  try {
    if (!imageUrl) return null;
    
    const imagePath = path.join(OUTPUT_DIR, `${gameId}.jpg`);
    
    // Skip if already exists
    if (await fs.pathExists(imagePath)) {
      return imagePath;
    }
    
    console.log(`  Downloading from: ${imageUrl.substring(0, 80)}...`);
    
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.google.com/'
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
      console.error(`  ✗ HTTP ${error.response.status} for ${gameId}: ${error.response.statusText}`);
    } else {
      console.error(`  ✗ Failed to download image for ${gameId}:`, error.message);
    }
    return null;
  }
}

// Search DuckDuckGo Images for a game (more scraping-friendly than Google)
async function searchDuckDuckGoImages(page, gameName, platform, year) {
  try {
    // Build search query: "game name platform year game cover" or "game name platform box art"
    const searchQuery = `${gameName} ${platform} ${year} game cover box art`.trim();
    const encodedQuery = encodeURIComponent(searchQuery);
    
    const searchUrl = `https://duckduckgo.com/?q=${encodedQuery}&iax=images&ia=images`;
    
    console.log(`  Searching DuckDuckGo: "${searchQuery}"`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for images to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Extract first image URL
    const imageUrl = await page.evaluate(() => {
      // DuckDuckGo Images selectors
      const selectors = [
        'img[data-src]',
        'img.tile--img__img',
        'img[class*="tile"]',
        'img[src*="external"]',
        'img'
      ];
      
      for (const selector of selectors) {
        const images = Array.from(document.querySelectorAll(selector));
        for (const img of images) {
          let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.src;
          
          // Skip placeholder images, data URLs, and small icons
          if (!src || 
              src.startsWith('data:') || 
              src.includes('logo') || 
              src.includes('icon') ||
              src.includes('placeholder') ||
              src.length < 20) {
            continue;
          }
          
          // DuckDuckGo uses external image URLs
          if (src.includes('external') || src.includes('http')) {
            // Extract actual image URL from DuckDuckGo proxy if needed
            if (src.includes('external-content')) {
              const urlMatch = src.match(/u=([^&]+)/);
              if (urlMatch) {
                src = decodeURIComponent(urlMatch[1]);
              }
            }
            
            // Make sure it's a full URL
            if (src.startsWith('http')) {
              return src;
            }
          }
        }
      }
      
      return null;
    });
    
    return imageUrl;
  } catch (error) {
    console.error(`  ✗ Error searching DuckDuckGo Images:`, error.message);
    return null;
  }
}

// Process games not found in IGDB
async function processNotFoundGames() {
  console.log('Starting DuckDuckGo Images search for games not found in IGDB...');
  
  // Check if not-found file exists
  if (!await fs.pathExists(NOT_FOUND_FILE)) {
    console.error(`❌ File not found: ${NOT_FOUND_FILE}`);
    console.log('Run "npm run parse-games" first to generate games-not-found.json');
    return;
  }
  
  // Read not-found games
  const notFoundGames = await fs.readJSON(NOT_FOUND_FILE);
  
  if (notFoundGames.length === 0) {
    console.log('No games to process! All games were found in IGDB.');
    return;
  }
  
  console.log(`Found ${notFoundGames.length} games to process from Google Images\n`);
  
  // Launch browser
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const updatedGames = [];
    const stillNotFound = [];
    
    for (let i = 0; i < notFoundGames.length; i++) {
      const game = notFoundGames[i];
      console.log(`\n[${i + 1}/${notFoundGames.length}] Processing: ${game.name} (Rank #${game.rank}, ${game.platform}, ${game.year})`);
      
      // Search DuckDuckGo Images (more scraping-friendly)
      const imageUrl = await searchDuckDuckGoImages(page, game.name, game.platform, game.year);
      
      if (imageUrl) {
        // Download image
        const imagePath = await downloadImage(imageUrl, game.id);
        
        if (imagePath) {
          const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
          
          updatedGames.push({
            ...game,
            imagePath: relativeImagePath,
            foundInIGDB: false,
            imageSource: 'DuckDuckGo Images'
          });
          
          console.log(`  ✓ Successfully processed ${game.name}`);
        } else {
          console.log(`  ⚠ Could not download image for ${game.name}`);
        stillNotFound.push({
          ...game,
          reason: 'Image download failed from DuckDuckGo'
        });
        }
      } else {
        console.log(`  ⚠ Could not find image on DuckDuckGo Images for ${game.name}`);
        stillNotFound.push({
          ...game,
          reason: 'Not found on DuckDuckGo Images'
        });
      }
      
      // Rate limiting - wait between searches (longer delay to avoid issues)
      const delay = 3000 + Math.random() * 2000; // 3-5 seconds random delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Save progress every 10 games
      if ((i + 1) % 10 === 0) {
        await updateGamesData(updatedGames);
        console.log(`\n💾 Progress saved: ${updatedGames.length} games processed`);
      }
    }
    
    // Update games-data.js with new images
    await updateGamesData(updatedGames);
    
    // Update not-found file with remaining games
    await fs.writeJSON(NOT_FOUND_FILE, stillNotFound, { spaces: 2 });
    
    console.log(`\n✅ Processing complete!`);
    console.log(`   Games processed: ${updatedGames.length}`);
    console.log(`   Games still not found: ${stillNotFound.length}`);
    console.log(`   Updated games-data.js`);
    console.log(`   Remaining not-found games saved to: ${NOT_FOUND_FILE}`);
    
  } finally {
    await browser.close();
  }
}

// Update games-data.js with new images
async function updateGamesData(newGames) {
  if (!await fs.pathExists(GAMES_DATA_FILE)) {
    console.log('games-data.js not found, creating new file...');
    await fs.writeFile(GAMES_DATA_FILE, `const gamesData = ${JSON.stringify(newGames, null, 2)};\n\nmodule.exports = gamesData;`, 'utf8');
    return;
  }
  
  // Read existing games data
  const existingGames = require(GAMES_DATA_FILE);
  
  // Create a map of existing games by ID
  const gamesMap = new Map();
  existingGames.forEach(game => {
    gamesMap.set(game.id, game);
  });
  
  // Update with new images
  newGames.forEach(game => {
    gamesMap.set(game.id, game);
  });
  
  // Convert back to array and sort by rank
  const updatedGames = Array.from(gamesMap.values()).sort((a, b) => a.rank - b.rank);
  
  // Save updated data
  const jsContent = `// Games data parsed from sales dataset
// Generated automatically - do not edit manually
// Total: ${updatedGames.length} games

const gamesData = ${JSON.stringify(updatedGames, null, 2)};

module.exports = gamesData;
`;
  
  await fs.writeFile(GAMES_DATA_FILE, jsContent, 'utf8');
}

// Run the script
if (require.main === module) {
  processNotFoundGames()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { processNotFoundGames };
