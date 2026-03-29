const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const OUTPUT_DIR = path.join(__dirname, 'influencers');
const DATA_FILE = path.join(__dirname, 'influencers-data.js');
const TOTAL_PAGES = 3;
const RESULTS_PER_PAGE = 40;

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

// Parse followers string to number (e.g., "614.7M" -> 614700000)
function parseFollowers(followersStr) {
  if (!followersStr) return 0;
  
  const cleanStr = followersStr.trim().toUpperCase();
  const match = cleanStr.match(/^([\d.]+)([KM]?)$/);
  
  if (!match) return 0;
  
  const number = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'M') {
    return Math.round(number * 1000000);
  } else if (suffix === 'K') {
    return Math.round(number * 1000);
  }
  
  return Math.round(number);
}

// Parse influencers from a page
async function parsePage(page, pageNum) {
  console.log(`\n📄 Parsing page ${pageNum}...`);
  
  const url = `https://topnine.co/instagram-influencers${pageNum > 1 ? `?page=${pageNum}` : ''}`;
  console.log(`  Navigating to: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  
  // Wait for content to load - wait for specific influencer name to appear
  try {
    await page.waitForFunction(
      () => {
        const text = document.body.textContent || '';
        return text.includes('Cristiano Ronaldo') || text.includes('614.7M');
      },
      { timeout: 20000 }
    );
    console.log(`  ✓ Content loaded`);
  } catch (error) {
    console.log(`  ⚠ Content may not have loaded, continuing anyway...`);
  }
  
  // Wait additional time for table to render
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Extract data from the table - find by looking for rank numbers and images
  const influencers = await page.evaluate(() => {
    const results = [];
    
    // Strategy: Find all images that are likely profile pictures, then find their parent rows
    // Profile pictures are usually circular and near rank numbers
    
    // First, get all images on the page
    const allImages = Array.from(document.querySelectorAll('img'));
    console.log(`Found ${allImages.length} images on page`);
    
    // For each image, check if it's near influencer data
    const processedRanks = new Set();
    
    for (let img of allImages) {
      // Look for parent elements that contain rank numbers
      let current = img.parentElement;
      let foundRow = null;
      
      // Check up to 5 levels up
      for (let i = 0; i < 5 && current; i++) {
        const text = (current.textContent || '').trim();
        // Look for pattern: rank number at start
        const rankMatch = text.match(/^(\d{1,3})/);
        
        if (rankMatch) {
          const rank = parseInt(rankMatch[1]);
          if (rank >= 1 && rank <= 1000 && !processedRanks.has(rank)) {
            foundRow = current;
            break;
          }
        }
        
        current = current.parentElement;
      }
      
      if (foundRow) {
        const rowText = foundRow.textContent || '';
        const rankMatch = rowText.match(/^(\d{1,3})/);
        if (rankMatch) {
          const rank = parseInt(rankMatch[1]);
          
          // Extract name - usually after the rank
          const nameMatch = rowText.match(/^\d{1,3}\s+(.+?)\s+([\d.]+[KM]?)/);
          let name = null;
          let followers = null;
          
          if (nameMatch) {
            name = nameMatch[1].trim();
            followers = nameMatch[2];
          } else {
            // Try to extract from cells if it's a table row
            const cells = Array.from(foundRow.querySelectorAll('td, div'));
            if (cells.length >= 3) {
              // Cell 0: rank (already have)
              // Cell 1: image (already have)
              // Cell 2 or 3: name
              const nameCell = cells[2] || cells[1];
              if (nameCell) {
                const link = nameCell.querySelector('a');
                name = link ? link.textContent.trim() : nameCell.textContent.trim();
              }
              
              // Cell 3 or 4: followers
              const followersCell = cells[3] || cells[2];
              if (followersCell) {
                const followersText = followersCell.textContent.trim();
                const match = followersText.match(/([\d.]+[KM]?)/);
                if (match) followers = match[1];
              }
            }
          }
          
          const imageUrl = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
          
          if (rank && name && followers && !processedRanks.has(rank)) {
            processedRanks.add(rank);
            results.push({
              rank,
              name,
              imageUrl,
              followers
            });
          }
        }
      }
    }
    
    console.log(`Extracted ${results.length} influencers from images`);
    
    // If we didn't find enough, try table structure
    if (results.length < 10) {
      const table = document.querySelector('table');
      if (table) {
        const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
        console.log(`Also found ${rows.length} table rows`);
        
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length >= 3) {
            const rankText = cells[0] ? cells[0].textContent.trim() : '';
            const rank = parseInt(rankText);
            
            if (!isNaN(rank) && rank >= 1 && rank <= 1000 && !processedRanks.has(rank)) {
              let imageUrl = null;
              const img = row.querySelector('img') || (cells[1] ? cells[1].querySelector('img') : null);
              if (img) {
                imageUrl = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
              }
              
              let name = null;
              const nameCell = cells[2] || cells[1];
              if (nameCell) {
                const link = nameCell.querySelector('a');
                name = link ? link.textContent.trim() : nameCell.textContent.trim().replace(/^\d+\s*/, '');
              }
              
              let followers = null;
              const followersCell = cells[3] || cells[2];
              if (followersCell) {
                const followersText = followersCell.textContent.trim();
                const match = followersText.match(/([\d.]+[KM]?)/);
                if (match) followers = match[1];
              }
              
              if (rank && name && followers) {
                processedRanks.add(rank);
                results.push({ rank, name, imageUrl, followers });
              }
            }
          }
        });
      }
    }
    
    // Sort by rank
    results.sort((a, b) => a.rank - b.rank);
    
    return results;
  });
  
  console.log(`  ✓ Found ${influencers.length} influencers on page ${pageNum}`);
  
  return influencers;
}

// Main parsing function
async function parseInstagramInfluencers() {
  console.log('📱 Starting Instagram Influencers Parser...\n');
  
  await ensureDirectory(OUTPUT_DIR);
  
  // Load existing data if it exists
  let existingData = [];
  if (await fs.pathExists(DATA_FILE)) {
    try {
      delete require.cache[require.resolve(DATA_FILE)];
      existingData = require(DATA_FILE);
      console.log(`📂 Loaded ${existingData.length} existing influencers\n`);
    } catch (error) {
      console.warn('⚠️  Could not load existing data, starting fresh');
    }
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Capture console messages
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Found') || text.includes('images') || text.includes('Extracted')) {
        console.log(`  [Browser] ${text}`);
      }
    });
    
    let allInfluencers = [];
    
    // Parse all pages
    for (let pageNum = 1; pageNum <= TOTAL_PAGES; pageNum++) {
      const pageInfluencers = await parsePage(page, pageNum);
      allInfluencers = allInfluencers.concat(pageInfluencers);
      
      // Wait between pages to avoid rate limiting
      if (pageNum < TOTAL_PAGES) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`\n📊 Total influencers found: ${allInfluencers.length}\n`);
    
    // Process each influencer
    let processed = 0;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < allInfluencers.length; i++) {
      const influencer = allInfluencers[i];
      const influencerId = `influencer-${influencer.rank}`;
      
      console.log(`[${i + 1}/${allInfluencers.length}] Processing: ${influencer.name} (Rank #${influencer.rank})`);
      
      // Check if already exists
      const existing = existingData.find(e => e.rank === influencer.rank);
      if (existing && existing.imagePath && await fs.pathExists(path.join(__dirname, existing.imagePath))) {
        console.log(`  ✓ Already processed, skipping...`);
        skipCount++;
        continue;
      }
      
      // Download image
      let imagePath = null;
      if (influencer.imageUrl) {
        console.log(`  🔍 Downloading image from: ${influencer.imageUrl.substring(0, 80)}...`);
        imagePath = await downloadImage(influencer.imageUrl, influencerId);
        
        if (imagePath) {
          console.log(`  ✓ Saved to: ${imagePath}`);
        } else {
          console.log(`  ⚠ Could not download image`);
          failCount++;
        }
      } else {
        console.log(`  ⚠ No image URL found`);
        failCount++;
      }
      
      // Parse followers
      const followers = parseFollowers(influencer.followers);
      
      // Create influencer object
      const influencerData = {
        id: influencerId,
        name: influencer.name,
        rank: influencer.rank,
        followers: followers,
        followersDisplay: influencer.followers,
        imagePath: imagePath
      };
      
      // Update or add to existing data
      if (existing) {
        const index = existingData.findIndex(e => e.rank === influencer.rank);
        existingData[index] = influencerData;
      } else {
        existingData.push(influencerData);
      }
      
      if (imagePath) {
        successCount++;
        console.log(`  ✓ Successfully processed ${influencer.name}`);
      }
      
      processed++;
      
      // Save progress every 20 influencers
      if (processed % 20 === 0) {
        const jsContent = `module.exports = ${JSON.stringify(existingData.sort((a, b) => a.rank - b.rank), null, 2)};`;
        await fs.writeFile(DATA_FILE, jsContent, 'utf-8');
        console.log(`\n💾 Progress saved: ${processed} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
      }
      
      // Rate limiting: wait between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final save
    const jsContent = `module.exports = ${JSON.stringify(existingData.sort((a, b) => a.rank - b.rank), null, 2)};`;
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
parseInstagramInfluencers().catch(console.error);
