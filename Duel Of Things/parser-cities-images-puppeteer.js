require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const CITIES_DATA_FILE = path.join(__dirname, 'cities-data.js');
const OUTPUT_DIR = path.join(__dirname, 'cities');
const UPDATED_DATA_FILE = path.join(__dirname, 'cities-data.js');

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
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

// Search DuckDuckGo Images for a city
async function searchDuckDuckGoImages(page, cityName, country = null) {
  try {
    // Build search query: "city name country city" or "city name city"
    let searchQuery = cityName;
    if (country) {
      searchQuery = `${cityName} ${country} city`;
    } else {
      searchQuery = `${cityName} city`;
    }
    
    // Clean city name (remove parentheses content like "(FL)" or "(NY)")
    const cleanCityName = cityName.replace(/\s*\([^)]+\)\s*/g, '').trim();
    if (cleanCityName !== cityName) {
      if (country) {
        searchQuery = `${cleanCityName} ${country} city`;
      } else {
        searchQuery = `${cleanCityName} city`;
      }
    }
    
    const encodedQuery = encodeURIComponent(searchQuery);
    const searchUrl = `https://duckduckgo.com/?q=${encodedQuery}&iax=images&ia=images`;
    
    console.log(`  🔍 Searching DuckDuckGo: "${searchQuery}"`);
    
    // Use 'domcontentloaded' for faster page loads (images load async anyway)
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Keep checking until we find an image (with max timeout to avoid infinite loops)
    let imageUrl = null;
    const maxWaitTime = 15000; // Max 15 seconds waiting
    const startTime = Date.now();
    
    while (!imageUrl && (Date.now() - startTime) < maxWaitTime) {
      // Wait a bit for images to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Only scroll if we haven't found images yet (don't scroll unnecessarily)
      if (!imageUrl && (Date.now() - startTime) > 3000) {
        await page.evaluate(() => {
          window.scrollBy(0, 200);
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Debug: Check what images we're seeing
      const debugInfo = await page.evaluate(() => {
        const allImgs = Array.from(document.querySelectorAll('img'));
        const externalImgs = Array.from(document.querySelectorAll('img[src*="external"], img[src*="iu/"], img[data-src*="external"]'));
        const linkImgs = Array.from(document.querySelectorAll('a img'));
        
        const sampleImgs = [];
        allImgs.slice(0, 5).forEach((img, i) => {
          const src = img.getAttribute('src') || img.getAttribute('data-src') || 'none';
          const parent = img.parentElement;
          sampleImgs.push({
            index: i,
            src: src.substring(0, 80),
            hasSrc: !!img.getAttribute('src'),
            hasDataSrc: !!img.getAttribute('data-src'),
            parentTag: parent ? parent.tagName : 'none',
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0
          });
        });
        
        return {
          total: allImgs.length,
          external: externalImgs.length,
          inLinks: linkImgs.length,
          samples: sampleImgs
        };
      });
      
      if ((Date.now() - startTime) % 3000 < 1000) { // Log every 3 seconds
        console.log(`  Debug: ${debugInfo.total} total images, ${debugInfo.external} external, ${debugInfo.inLinks} in links`);
        if (debugInfo.samples.length > 0) {
          const first = debugInfo.samples[0];
          console.log(`  Debug: First img - src: ${first.src}..., hasSrc: ${first.hasSrc}, hasDataSrc: ${first.hasDataSrc}, parent: ${first.parentTag}`);
        }
      }
      
      // Try to extract image - specifically get the FIRST result (top-left corner)
      imageUrl = await page.evaluate(() => {
      // Strategy 1: Get the FIRST image with external URL (top-left in grid)
      // DuckDuckGo images are in a grid, we want the first one (top-left)
      const externalImages = Array.from(document.querySelectorAll('img[src*="external"], img[src*="iu/"], img[data-src*="external"], img[data-src*="iu/"]'));
      
      // Sort by position (top-left first) - get bounding rect and sort by top, then left
      const imagesWithPosition = externalImages.map(img => {
        const rect = img.getBoundingClientRect();
        return {
          img: img,
          top: rect.top,
          left: rect.left
        };
      }).sort((a, b) => {
        // Sort by top first, then left
        if (Math.abs(a.top - b.top) < 10) {
          return a.left - b.left; // Same row, sort by left
        }
        return a.top - b.top; // Sort by top
      });
      
      // Get the first image (top-left)
      for (const { img } of imagesWithPosition) {
          let src = img.getAttribute('src') || 
                   img.getAttribute('data-src') || 
                   img.getAttribute('data-lazy-src') ||
                   img.getAttribute('data-original') ||
                   img.src;
          
          if (!src || src.startsWith('data:')) continue;
          
          // Skip logos/icons
          if (src.includes('logo') || src.includes('icon') || src.includes('favicon')) continue;
          
          // Handle protocol-relative URLs (//example.com)
          if (src.startsWith('//')) {
            src = 'https:' + src;
          }
          
          // Extract from DuckDuckGo proxy - try to decode the actual image URL
          if (src.includes('u=')) {
            const urlMatch = src.match(/u=([^&]+)/);
            if (urlMatch) {
              try {
                src = decodeURIComponent(urlMatch[1]);
              } catch (e) {
                // If decode fails, try the original src
                continue;
              }
            }
          }
          
          // Accept if it's HTTP/HTTPS and looks like an image (has extension OR is from image hosting)
          if (src.startsWith('http://') || src.startsWith('https://')) {
            if (src.match(/\.(jpg|jpeg|png|gif|webp)/i) || 
                src.includes('image') || 
                src.includes('photo') ||
                src.includes('img') ||
                src.includes('unsplash') ||
                src.includes('pexels') ||
                src.includes('picsum') ||
                src.includes('bing.net') ||
                src.includes('googleusercontent')) {
              return src; // Found first image (top-left)!
            }
          }
      }
      
      // Strategy 2: Fallback - Check ALL images with external URLs, sorted by position
      const allExternalImages = Array.from(document.querySelectorAll('img[src*="external"], img[src*="iu/"]'));
      const sortedImages = allExternalImages.map(img => {
        const rect = img.getBoundingClientRect();
        return {
          img: img,
          top: rect.top,
          left: rect.left
        };
      }).sort((a, b) => {
        if (Math.abs(a.top - b.top) < 10) {
          return a.left - b.left;
        }
        return a.top - b.top;
      });
      
      for (const { img } of sortedImages) {
        let src = img.getAttribute('src') || 
                 img.getAttribute('data-src') || 
                 img.getAttribute('data-lazy-src') ||
                 img.getAttribute('data-original') ||
                 img.src;
        
        if (!src || src.startsWith('data:')) continue;
        
        // Skip logos/icons
        if (src.includes('logo') || src.includes('icon') || src.includes('favicon')) continue;
        
        // Handle protocol-relative URLs (//example.com)
        if (src.startsWith('//')) {
          src = 'https:' + src;
        }
        
        // Extract from DuckDuckGo proxy - decode the actual image URL
        if (src.includes('u=')) {
          const urlMatch = src.match(/u=([^&]+)/);
          if (urlMatch) {
            try {
              src = decodeURIComponent(urlMatch[1]);
            } catch (e) {
              continue;
            }
          }
        }
        
        // Accept HTTP/HTTPS URLs that look like images
        if (src.startsWith('http://') || src.startsWith('https://')) {
          if (src.match(/\.(jpg|jpeg|png|gif|webp)/i) || 
              src.includes('image') || 
              src.includes('photo') ||
              src.includes('img') ||
              src.includes('bing.net') ||
              src.includes('googleusercontent')) {
            return src;
          }
        }
      }
      
      // Strategy 3: Final fallback - look for ANY image that's not clearly a logo/icon
      const allImages = Array.from(document.querySelectorAll('img'));
      for (const img of allImages) {
        let src = img.getAttribute('src') || 
                 img.getAttribute('data-src') || 
                 img.getAttribute('data-lazy-src') ||
                 img.getAttribute('data-original') ||
                 img.src;
        
        if (!src || src.startsWith('data:')) continue;
        
        // Skip logos/icons by checking parent elements and URL
        const parent = img.parentElement;
        const parentClass = parent ? parent.className.toLowerCase() : '';
        const parentTag = parent ? parent.tagName.toLowerCase() : '';
        
        // Skip if it's clearly a logo/icon
        if (src.includes('logo') || 
            src.includes('icon') || 
            src.includes('favicon') ||
            parentClass.includes('logo') ||
            parentClass.includes('header') ||
            parentClass.includes('nav') ||
            parentClass.includes('brand')) {
          continue;
        }
        
        // Check dimensions - skip very small icons (but be lenient)
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 0 && height > 0 && width < 50 && height < 50) {
          continue; // Too small, definitely an icon
        }
        
        // Handle DuckDuckGo proxy - try multiple patterns
        if ((src.includes('external-content') || src.includes('external') || src.includes('iu/')) && src.includes('u=')) {
          const urlMatch = src.match(/u=([^&]+)/);
          if (urlMatch) {
            try {
              src = decodeURIComponent(urlMatch[1]);
            } catch (e) {
              try {
                src = decodeURIComponent(decodeURIComponent(urlMatch[1]));
              } catch (e2) {
                continue;
              }
            }
          }
        }
        
        // Must be HTTP/HTTPS
        if (src.startsWith('http://') || src.startsWith('https://')) {
          // Be lenient - accept if it has image extension OR looks like image URL
          if (src.match(/\.(jpg|jpeg|png|gif|webp)/i) || 
              src.includes('image') || 
              src.includes('photo') ||
              src.includes('img') ||
              src.includes('picsum') ||
              src.includes('unsplash') ||
              src.includes('pexels') ||
              src.includes('flickr')) {
            return src; // Found first valid image!
          }
        } else if (src.startsWith('//')) {
          const fullUrl = 'https:' + src;
          if (fullUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) || fullUrl.includes('image')) {
            return fullUrl;
          }
        }
      }
      
      return null;
      });
      
      // If we found an image, break out of the loop
      if (imageUrl) {
        break;
      }
      
      // If no image yet, wait a bit more and try again
      console.log(`  ⏳ Waiting for images to load... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    }
    
    if (!imageUrl) {
      console.log(`  ⚠ No image found after ${Math.round((Date.now() - startTime) / 1000)} seconds`);
    }
    
    return imageUrl;
  } catch (error) {
    console.error(`  ✗ Error searching DuckDuckGo Images:`, error.message);
    return null;
  }
}

// Fetch images for cities using Puppeteer
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

  console.log(`\nStarting image fetch for ${cities.length} cities...`);
  console.log(`Using Puppeteer + DuckDuckGo Images (no API limits!)\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Show browser so you can see progress
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let processed = 0;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      console.log(`\n[${i + 1}/${cities.length}] Processing: ${city.name}${city.country ? `, ${city.country}` : ''} (Rank #${city.rank})`);

      // Skip if already has image
      if (city.imagePath && await fs.pathExists(path.join(__dirname, city.imagePath))) {
        console.log(`  ✓ Already has image, skipping...`);
        skipCount++;
        continue;
      }

      // Search DuckDuckGo Images
      const imageUrl = await searchDuckDuckGoImages(page, city.name, city.country);

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

      // Save progress every 25 cities
      if (processed % 25 === 0) {
        const jsContent = `module.exports = ${JSON.stringify(cities, null, 2)};`;
        await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf-8');
        console.log(`\n💾 Progress saved: ${processed} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
      }

      // Small delay between searches (DuckDuckGo can handle it, but give it a moment)
      // 0.8-1.2 seconds delay - enough to not overwhelm but fast enough
      const delay = 800 + Math.random() * 400;
      await new Promise(resolve => setTimeout(resolve, delay));
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

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await browser.close();
  }
}

// Run
fetchCityImages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
