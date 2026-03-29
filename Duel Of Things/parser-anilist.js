const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://anilist.co/search/anime/top-100';
const OUTPUT_DIR = path.join(__dirname, 'anime');
const DATA_FILE = path.join(__dirname, 'anime-data.js');

// Create output directory if it doesn't exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Convert relative URL to absolute
function getAbsoluteUrl(url, baseUrl = 'https://anilist.co') {
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

// Download image and save
async function downloadImage(imageUrl, animeId) {
  try {
    // Convert to absolute URL if needed
    const absoluteUrl = getAbsoluteUrl(imageUrl);
    
    // Get image extension from URL or default to jpg
    const urlParts = absoluteUrl.split('.');
    const extension = urlParts[urlParts.length - 1].split('?')[0] || 'jpg';
    const imagePath = path.join(OUTPUT_DIR, `${animeId}.${extension}`);
    
    // Skip if already exists
    if (await fs.pathExists(imagePath)) {
      return imagePath;
    }
    
    const response = await axios({
      url: absoluteUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });

    const writer = fs.createWriteStream(imagePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(imagePath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`Failed to download image for anime ${animeId}:`, error.message);
    return null;
  }
}

// Parse AniList using Puppeteer to handle JavaScript rendering
async function parseAniListWithPuppeteer(maxAnime = 500) {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false, // Set to false to see what's happening (can change back to true later)
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Enable request interception to see what API calls are being made
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('graphql') || url.includes('api')) {
        console.log('API Request:', url.substring(0, 100));
      }
      request.continue();
    });
    
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for initial content to load
    console.log('Waiting for initial content to load...');
    
    // Wait for anime links to appear
    try {
      await page.waitForSelector('a[href*="/anime/"]', { timeout: 10000 });
      console.log('Initial anime links found!');
    } catch (e) {
      console.log('Waiting for selector timed out, continuing anyway...');
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Debug: Check what's on the page initially
    const initialCheck = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="/anime/"]');
      return {
        totalLinks: links.length,
        bodyHeight: document.body.scrollHeight,
        windowHeight: window.innerHeight,
        scrollY: window.scrollY
      };
    });
    console.log('Initial page state:', initialCheck);

    const allAnime = [];
    let previousCount = 0;
    let noNewContentCount = 0;
    const maxNoNewContent = 15; // Stop after 15 consecutive scrolls with no new content

    console.log('Scrolling to load all anime...');
    
    // Scroll and load content until we have enough anime or no more loads
    while (allAnime.length < maxAnime && noNewContentCount < maxNoNewContent) {
      // Get current state
      const beforeScroll = await page.evaluate(() => ({
        scrollY: window.scrollY,
        bodyHeight: document.body.scrollHeight,
        linkCount: document.querySelectorAll('a[href*="/anime/"]').length
      }));
      
      console.log(`Before scroll: ${beforeScroll.linkCount} links, scrollY: ${beforeScroll.scrollY}, bodyHeight: ${beforeScroll.bodyHeight}`);

      // Scroll to bottom
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Wait for new content to load - use waitForFunction to detect when new links appear
      const previousLinkCount = beforeScroll.linkCount;
      
      try {
        // Wait up to 10 seconds for new links to appear
        await page.waitForFunction(
          (prevCount) => {
            const currentCount = document.querySelectorAll('a[href*="/anime/"]').length;
            return currentCount > prevCount;
          },
          { timeout: 10000, polling: 500 },
          previousLinkCount
        );
        console.log('New content detected!');
      } catch (e) {
        console.log('No new content appeared after scroll (this is normal if we reached the end)');
      }
      
      // Additional wait for any lazy loading
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try scrolling the last visible element into view to trigger more loading
      await page.evaluate(() => {
        const animeLinks = document.querySelectorAll('a[href*="/anime/"]');
        if (animeLinks.length > 0) {
          const lastFew = Array.from(animeLinks).slice(-3);
          lastFew.forEach(link => {
            link.scrollIntoView({ behavior: 'auto', block: 'end' });
          });
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if page height changed (new content loaded)
      const afterScroll = await page.evaluate(() => ({
        scrollY: window.scrollY,
        bodyHeight: document.body.scrollHeight,
        linkCount: document.querySelectorAll('a[href*="/anime/"]').length
      }));
      
      console.log(`After scroll: ${afterScroll.linkCount} links (was ${beforeScroll.linkCount}), bodyHeight: ${afterScroll.bodyHeight} (was ${beforeScroll.bodyHeight})`);

      // Extract anime from the page
      const animeOnPage = await page.evaluate(() => {
        const animeList = [];
        const seenIds = new Set();
        
        // Find all links to anime pages
        const allLinks = document.querySelectorAll('a[href*="/anime/"]');
        
        allLinks.forEach((link) => {
          const href = link.getAttribute('href') || link.href;
          const idMatch = href.match(/\/anime\/(\d+)/);
          if (!idMatch) return;
          
          const animeId = idMatch[1];
          
          // Skip if we already processed this ID
          if (seenIds.has(animeId)) return;
          seenIds.add(animeId);
          
          // Find the parent container (usually a card or media item)
          const container = link.closest('div[class*="card"], div[class*="media"], div[class*="item"], div[class*="entry"]') || link.parentElement;
          
          // Find name - try multiple approaches
          let name = '';
          const nameSelectors = [
            '.title',
            'h3', 'h2', 'h1',
            '[class*="title"]',
            '[class*="name"]',
            'span[class*="title"]',
            'div[class*="title"]'
          ];
          
          for (const selector of nameSelectors) {
            const nameEl = container.querySelector(selector) || link.querySelector(selector);
            if (nameEl) {
              name = nameEl.textContent.trim();
              if (name && name.length > 1) break;
            }
          }
          
          // Fallback: get text from link itself
          if (!name || name.length < 2) {
            name = link.textContent.trim() || link.getAttribute('title') || link.getAttribute('alt') || '';
          }
          
          if (!name || name.length < 2) return;
          
          // Find image - look in container first, then link
          const img = container.querySelector('img') || link.querySelector('img');
          if (!img) return;
          
          let imageUrl = img.getAttribute('src') || 
                        img.getAttribute('data-src') || 
                        img.getAttribute('data-lazy-src') ||
                        img.getAttribute('data-original') ||
                        img.getAttribute('data-srcset')?.split(',')[0]?.trim().split(' ')[0];
          
          if (!imageUrl) return;
          
          // Clean up image URL (remove query params if needed, but keep anilist.co URLs)
          if (imageUrl.startsWith('//')) {
            imageUrl = 'https:' + imageUrl;
          } else if (imageUrl.startsWith('/')) {
            imageUrl = 'https://anilist.co' + imageUrl;
          }
          
          // Make sure it's a valid image URL
          if (!imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i) && !imageUrl.includes('anilist.co/img')) {
            return;
          }
          
          animeList.push({
            id: animeId,
            name: name,
            imageUrl: imageUrl
          });
        });
        
        return animeList;
      });

      // Add new anime (avoid duplicates)
      for (const anime of animeOnPage) {
        if (!allAnime.find(a => a.id === anime.id)) {
          // Calculate rank based on order found
          anime.rank = allAnime.length + 1;
          allAnime.push(anime);
        }
      }

      // Check if we got new content
      if (allAnime.length === previousCount) {
        noNewContentCount++;
        console.log(`No new content (attempt ${noNewContentCount}/${maxNoNewContent})...`);
        
        // Try scrolling more aggressively
        if (noNewContentCount < maxNoNewContent) {
          await page.evaluate(() => {
            // Scroll to very bottom
            window.scrollTo(0, document.body.scrollHeight);
            // Wait a moment
          });
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } else {
        noNewContentCount = 0; // Reset counter when we get new content
        previousCount = allAnime.length;
        console.log(`Loaded ${allAnime.length} anime so far...`);
      }
      
      // Also check if we've reached the actual bottom
      const newScrollPosition = await page.evaluate(() => window.scrollY);
      const newBodyHeight = await page.evaluate(() => document.body.scrollHeight);
      
      if (newScrollPosition + 1000 >= newBodyHeight && allAnime.length === previousCount) {
        console.log('Reached bottom of page, waiting a bit more for lazy loading...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Save progress periodically
      if (allAnime.length % 50 === 0 && allAnime.length > 0) {
        await saveProgress(allAnime.map(a => ({ ...a, imagePath: null }))); // Save without imagePath for now
        console.log(`  💾 Progress saved: ${allAnime.length} anime found so far`);
      }
    }

    console.log(`\nFound ${allAnime.length} anime. Starting image downloads...`);

    // Now download images for all found anime
    for (let i = 0; i < allAnime.length && i < maxAnime; i++) {
      const anime = allAnime[i];
      console.log(`Processing ${i + 1}/${Math.min(allAnime.length, maxAnime)}: ${anime.name} (Rank #${anime.rank})`);
      
      const imagePath = await downloadImage(anime.imageUrl, anime.id);
      
      if (imagePath) {
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        anime.imagePath = relativeImagePath;
      } else {
        // Remove anime without images
        allAnime.splice(i, 1);
        i--;
        continue;
      }

      // Save progress every 10 images
      if ((i + 1) % 10 === 0) {
        await saveProgress(allAnime.slice(0, i + 1));
      }

      // Be nice to the server
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Final save
    const finalAnime = allAnime.slice(0, maxAnime);
    await saveProgress(finalAnime);
    
    return finalAnime;
  } finally {
    await browser.close();
  }
}

// Main parsing function
async function parseTopAnime(maxAnime = 500) {
  console.log('Starting AniList anime parsing with Puppeteer...');
  await ensureDirectory(OUTPUT_DIR);

  const allAnime = await parseAniListWithPuppeteer(maxAnime);

  console.log(`\n✅ Parsing complete!`);
  console.log(`   Total anime: ${allAnime.length}`);
  console.log(`   Data saved to: ${DATA_FILE}`);
  console.log(`   Images saved to: ${OUTPUT_DIR}`);
  
  return allAnime;
}

// Save progress to file
async function saveProgress(anime) {
  const jsContent = `// Anime data parsed from AniList
// Generated automatically - do not edit manually
// Progress: ${anime.length} anime processed

const animeData = ${JSON.stringify(anime, null, 2)};

module.exports = animeData;
`;

  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

// Run the parser
if (require.main === module) {
  parseTopAnime(500)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseTopAnime };
