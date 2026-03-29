const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://myanimelist.net/character.php';
const OUTPUT_DIR = path.join(__dirname, 'characters');
const DATA_FILE = path.join(__dirname, 'characters-data.js');

// Create output directory if it doesn't exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Convert relative URL to absolute
function getAbsoluteUrl(url, baseUrl = 'https://myanimelist.net') {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  if (url.startsWith('/')) {
    return baseUrl + url;
  }
  return baseUrl + '/' + url;
}

// Fetch high-quality image from character's individual page
async function fetchCharacterImage(characterId, characterUrl) {
  try {
    // Visit the character's individual page to get high-quality image
    const fullUrl = getAbsoluteUrl(characterUrl);
    console.log(`  Fetching image from: ${fullUrl}`);
    
    const response = await axios.get(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    
    // Find the main character image - look specifically for /images/characters/ pattern
    // This is the high-quality character image URL pattern
    let imageUrl = null;
    
    // First, try to find images with the specific pattern /images/characters/
    const allImgs = $('img');
    
    // Priority 1: Look for images matching the pattern /images/characters/{number}/{id}.jpg
    for (let i = 0; i < allImgs.length; i++) {
      const img = $(allImgs[i]);
      let url = img.attr('src') || 
                img.attr('data-src') || 
                img.attr('data-lazy-src') ||
                img.attr('data-original');
      
      if (url && url.includes('/images/characters/')) {
        // This is the high-quality character image
        imageUrl = url;
        break;
      }
    }
    
    // Priority 2: If not found, try other selectors that might contain the character image
    if (!imageUrl) {
      const imageSelectors = [
        'div.leftside img',
        'div.picSurround img',
        'img[itemprop="image"]',
        'div.character-image img',
        'table tr:first-child img',
        'div#content table img',
        'div#content img[width]'
      ];
      
      for (const selector of imageSelectors) {
        const imgs = $(selector);
        if (imgs.length > 0) {
          for (let i = 0; i < imgs.length; i++) {
            const img = $(imgs[i]);
            let url = img.attr('src') || 
                      img.attr('data-src') || 
                      img.attr('data-lazy-src') ||
                      img.attr('data-original');
            
            // Skip placeholder images and non-image files
            if (url && 
                !url.includes('pixel.gif') && 
                !url.includes('1x1') &&
                !url.includes('logo') &&
                !url.includes('icon') &&
                !url.includes('banner') &&
                url.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
              imageUrl = url;
              break;
            }
          }
          if (imageUrl) break;
        }
      }
    }
    
    if (!imageUrl) {
      console.error(`  Could not find image for character ${characterId}`);
      return null;
    }
    
    // Convert to absolute URL
    imageUrl = getAbsoluteUrl(imageUrl);
    
    // Verify we found the correct image pattern
    if (imageUrl.includes('/images/characters/')) {
      console.log(`  ✓ Found high-quality character image: ${imageUrl}`);
    } else {
      console.log(`  ⚠ Using fallback image: ${imageUrl}`);
    }
    
    // Download the image
    const imageResponse = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });

    // Get image extension from URL or default to jpg
    const urlParts = imageUrl.split('.');
    const extension = urlParts[urlParts.length - 1].split('?')[0] || 'jpg';
    const imagePath = path.join(OUTPUT_DIR, `${characterId}.${extension}`);

    const writer = fs.createWriteStream(imagePath);
    imageResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(imagePath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`  Failed to fetch image for character ${characterId}:`, error.message);
    return null;
  }
}

// Parse a single page of characters
async function parsePage(pageNumber) {
  try {
    // MyAnimeList uses ?limit= parameter for pagination (0-indexed offset)
    const url = pageNumber === 1 ? BASE_URL : `${BASE_URL}?limit=${(pageNumber - 1) * 50}`;
    console.log(`Fetching page ${pageNumber} (${url})...`);
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const characters = [];

    // Debug: Save first page HTML for inspection
    if (pageNumber === 1) {
      await fs.writeFile(path.join(__dirname, 'debug-page1.html'), response.data);
      console.log('Debug: Saved first page HTML to debug-page1.html');
      
      // Debug: Check what tables exist
      const tables = $('table');
      console.log(`Debug: Found ${tables.length} tables on page`);
      tables.each((i, table) => {
        const className = $(table).attr('class') || 'no-class';
        const rows = $(table).find('tr').length;
        console.log(`  Table ${i + 1}: class="${className}", ${rows} rows`);
      });
    }

    // Find all character links first (more reliable than table structure)
    const characterLinks = $('a[href*="/character/"]');
    console.log(`Found ${characterLinks.length} character links on page ${pageNumber}`);

    // Group links by their parent row to get associated data
    const processedIds = new Set();
    
    characterLinks.each((index, linkElement) => {
      const $link = $(linkElement);
      const characterUrl = $link.attr('href');
      const characterName = $link.text().trim();
      
      if (!characterUrl || !characterName) return;

      // Extract character ID from URL
      const urlMatch = characterUrl.match(/\/character\/(\d+)\//);
      if (!urlMatch) return;
      const characterId = urlMatch[1];
      
      // Skip duplicates
      if (processedIds.has(characterId)) return;
      processedIds.add(characterId);

      // Find the parent row (table row)
      const $row = $link.closest('tr');
      if ($row.length === 0) return;

      // Skip header rows
      if ($row.find('th').length > 0) return;

      // Extract favorites count (last column of the row)
      let favoritesText = $row.find('td:last-child').text().trim();
      // Remove any non-numeric characters except commas
      favoritesText = favoritesText.replace(/[^\d,]/g, '');
      const favorites = parseInt(favoritesText.replace(/,/g, '')) || 0;

      characters.push({
        id: characterId,
        name: characterName,
        favorites: favorites,
        characterUrl: characterUrl
      });
    });

    console.log(`Parsed ${characters.length} characters from page ${pageNumber}`);
    return characters;
  } catch (error) {
    console.error(`Error parsing page ${pageNumber}:`, error.message);
    if (error.response) {
      console.error(`Response status: ${error.response.status}`);
    }
    return [];
  }
}

// Save progress to file
async function saveProgress(characters) {
  const jsContent = `// Character data parsed from MyAnimeList
// Generated automatically - do not edit manually
// Progress: ${characters.length} characters processed

const charactersData = ${JSON.stringify(characters, null, 2)};

module.exports = charactersData;
`;

  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

// Main parsing function
async function parseTopCharacters(maxCharacters = 1000) {
  console.log('Starting character parsing...');
  console.log(`Will process up to ${maxCharacters} characters`);
  console.log(`Data will be saved to: ${DATA_FILE}`);
  console.log(`Images will be saved to: ${OUTPUT_DIR}\n`);
  await ensureDirectory(OUTPUT_DIR);

  const allCharacters = [];
  const charactersPerPage = 50;
  const totalPages = Math.ceil(maxCharacters / charactersPerPage);

  for (let page = 1; page <= totalPages; page++) {
    const characters = await parsePage(page);
    
    for (const char of characters) {
      if (allCharacters.length >= maxCharacters) break;

      console.log(`Processing ${allCharacters.length + 1}/${maxCharacters}: ${char.name} (${char.favorites} favorites)`);
      
      // Fetch high-quality image from character's individual page
      const imagePath = await fetchCharacterImage(char.id, char.characterUrl);
      
      if (imagePath) {
        // Get relative path from project root
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        
        allCharacters.push({
          id: char.id,
          name: char.name,
          favorites: char.favorites,
          imagePath: relativeImagePath
        });
        
        // Save progress periodically (every 10 characters) to prevent data loss
        if (allCharacters.length % 10 === 0) {
          await saveProgress(allCharacters);
          console.log(`  💾 Progress saved: ${allCharacters.length} characters processed so far`);
        }
      }

      // Be nice to the server - add delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000)); // Increased delay since we're fetching individual pages
    }

    if (allCharacters.length >= maxCharacters) break;
    
    // Delay between pages
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Final save to JS file
  await saveProgress(allCharacters);
  console.log(`\n✅ Parsing complete!`);
  console.log(`   Total characters: ${allCharacters.length}`);
  console.log(`   Data saved to: ${DATA_FILE}`);
  console.log(`   Images saved to: ${OUTPUT_DIR}`);
  
  return allCharacters;
}

// Run the parser
if (require.main === module) {
  parseTopCharacters(1000)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseTopCharacters };
