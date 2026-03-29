const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const BASE_URL = 'https://pantheon.world/explore/rankings?show=people&years=-3501,2025';
const OUTPUT_DIR = path.join(__dirname, 'people');
const DATA_FILE = path.join(__dirname, 'people-data.js');

// Create output directory if it doesn't exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image and save
async function downloadImage(imageUrl, personId) {
  try {
    const absoluteUrl = imageUrl.startsWith('http') ? imageUrl : `https://static.pantheon.world/profile/people/${personId}.jpg`;
    const imagePath = path.join(OUTPUT_DIR, `${personId}.jpg`);
    
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
        'Referer': 'https://pantheon.world/'
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
        console.error(`  ✗ Write error for ${personId}:`, err.message);
        reject(err);
      });
      response.data.on('error', (err) => {
        console.error(`  ✗ Stream error for ${personId}:`, err.message);
        reject(err);
      });
    });
  } catch (error) {
    if (error.response) {
      console.error(`  ✗ HTTP ${error.response.status} for ${personId}: ${error.response.statusText}`);
    } else {
      console.error(`  ✗ Failed to download image for person ${personId}:`, error.message);
    }
    return null;
  }
}

// Parse a single page using Puppeteer
async function parsePantheonPage(page, pageNumber, skipNavigation = false) {
  try {
    // Only navigate if we're not already on the right page
    if (!skipNavigation) {
      // Build URL with page parameter
      const url = pageNumber === 1 
        ? BASE_URL 
        : `${BASE_URL}&page=${pageNumber}`;
      
      console.log(`Navigating to page ${pageNumber}...`);
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log(`Parsing page ${pageNumber} (already navigated)...`);
    }
    
    // Wait for "loading data" animation to finish
    try {
      await page.waitForFunction(
        () => {
          const loadingElements = document.querySelectorAll('[class*="loading"], [class*="Loading"], [id*="loading"]');
          const hasLoadingText = document.body.innerText.includes('Loading data') || 
                                 document.body.innerText.includes('loading data');
          return loadingElements.length === 0 && !hasLoadingText;
        },
        { timeout: 30000 }
      );
      console.log('Loading animation finished');
    } catch (e) {
      console.log('Waiting for loading animation timed out, continuing...');
    }
    
    // Wait a bit more for content to fully render
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Extract people from the page - look for images with numeric IDs and names next to them
    const result = await page.evaluate((pageNum) => {
      const peopleList = [];
      const seenIds = new Set();
      const debugInfo = [];
      
      // Find all images that match the pattern (full URL or relative)
      const allImages = Array.from(document.querySelectorAll('img')).filter(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.src || '';
        return src.includes('/profile/people/') || src.includes('static.pantheon.world/profile/people/');
      });
      
      debugInfo.push(`Found ${allImages.length} profile images`);
      
      for (const img of allImages) {
        const imgSrc = img.getAttribute('src') || img.getAttribute('data-src') || img.src || '';
        
        // Extract numeric ID from image URL (handles both full URL and relative)
        const idMatch = imgSrc.match(/\/profile\/people\/(\d+)\./);
        if (!idMatch) continue;
        
        const personId = idMatch[1];
        
        // Skip duplicates
        if (seenIds.has(personId)) continue;
        seenIds.add(personId);
        
        // Find the name - structure is: Column 1 = #, Column 2 = picture, Column 3 = name
        let name = '';
        
        // Find the table row (TR) that contains this image
        const row = img.closest('tr');
        if (!row) continue;
        
        // Get all cells in the row
        const cells = Array.from(row.querySelectorAll('td'));
        
        // Name is in the 3rd column (index 2)
        if (cells.length >= 3) {
          const nameCell = cells[2];
          
          // Try to get name from link first
          const link = nameCell.querySelector('a[href*="/profile/person/"]');
          if (link) {
            name = link.textContent.trim();
          } else {
            // Otherwise get text from the cell
            name = nameCell.textContent.trim();
          }
          
          // Clean up name - take first line only
          name = name.split('\n')[0].trim();
          name = name.split('\t')[0].trim();
        }
        
        // Clean up name
        name = name.replace(/\s+/g, ' ').trim();
        name = name.split('\n')[0].trim();
        name = name.split('\t')[0].trim();
        
        // Filter out invalid names
        if (!name || name.length < 2 || name.length > 200) {
          debugInfo.push(`Skipping ${personId}: invalid name "${name}"`);
          continue;
        }
        const lowerName = name.toLowerCase();
        if (lowerName.includes('new!') || lowerName.includes('places') || 
            lowerName.includes('countries') || lowerName.includes('occupations') ||
            lowerName.includes('eras') || lowerName.includes('deaths') ||
            lowerName === 'profiles' || lowerName === 'people' ||
            lowerName.includes('visualizations') || lowerName.includes('rankings') ||
            lowerName.includes('loading')) {
          debugInfo.push(`Skipping ${personId}: filtered name "${name}"`);
          continue;
        }
        
        // Image URL pattern (use full URL)
        const imageUrl = imgSrc.startsWith('http') ? imgSrc : `https://static.pantheon.world/profile/people/${personId}.jpg`;
        
        // Calculate rank based on order found
        const rank = peopleList.length + 1;
        
        debugInfo.push(`Adding person: ${personId} - ${name} (rank ${rank})`);
        
        peopleList.push({
          id: personId,
          name: name,
          rank: rank,
          imageUrl: imageUrl
        });
      }
      
      debugInfo.push(`Total people found: ${peopleList.length}`);
      return { peopleList, debugInfo };
    }, pageNumber);
    
    // Log debug info
    if (result.debugInfo && result.debugInfo.length > 0) {
      console.log('Debug info:', result.debugInfo.join('\n'));
    }
    
    const peopleOnPage = result.peopleList || [];

    console.log(`Found ${peopleOnPage.length} people on page ${pageNumber}`);
    return peopleOnPage;
  } catch (error) {
    console.error(`Error parsing page ${pageNumber}:`, error.message);
    return [];
  }
}

// Navigate to next page
async function goToNextPage(page, currentPageNumber) {
  try {
    // Try clicking pagination button/link first
    const clicked = await page.evaluate((currentPage) => {
      // Look for next page button or link
      const nextButtons = Array.from(document.querySelectorAll('a, button')).filter(el => {
        const text = el.textContent.trim().toLowerCase();
        const href = el.getAttribute('href') || '';
        return text.includes('next') || text === '>' || 
               href.includes('page=') && parseInt(href.match(/page=(\d+)/)?.[1] || '0') === currentPage + 1;
      });
      
      if (nextButtons.length > 0 && !nextButtons[0].disabled) {
        nextButtons[0].click();
        return true;
      }
      
      // Try finding page number links
      const pageLinks = Array.from(document.querySelectorAll('a[href*="page"], button')).filter(el => {
        const text = el.textContent.trim();
        return text === String(currentPage + 1);
      });
      
      if (pageLinks.length > 0 && !pageLinks[0].disabled) {
        pageLinks[0].click();
        return true;
      }
      
      return false;
    }, currentPageNumber);
    
    if (clicked) {
      console.log(`Clicked pagination button for page ${currentPageNumber + 1}`);
      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for loading animation to finish
      try {
        await page.waitForFunction(
          () => {
            const loadingElements = document.querySelectorAll('[class*="loading"], [class*="Loading"], [id*="loading"]');
            const hasLoadingText = document.body.innerText.includes('Loading data') || 
                                   document.body.innerText.includes('loading data');
            return loadingElements.length === 0 && !hasLoadingText;
          },
          { timeout: 30000 }
        );
      } catch (e) {
        console.log('Waiting for loading animation timed out, continuing...');
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      return true;
    }
    
    // Fallback: Try URL-based pagination
    const nextPageNum = currentPageNumber + 1;
    const nextUrl = `${BASE_URL}&page=${nextPageNum}`;
    
    console.log(`Trying URL navigation to page ${nextPageNum}...`);
    await page.goto(nextUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for loading animation
    try {
      await page.waitForFunction(
        () => {
          const loadingElements = document.querySelectorAll('[class*="loading"], [class*="Loading"], [id*="loading"]');
          const hasLoadingText = document.body.innerText.includes('Loading data') || 
                                 document.body.innerText.includes('loading data');
          return loadingElements.length === 0 && !hasLoadingText;
        },
        { timeout: 30000 }
      );
    } catch (e) {
      console.log('Waiting for loading animation timed out, continuing...');
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    console.error('Error going to next page:', error.message);
    return false;
  }
}

// Main parsing function
async function parseTopPeople(maxPeople = 1000) {
  console.log('Starting Pantheon people parsing with Puppeteer...');
  await ensureDirectory(OUTPUT_DIR);
  
  // Check if data file already exists and warn
  if (await fs.pathExists(DATA_FILE)) {
    try {
      const existingData = require(DATA_FILE);
      if (Array.isArray(existingData) && existingData.length > 0) {
        console.log(`⚠️  Warning: Existing data file found with ${existingData.length} people`);
        console.log('   Parser will preserve existing data if parsing fails or finds no results');
        console.log('   To force re-parse, delete people-data.js first\n');
      }
    } catch (e) {
      // File exists but can't be read, that's okay
    }
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    const allPeople = [];
    let pageNumber = 1;
    const peoplePerPage = 50; // Estimate
    const maxPages = Math.ceil(maxPeople / peoplePerPage);
    
    while (allPeople.length < maxPeople && pageNumber <= maxPages) {
      // Parse current page (navigate only on first page)
      const peopleOnPage = await parsePantheonPage(page, pageNumber, pageNumber > 1);
      
      if (peopleOnPage.length === 0) {
        console.log(`No people found on page ${pageNumber}, stopping...`);
        break;
      }
      
      // Add people to list (update ranks)
      for (const person of peopleOnPage) {
        if (!allPeople.find(p => p.id === person.id)) {
          person.rank = allPeople.length + 1;
          allPeople.push(person);
          
          // Download image immediately
          console.log(`Downloading image for ${person.name} (ID: ${person.id})...`);
          const imagePath = await downloadImage(person.imageUrl, person.id);
          
          if (imagePath) {
            const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
            person.imagePath = relativeImagePath;
            console.log(`  ✓ Downloaded: ${relativeImagePath}`);
          } else {
            console.log(`  ✗ Failed to download image for ${person.name}`);
            person.imagePath = null;
          }
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`Total people collected: ${allPeople.length}/${maxPeople}`);
      
      if (allPeople.length >= maxPeople) break;
      
      // Save progress periodically
      if (allPeople.length % 50 === 0 && allPeople.length > 0) {
        await saveProgress(allPeople);
        console.log(`  💾 Progress saved: ${allPeople.length} people found so far`);
      }
      
      // Go to next page (only if not at max)
      if (allPeople.length < maxPeople) {
        pageNumber++;
        const hasNextPage = await goToNextPage(page, pageNumber - 1);
        
        if (!hasNextPage) {
          console.log('No more pages available, stopping...');
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`\nFound ${allPeople.length} people. All images downloaded.`);
    
    // Final save - only if we have data
    const finalPeople = allPeople.slice(0, maxPeople);
    if (finalPeople.length > 0) {
      await saveProgress(finalPeople);
    } else {
      console.log('⚠️  No people found! Existing data file will be preserved.');
    }
    
    return finalPeople;
  } finally {
    await browser.close();
  }
}

// Save progress to file
async function saveProgress(people) {
  // Don't overwrite existing data with empty array
  if (people.length === 0) {
    console.log('⚠️  Warning: No people to save, skipping file write to preserve existing data');
    return;
  }
  
  // Check if file exists and has data
  if (await fs.pathExists(DATA_FILE)) {
    try {
      const existingData = require(DATA_FILE);
      if (Array.isArray(existingData) && existingData.length > 0 && people.length < existingData.length) {
        console.log(`⚠️  Warning: Attempting to save ${people.length} people, but file already has ${existingData.length} people`);
        console.log('   Only overwriting if new data has more entries or user explicitly wants to replace');
        // Only overwrite if we have more or equal data
        if (people.length < existingData.length) {
          console.log('   Preserving existing data. If you want to replace, delete the file first.');
          return;
        }
      }
    } catch (e) {
      // File exists but can't be read, proceed with write
      console.log('   Existing file could not be read, proceeding with write...');
    }
  }
  
  const jsContent = `// People data parsed from Pantheon.world
// Generated automatically - do not edit manually
// Progress: ${people.length} people processed

const peopleData = ${JSON.stringify(people, null, 2)};

module.exports = peopleData;
`;

  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

// Run the parser
if (require.main === module) {
  parseTopPeople(1000)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseTopPeople };
