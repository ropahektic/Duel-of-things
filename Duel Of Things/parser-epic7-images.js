const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, 'epic7-data.js');
const OUTPUT_DIR = path.join(__dirname, 'epic7');
const BASE_URL = 'https://epic7db.com/images/heroes';

// Ensure output directory exists
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Generate URL slug from character name
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')  // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')  // Remove special characters
    .replace(/-+/g, '-')  // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '');  // Remove leading/trailing hyphens
}

// Download image from URL
async function downloadImage(imageUrl, characterId) {
  try {
    if (!imageUrl) {
      return null;
    }

    const imagePath = path.join(OUTPUT_DIR, `${characterId}.webp`);
    if (await fs.pathExists(imagePath)) {
      console.log(`  ⏭️  Image already exists, skipping`);
      return imagePath; // Skip if already exists
    }

    console.log(`  🔍 Downloading from: ${imageUrl}`);

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
      console.error(`  ✗ HTTP ${error.response.status} for ${characterId}: ${error.response.statusText}`);
    } else {
      console.error(`  ✗ Failed to download image:`, error.message);
    }
    return null;
  }
}

// Main parsing function
async function parseEpic7Images() {
  try {
    console.log('📖 Reading epic7-data.js...');
    
    // Load the existing data
    const characters = require(DATA_FILE);
    console.log(`📊 Found ${characters.length} characters\n`);
    
    await ensureDirectory(OUTPUT_DIR);
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      console.log(`[${i + 1}/${characters.length}] Processing: ${char.name} (Rank #${char.rank})`);
      
      // Generate URL slug
      const slug = generateSlug(char.name);
      const imageUrl = `${BASE_URL}/${slug}.webp`;
      
      // Download image
      const imagePath = await downloadImage(imageUrl, char.id);
      
      if (imagePath) {
        // Get relative path from project root
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        char.imagePath = relativeImagePath;
        successCount++;
      } else {
        // Try alternative URL patterns if the first one fails
        console.log(`  ⚠️  Trying alternative URL patterns...`);
        
        // Try with different variations
        const alternatives = [
          `${BASE_URL}/${slug.replace(/-/g, '')}.webp`,  // Remove all hyphens
          `${BASE_URL}/${slug.replace(/the-/g, '')}.webp`,  // Remove "the-" prefix
          `${BASE_URL}/${slug.replace(/of-/g, '')}.webp`,  // Remove "of-" 
        ];
        
        let found = false;
        for (const altUrl of alternatives) {
          const altPath = await downloadImage(altUrl, char.id);
          if (altPath) {
            const relativeImagePath = path.relative(__dirname, altPath).replace(/\\/g, '/');
            char.imagePath = relativeImagePath;
            successCount++;
            found = true;
            break;
          }
        }
        
        if (!found) {
          console.log(`  ⚠️  Could not find image for ${char.name}`);
          failCount++;
        }
      }
      
      // Be nice to the server - add delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Save progress every 10 characters
      if ((i + 1) % 10 === 0) {
        await saveProgress(characters);
        console.log(`\n💾 Progress saved: ${i + 1} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
      }
    }
    
    // Final save
    await saveProgress(characters);
    
    console.log(`\n✅ Finished processing all characters!`);
    console.log(`📊 Summary:`);
    console.log(`   Total: ${characters.length}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Skipped: ${skipCount}`);
    console.log(`   Failed: ${failCount}`);
    
  } catch (error) {
    console.error('❌ Error parsing Epic7 images:', error);
    process.exit(1);
  }
}

// Save progress to file
async function saveProgress(characters) {
  const jsContent = `// Epic7 Character Data
// Generated from epic7.txt
// Contains ${characters.length} characters with pickrate, winrate, banrate, and images

module.exports = ${JSON.stringify(characters, null, 2)};
`;
  
  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

parseEpic7Images();
