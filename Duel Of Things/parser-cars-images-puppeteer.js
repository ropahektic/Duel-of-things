const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const CARS_DATA_FILE = path.join(__dirname, 'cars-data.js');
const OUTPUT_DIR = path.join(__dirname, 'cars');
const UPDATED_DATA_FILE = path.join(__dirname, 'cars-data.js');

// Ensure directories exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image from URL
async function downloadImage(imageUrl, carId) {
  try {
    if (!imageUrl) {
      return null;
    }

    const imagePath = path.join(OUTPUT_DIR, `${carId}.jpg`);
    if (await fs.pathExists(imagePath)) {
      return imagePath; // Skip if already exists
    }

    console.log(`  Downloading from: ${imageUrl.substring(0, 80)}...`);

    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://duckduckgo.com/'
      },
      timeout: 30000,
      validateStatus(status) {
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
      console.error(
        `  ✗ HTTP ${error.response.status} for ${carId}: ${error.response.statusText}`
      );
    } else {
      console.error(`  ✗ Failed to download image:`, error.message);
    }
    return null;
  }
}

// Search DuckDuckGo Images for a car
async function searchDuckDuckGoImages(page, car) {
  try {
    // Build search query: "Make Model Year" (as requested)
    const make = (car.make || '').trim();
    const model = (car.model || '').trim();
    const year = car.year ? String(car.year).trim() : '';

    // Fallback to name if make/model missing
    let baseName = '';
    if (make && model) {
      baseName = `${make} ${model}`;
    } else if (car.name) {
      baseName = car.name;
    } else {
      baseName = `${make} ${model}`.trim();
    }

    // Clean parentheses from base name
    const cleanBaseName = baseName.replace(/\s*\([^)]+\)\s*/g, '').trim();

    const searchQuery = year ? `${cleanBaseName} ${year}` : cleanBaseName;

    const encodedQuery = encodeURIComponent(searchQuery);
    const searchUrl = `https://duckduckgo.com/?q=${encodedQuery}&iax=images&ia=images`;

    console.log(`  🔍 Searching DuckDuckGo: "${searchQuery}"`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    let imageUrl = null;
    const maxWaitTime = 15000; // Max 15 seconds waiting
    const startTime = Date.now();

    while (!imageUrl && Date.now() - startTime < maxWaitTime) {
      // Wait a bit for images to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Only scroll if we haven't found images yet (don't scroll unnecessarily)
      if (!imageUrl && Date.now() - startTime > 3000) {
        await page.evaluate(() => {
          window.scrollBy(0, 200);
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Try to extract image - specifically get the FIRST result (top-left corner)
      imageUrl = await page.evaluate(() => {
        // Strategy 1: Get the FIRST image with external URL (top-left in grid)
        const externalImages = Array.from(
          document.querySelectorAll(
            'img[src*="external"], img[src*="iu/"], img[data-src*="external"], img[data-src*="iu/"]'
          )
        );

        // Sort by position (top-left first)
        const imagesWithPosition = externalImages
          .map(img => {
            const rect = img.getBoundingClientRect();
            return {
              img,
              top: rect.top,
              left: rect.left
            };
          })
          .sort((a, b) => {
            if (Math.abs(a.top - b.top) < 10) {
              return a.left - b.left; // Same row
            }
            return a.top - b.top; // Higher first
          });

        const pickFirstValid = list => {
          for (const { img } of list) {
            let src =
              img.getAttribute('src') ||
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.src;

            if (!src || src.startsWith('data:')) continue;

            // Skip logos/icons
            if (
              src.includes('logo') ||
              src.includes('icon') ||
              src.includes('favicon')
            ) {
              continue;
            }

            // Handle protocol-relative URLs
            if (src.startsWith('//')) {
              src = 'https:' + src;
            }

            // Extract from DuckDuckGo proxy
            if (src.includes('u=')) {
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

            if (src.startsWith('http://') || src.startsWith('https://')) {
              if (
                src.match(/\.(jpg|jpeg|png|gif|webp)/i) ||
                src.includes('image') ||
                src.includes('photo') ||
                src.includes('img') ||
                src.includes('unsplash') ||
                src.includes('pexels') ||
                src.includes('picsum') ||
                src.includes('bing.net') ||
                src.includes('googleusercontent')
              ) {
                return src;
              }
            }
          }
          return null;
        };

        // First try on external images sorted by position
        let found = pickFirstValid(imagesWithPosition);
        if (found) return found;

        // Fallback: any external images sorted by position
        const allExternalImages = Array.from(
          document.querySelectorAll('img[src*="external"], img[src*="iu/"]')
        );
        const sortedImages = allExternalImages
          .map(img => {
            const rect = img.getBoundingClientRect();
            return {
              img,
              top: rect.top,
              left: rect.left
            };
          })
          .sort((a, b) => {
            if (Math.abs(a.top - b.top) < 10) {
              return a.left - b.left;
            }
            return a.top - b.top;
          });

        found = pickFirstValid(sortedImages);
        if (found) return found;

        // Final fallback: any reasonably-sized non-logo image
        const allImages = Array.from(document.querySelectorAll('img'));
        for (const img of allImages) {
          let src =
            img.getAttribute('src') ||
            img.getAttribute('data-src') ||
            img.getAttribute('data-lazy-src') ||
            img.getAttribute('data-original') ||
            img.src;

          if (!src || src.startsWith('data:')) continue;

          const parent = img.parentElement;
          const parentClass = parent ? parent.className.toLowerCase() : '';

          if (
            src.includes('logo') ||
            src.includes('icon') ||
            src.includes('favicon') ||
            parentClass.includes('logo') ||
            parentClass.includes('header') ||
            parentClass.includes('nav') ||
            parentClass.includes('brand')
          ) {
            continue;
          }

          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          if (width > 0 && height > 0 && width < 50 && height < 50) {
            continue;
          }

          if (src.includes('u=')) {
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

          if (src.startsWith('http://') || src.startsWith('https://')) {
            if (
              src.match(/\.(jpg|jpeg|png|gif|webp)/i) ||
              src.includes('image') ||
              src.includes('photo') ||
              src.includes('img')
            ) {
              return src;
            }
          } else if (src.startsWith('//')) {
            const fullUrl = 'https:' + src;
            if (fullUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
              return fullUrl;
            }
          }
        }

        return null;
      });

      if (imageUrl) {
        break;
      }

      console.log(
        `  ⏳ Waiting for images to load... (${Math.round(
          (Date.now() - startTime) / 1000
        )}s)`
      );
    }

    if (!imageUrl) {
      console.log(
        `  ⚠ No image found after ${Math.round(
          (Date.now() - startTime) / 1000
        )} seconds`
      );
    }

    return imageUrl;
  } catch (error) {
    console.error(`  ✗ Error searching DuckDuckGo Images:`, error.message);
    return null;
  }
}

// Fetch images for cars using Puppeteer
async function fetchCarImages() {
  await ensureDirectory(OUTPUT_DIR);

  // Load existing cars data
  let cars = [];
  if (await fs.pathExists(CARS_DATA_FILE)) {
    try {
      delete require.cache[require.resolve(CARS_DATA_FILE)];
      cars = require(CARS_DATA_FILE);
      console.log(`Loaded ${cars.length} cars from ${CARS_DATA_FILE}`);
    } catch (error) {
      console.error('Error loading cars data:', error.message);
      return;
    }
  } else {
    console.error(`Cars data file not found: ${CARS_DATA_FILE}`);
    return;
  }

  console.log(`\nStarting image fetch for ${cars.length} cars...`);
  console.log(`Using Puppeteer + DuckDuckGo Images (no API limits!)\n`);

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    let processed = 0;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      console.log(`\n[${i + 1}/${cars.length}] Processing: ${car.name} (Rank #${car.rank})`);

      // Skip if already has image
      if (
        car.imagePath &&
        await fs.pathExists(path.join(__dirname, car.imagePath))
      ) {
        console.log(`  ✓ Already has image, skipping...`);
        skipCount++;
        continue;
      }

      const imageUrl = await searchDuckDuckGoImages(page, car);

      if (imageUrl) {
        console.log(`  ✓ Found image URL`);

        const imagePath = await downloadImage(imageUrl, car.id);

        if (imagePath) {
          const relativeImagePath = path
            .relative(__dirname, imagePath)
            .replace(/\\/g, '/');
          car.imagePath = relativeImagePath;
          successCount++;
          console.log(`  ✓ Successfully processed ${car.name}`);
        } else {
          failCount++;
          console.log(`  ⚠ Failed to download image for ${car.name}`);
        }
      } else {
        failCount++;
        console.log(`  ⚠ Could not find image for ${car.name}`);
      }

      processed++;

      // Save progress every 20 cars
      if (processed % 20 === 0) {
        const jsContent = `module.exports = ${JSON.stringify(
          cars,
          null,
          2
        )};`;
        await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf-8');
        console.log(
          `\n💾 Progress saved: ${processed} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`
        );
      }

      // Small delay between searches
      const delay = 800 + Math.random() * 400;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Final save
    const jsContent = `module.exports = ${JSON.stringify(cars, null, 2)};`;
    await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf-8');

    console.log(`\n✅ Image fetching complete!`);
    console.log(`Total cars: ${cars.length}`);
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
fetchCarImages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

