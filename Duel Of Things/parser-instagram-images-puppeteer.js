const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, 'instagram-data.js');
const OUTPUT_DIR = path.join(__dirname, 'influencers');

// Ensure directories exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image from URL
async function downloadImage(imageUrl, influencerId) {
  try {
    if (!imageUrl || !imageUrl.startsWith('http')) {
      console.error(`Invalid image URL: ${imageUrl}`);
      return null;
    }

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
      }
    });

    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const imagePath = path.join(OUTPUT_DIR, `${influencerId}${ext}`);
    
    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        const relativePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        resolve(relativePath);
      });
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Error downloading image for ${influencerId}:`, error.message);
    return null;
  }
}

// Search DuckDuckGo for influencer image
async function searchDuckDuckGoImage(page, influencerName) {
  try {
    const searchQuery = encodeURIComponent(influencerName);
    const url = `https://duckduckgo.com/?q=${searchQuery}&iax=images&ia=images`;
    
    console.log(`  🔍 Searching DuckDuckGo: "${influencerName}"`);
    
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for images to load
    let imageUrl = null;
    let attempts = 0;
    const maxAttempts = 15;
    
    while (!imageUrl && attempts < maxAttempts) {
      attempts++;
      
      // Try to find images - DuckDuckGo uses various selectors
      imageUrl = await page.evaluate(() => {
        // Try different selectors for DuckDuckGo images
        const selectors = [
          'img[data-src]',
          'a[class*="tile"] img',
          'img[src*="external"]',
          'img[src*="duckduckgo"]',
          '.tile--img img',
          '.tile img'
        ];
        
        for (const selector of selectors) {
          const images = Array.from(document.querySelectorAll(selector));
          
          for (const img of images) {
            let url = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
            
            if (!url) continue;
            
            // Handle protocol-relative URLs
            if (url.startsWith('//')) {
              url = 'https:' + url;
            }
            
            // Handle DuckDuckGo proxy URLs
            if (url.includes('external-content.duckduckgo.com')) {
              const match = url.match(/[?&]u=([^&]+)/);
              if (match) {
                try {
                  url = decodeURIComponent(match[1]);
                  // Sometimes it's double-encoded
                  if (url.includes('%')) {
                    url = decodeURIComponent(url);
                  }
                } catch (e) {
                  // If decoding fails, try the original URL
                }
              }
            }
            
            // Validate URL
            if (url && url.startsWith('http') && !url.includes('data:image')) {
              // Filter out small icons/logos
              const width = img.naturalWidth || img.width || 0;
              const height = img.naturalHeight || img.height || 0;
              
              // Skip very small images (likely icons)
              if (width > 50 && height > 50) {
                // Filter out common icon/logo URLs
                const lowerUrl = url.toLowerCase();
                if (!lowerUrl.includes('icon') && 
                    !lowerUrl.includes('logo') && 
                    !lowerUrl.includes('favicon') &&
                    !lowerUrl.includes('.svg')) {
                  return url;
                }
              }
            }
          }
        }
        
        return null;
      });
      
      if (!imageUrl) {
        // Wait a bit and try again
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`  ⏳ Waiting for images to load... (${attempts}s)`);
      }
    }
    
    if (imageUrl) {
      console.log(`  ✓ Found image URL: ${imageUrl.substring(0, 80)}...`);
      return imageUrl;
    } else {
      console.log(`  ⚠ Could not find image from DuckDuckGo`);
      return null;
    }
    
  } catch (error) {
    console.error(`  ✗ Error searching DuckDuckGo: ${error.message}`);
    return null;
  }
}

// Main parsing function
async function parseInstagramImages() {
  console.log('📱 Starting Instagram Influencer Images Parser...\n');
  
  await ensureDirectory(OUTPUT_DIR);
  
  // Load existing data
  let influencerData = [];
  if (await fs.pathExists(DATA_FILE)) {
    try {
      delete require.cache[require.resolve(DATA_FILE)];
      influencerData = require(DATA_FILE);
      console.log(`📂 Loaded ${influencerData.length} influencers\n`);
    } catch (error) {
      console.error('❌ Error loading data file:', error);
      return;
    }
  } else {
    console.error(`❌ Data file not found: ${DATA_FILE}`);
    return;
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    let processed = 0;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < influencerData.length; i++) {
      const influencer = influencerData[i];
      const influencerId = `instagram-${influencer.rank}`;
      
      console.log(`[${i + 1}/${influencerData.length}] Processing: ${influencer.name} (Rank #${influencer.rank})`);
      
      // Check if already has image
      if (influencer.imagePath && await fs.pathExists(path.join(__dirname, influencer.imagePath))) {
        console.log(`  ✓ Already has image, skipping...`);
        skipCount++;
        continue;
      }
      
      // Search for image
      const imageUrl = await searchDuckDuckGoImage(page, influencer.name);
      
      if (!imageUrl) {
        console.log(`  ⚠ Could not find image for ${influencer.name}`);
        failCount++;
        continue;
      }
      
      // Download image
      const imagePath = await downloadImage(imageUrl, influencerId);
      
      if (imagePath) {
        console.log(`  ✓ Saved to: ${imagePath}`);
        
        // Update data
        influencer.imagePath = imagePath;
        successCount++;
        console.log(`  ✓ Successfully processed ${influencer.name}`);
      } else {
        console.log(`  ⚠ Could not download image for ${influencer.name}`);
        failCount++;
      }
      
      processed++;
      
      // Save progress every 20 influencers
      if (processed % 20 === 0) {
        const jsContent = `module.exports = ${JSON.stringify(influencerData.sort((a, b) => a.rank - b.rank), null, 2)};`;
        await fs.writeFile(DATA_FILE, jsContent, 'utf-8');
        console.log(`\n💾 Progress saved: ${processed} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
      }
      
      // Rate limiting: wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final save
    const jsContent = `module.exports = ${JSON.stringify(influencerData.sort((a, b) => a.rank - b.rank), null, 2)};`;
    await fs.writeFile(DATA_FILE, jsContent, 'utf-8');
    
    console.log(`\n✅ Parsing complete!`);
    console.log(`📊 Summary:`);
    console.log(`   Total processed: ${processed}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Skipped: ${skipCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`\n💾 Saved to: ${DATA_FILE}`);
    
  } catch (error) {
    console.error('❌ Error during parsing:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the parser
parseInstagramImages().catch(console.error);
