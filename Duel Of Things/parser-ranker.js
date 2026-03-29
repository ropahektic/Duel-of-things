const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://www.ranker.com/crowdranked-list/the-greatest-film-actors-and-actresses-of-all-time';
const OUTPUT_DIR = path.join(__dirname, 'actors');
const DATA_FILE = path.join(__dirname, 'actors-data.js');

// Create output directory if it doesn't exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image and save
async function downloadImage(imageUrl, actorId) {
  try {
    const absoluteUrl = imageUrl.startsWith('http') ? imageUrl : `https://www.ranker.com${imageUrl}`;
    const imagePath = path.join(OUTPUT_DIR, `${actorId}.jpg`);
    
    // Skip if already exists
    if (await fs.pathExists(imagePath)) {
      return imagePath;
    }
    
    console.log(`  Downloading from: ${absoluteUrl}`);
    
    const response = await axios({
      url: absoluteUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.ranker.com/'
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
      writer.on('error', (err) => {
        console.error(`  ✗ Write error for ${actorId}:`, err.message);
        reject(err);
      });
      response.data.on('error', (err) => {
        console.error(`  ✗ Stream error for ${actorId}:`, err.message);
        reject(err);
      });
    });
  } catch (error) {
    if (error.response) {
      console.error(`  ✗ HTTP ${error.response.status} for ${actorId}: ${error.response.statusText}`);
    } else {
      console.error(`  ✗ Failed to download image for actor ${actorId}:`, error.message);
    }
    return null;
  }
}

// Parse Ranker actors list using Puppeteer
async function parseRankerActors(maxActors = 800) {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for initial content to load
    console.log('Waiting for initial content to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Debug: Check page structure
    const pageInfo = await page.evaluate(() => {
      const selectors = [
        '[class*="listItem"]',
        '[data-rank]',
        '[class*="ListItem"]',
        'li[class*="item"]',
        'div[class*="item"]',
        'article',
        '[class*="rank"]'
      ];
      
      const results = {};
      selectors.forEach(sel => {
        const elements = document.querySelectorAll(sel);
        results[sel] = elements.length;
        if (elements.length > 0 && elements.length < 20) {
          // Get sample structure
          const firstEl = elements[0];
          results[`${sel}_sample`] = {
            tagName: firstEl.tagName,
            className: firstEl.className,
            text: firstEl.textContent.substring(0, 100),
            hasImg: !!firstEl.querySelector('img'),
            hasLink: !!firstEl.querySelector('a')
          };
        }
      });
      
      return results;
    });
    
    console.log('Page structure:', JSON.stringify(pageInfo, null, 2));

    const allActors = [];
    let previousCount = 0;
    let noNewContentCount = 0;
    const maxNoNewContent = 10;

    console.log('Scrolling to load all actors...');
    
    // Find the scrollable container (the list itself, not the whole page)
    const scrollContainer = await page.evaluate(() => {
      // Try to find the main list container
      const containers = [
        '[class*="list"]',
        '[class*="List"]',
        '[class*="ranking"]',
        '[class*="Ranking"]',
        'main',
        '[role="main"]',
        'article'
      ];
      
      for (const sel of containers) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          // Check if this element is scrollable or contains the list
          const hasScroll = el.scrollHeight > el.clientHeight;
          const hasListItems = el.querySelectorAll('[class*="listItem"], [data-rank], [class*="ListItem"]').length > 0;
          if (hasListItems || hasScroll) {
            return {
              selector: sel,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
              scrollTop: el.scrollTop
            };
          }
        }
      }
      return null;
    });
    
    console.log('Scroll container info:', scrollContainer);

    // Scroll and load content until we have enough actors
    while (allActors.length < maxActors && noNewContentCount < maxNoNewContent) {
      const beforeScroll = await page.evaluate(() => {
        const listItems = document.querySelectorAll('[class*="listItem"], [data-rank], [class*="ListItem"], article, [class*="item"]');
        const lastItem = listItems[listItems.length - 1];
        
        return {
          actorCount: listItems.length,
          scrollY: window.scrollY,
          bodyHeight: document.body.scrollHeight,
          lastItemBottom: lastItem ? lastItem.getBoundingClientRect().bottom + window.scrollY : 0,
          viewportBottom: window.scrollY + window.innerHeight
        };
      });
      
      console.log(`Before scroll: ${beforeScroll.actorCount} items, lastItemBottom: ${beforeScroll.lastItemBottom}, viewportBottom: ${beforeScroll.viewportBottom}`);

      // Scroll to just past the last item (not all the way to bottom)
      await page.evaluate((lastItemBottom) => {
        // Scroll to just past the last item, or scroll down a bit
        const targetScroll = lastItemBottom > 0 ? lastItemBottom - 200 : window.scrollY + 500;
        window.scrollTo(0, targetScroll);
      }, beforeScroll.lastItemBottom);
      
      // Wait for new content
      const previousActorCount = beforeScroll.actorCount;
      
      try {
        await page.waitForFunction(
          (prevCount) => {
            const currentCount = document.querySelectorAll('[class*="listItem"], [data-rank], [class*="ListItem"], article, [class*="item"]').length;
            return currentCount > prevCount;
          },
          { timeout: 5000, polling: 500 },
          previousActorCount
        );
        console.log('New content detected!');
        noNewContentCount = 0;
      } catch (e) {
        console.log('No new content appeared after scroll');
        noNewContentCount++;
        
        // If no new content, try scrolling a bit more to trigger loading
        if (noNewContentCount < maxNoNewContent) {
          await page.evaluate(() => {
            window.scrollBy(0, 300);
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Extract actors from the page - everything is on the ranking page itself
      const actorsOnPage = await page.evaluate(() => {
        const actorsList = [];
        const seenRanks = new Set();
        
        // Try multiple selectors to find actor items on the ranking page
        const selectors = [
          '[class*="listItem"]',
          '[data-rank]',
          '[class*="ListItem"]',
          'li[class*="item"]',
          'div[class*="item"]',
          'article',
          '[class*="rank"]'
        ];
        
        let items = [];
        for (const selector of selectors) {
          items = Array.from(document.querySelectorAll(selector));
          if (items.length > 0) {
            console.log(`Found ${items.length} items with selector: ${selector}`);
            break;
          }
        }
        
        // If no items found, try finding by structure (rank number + name + image pattern)
        if (items.length === 0) {
          // Look for elements that contain both rank numbers and images
          const allDivs = Array.from(document.querySelectorAll('div, li, article'));
          items = allDivs.filter(el => {
            const hasRank = /\d+/.test(el.textContent.substring(0, 10));
            const hasImg = !!el.querySelector('img');
            const hasName = el.textContent.trim().length > 5;
            return hasRank && hasImg && hasName;
          });
          console.log(`Found ${items.length} items by pattern matching`);
        }
        
        items.forEach((item) => {
          // Try to find rank - look for number at the start
          let rank = null;
          
          // Check data-rank attribute first
          const dataRank = item.getAttribute('data-rank');
          if (dataRank) {
            rank = parseInt(dataRank);
          }
          
          // Check for rank in text (e.g., "#1", "1.", "1)", etc.)
          if (!rank) {
            const rankMatch = item.textContent.match(/^[^\w]*(\d+)[\.\)]/);
            if (rankMatch) {
              rank = parseInt(rankMatch[1]);
            }
          }
          
          // Check for rank number in class or id
          if (!rank) {
            const classRank = item.className.match(/(?:^|\s)rank[_-]?(\d+)/i);
            if (classRank) {
              rank = parseInt(classRank[1]);
            }
          }
          
          // Use position as fallback rank (but only if we can't find explicit rank)
          if (!rank) {
            rank = actorsList.length + 1;
          }
          
          // Skip if we already have this rank
          if (seenRanks.has(rank)) return;
          seenRanks.add(rank);
          
          // Find name - look for links, headings, or prominent text
          let name = '';
          const nameSelectors = [
            'a[href*="/name/"]',
            'a[href*="/list/"]',
            'h2', 'h3', 'h1', 'h4',
            '[class*="name"]',
            '[class*="title"]',
            '[class*="Name"]',
            'strong',
            'b',
            'span[class*="name"]'
          ];
          
          for (const nameSel of nameSelectors) {
            const nameEl = item.querySelector(nameSel);
            if (nameEl) {
              name = nameEl.textContent.trim();
              // Clean up name - remove rank numbers
              name = name.replace(/^#?\d+[\.\)]\s*/, '').trim();
              if (name && name.length > 1 && name.length < 200) break;
            }
          }
          
          // Fallback: get first meaningful text line
          if (!name || name.length < 2) {
            const text = item.textContent.trim();
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
            for (const line of lines) {
              // Skip rank numbers and common UI text
              if (!line.match(/^#?\d+[\.\)]/) && 
                  !line.toLowerCase().includes('vote') && 
                  !line.toLowerCase().includes('rank') &&
                  !line.toLowerCase().includes('up') &&
                  !line.toLowerCase().includes('down') &&
                  line.length > 2 && line.length < 200) {
                name = line;
                break;
              }
            }
          }
          
          // Clean up name
          name = name.replace(/\s+/g, ' ').trim();
          name = name.split('\n')[0].trim();
          name = name.split('\t')[0].trim();
          
          // Filter out invalid names
          if (!name || name.length < 2 || name.length > 200) return;
          const lowerName = name.toLowerCase();
          if (lowerName.includes('vote') || lowerName.includes('rank') || 
              lowerName.includes('up') || lowerName.includes('down') ||
              lowerName.match(/^\d+$/)) return;
          
          // Find image - should be in the same item
          const img = item.querySelector('img');
          if (!img) return;
          
          let imageUrl = img.getAttribute('src') || 
                        img.getAttribute('data-src') || 
                        img.getAttribute('data-lazy-src') ||
                        img.getAttribute('data-original') ||
                        img.getAttribute('data-img') ||
                        img.src;
          
          if (!imageUrl || imageUrl.includes('data:image')) return;
          
          // Clean up image URL
          if (imageUrl.startsWith('//')) {
            imageUrl = 'https:' + imageUrl;
          } else if (imageUrl.startsWith('/')) {
            imageUrl = 'https://www.ranker.com' + imageUrl;
          }
          
          // Skip placeholder images
          if (imageUrl.includes('placeholder') || imageUrl.includes('blank')) return;
          
          // Generate actor ID from name (slug-like)
          const actorId = name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 50);
          
          actorsList.push({
            id: actorId,
            name: name,
            rank: rank,
            imageUrl: imageUrl
          });
        });
        
        // Sort by rank to ensure correct order
        actorsList.sort((a, b) => a.rank - b.rank);
        
        return actorsList;
      });

      // Add new actors (avoid duplicates by rank)
      for (const actor of actorsOnPage) {
        if (!allActors.find(a => a.rank === actor.rank)) {
          allActors.push(actor);
        }
      }

      // Check if we got new content
      if (allActors.length === previousCount) {
        noNewContentCount++;
        console.log(`No new content (attempt ${noNewContentCount}/${maxNoNewContent})...`);
        
        if (noNewContentCount < maxNoNewContent) {
          // Try scrolling more aggressively
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      } else {
        noNewContentCount = 0;
        previousCount = allActors.length;
        console.log(`Loaded ${allActors.length} actors so far...`);
      }
      
      // Save progress periodically
      if (allActors.length % 50 === 0 && allActors.length > 0) {
        await saveProgress(allActors.map(a => ({ ...a, imagePath: null })));
        console.log(`  💾 Progress saved: ${allActors.length} actors found so far`);
      }
    }

    console.log(`\nFound ${allActors.length} actors. Starting image downloads...`);

    // Download images for all found actors
    for (let i = 0; i < allActors.length && i < maxActors; i++) {
      const actor = allActors[i];
      console.log(`Processing ${i + 1}/${Math.min(allActors.length, maxActors)}: ${actor.name} (Rank #${actor.rank})`);
      
      const imagePath = await downloadImage(actor.imageUrl, actor.id);
      
      if (imagePath) {
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        actor.imagePath = relativeImagePath;
      } else {
        // Keep actor even without image
        actor.imagePath = null;
      }

      // Save progress every 10 images
      if ((i + 1) % 10 === 0) {
        await saveProgress(allActors.slice(0, i + 1));
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Final save
    const finalActors = allActors.slice(0, maxActors);
    await saveProgress(finalActors);
    
    return finalActors;
  } finally {
    await browser.close();
  }
}

// Main parsing function
async function parseTopActors(maxActors = 800) {
  console.log('Starting Ranker actors parsing with Puppeteer...');
  await ensureDirectory(OUTPUT_DIR);

  const allActors = await parseRankerActors(maxActors);

  console.log(`\n✅ Parsing complete!`);
  console.log(`   Total actors: ${allActors.length}`);
  console.log(`   Data saved to: ${DATA_FILE}`);
  console.log(`   Images saved to: ${OUTPUT_DIR}`);
  
  return allActors;
}

// Save progress to file
async function saveProgress(actors) {
  const jsContent = `// Actors data parsed from Ranker.com
// Generated automatically - do not edit manually
// Progress: ${actors.length} actors processed

const actorsData = ${JSON.stringify(actors, null, 2)};

module.exports = actorsData;
`;

  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

// Run the parser
if (require.main === module) {
  parseTopActors(800)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseTopActors };
