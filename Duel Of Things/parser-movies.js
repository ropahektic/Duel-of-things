const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://www.boxofficemojo.com/chart/ww_top_lifetime_gross/';
const OUTPUT_DIR = path.join(__dirname, 'movies');
const DATA_FILE = path.join(__dirname, 'movies-data.js');

// Ensure directories exist
async function ensureDirectory(dir) {
  await fs.ensureDir(dir);
}

// Download image from URL
async function downloadImage(imageUrl, movieId) {
  try {
    if (!imageUrl || imageUrl === 'N/A') {
      return null;
    }

    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 30000
    });

    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const filename = `${movieId}${ext}`;
    const filePath = path.join(OUTPUT_DIR, filename);

    await fs.writeFile(filePath, response.data);
    return filePath;
  } catch (error) {
    console.error(`  ✗ Failed to download image from ${imageUrl}:`, error.message);
    return null;
  }
}

// Extract movie ID from URL
function extractMovieId(movieUrl) {
  const match = movieUrl.match(/\/title\/([^\/]+)/);
  return match ? match[1] : null;
}

// Convert Amazon Media thumbnail URL to larger version
function getLargerAmazonImageUrl(thumbnailUrl) {
  if (!thumbnailUrl || !thumbnailUrl.includes('m.media-amazon.com')) {
    return thumbnailUrl;
  }
  
  // Amazon Media URLs have size parameters like _V1_SY139_CR1,0,92,139_
  // The pattern is: base_image_id@._V1_SY[height]_CR[crop]_.[ext]
  // We can get a larger version by:
  // 1. Removing the size parameters entirely (gets original size)
  // 2. Or replacing with a larger size parameter
  
  try {
    // Extract the base image ID (everything before @)
    const atIndex = thumbnailUrl.indexOf('@');
    if (atIndex === -1) {
      // No @ found, might already be a base URL
      return thumbnailUrl;
    }
    
    // Get the base part (before @)
    const basePart = thumbnailUrl.substring(0, atIndex);
    
    // Find the file extension
    const extMatch = thumbnailUrl.match(/\.(jpg|jpeg|png|webp)$/i);
    const extension = extMatch ? extMatch[0] : '.jpg';
    
    // Try to get original size by removing size parameters
    // Format: base_image_id@._V1_.ext (no size parameters = original size)
    const largerUrl = basePart + '@._V1_.' + extension.substring(1);
    
    return largerUrl;
  } catch (error) {
    // If conversion fails, return original URL
    return thumbnailUrl;
  }
}

// Get movie image from profile page
async function getMovieImage(page, movieUrl) {
  try {
    await page.goto(movieUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for images to load
    await page.waitForSelector('img', { timeout: 10000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try multiple strategies to find the movie poster image
    const imageUrl = await page.evaluate(() => {
      // Strategy 1: Look for images in the main content area, before the title
      // The poster is typically in a container before the movie title
      const mainContent = document.querySelector('main, [role="main"], .a-container, #main');
      if (mainContent) {
        // Get all images in main content
        const mainImages = Array.from(mainContent.querySelectorAll('img'));
        
        // Look for Amazon Media images first - check for larger versions in data attributes
        for (const img of mainImages) {
          // Check multiple sources: src, data-src, data-lazy-src, data-full-src, srcset
          const src = img.src || 
                     img.getAttribute('data-src') || 
                     img.getAttribute('data-lazy-src') || 
                     img.getAttribute('data-full-src') ||
                     img.getAttribute('data-original') ||
                     '';
          
          // Also check srcset for larger images
          const srcset = img.getAttribute('srcset') || '';
          let bestSrc = src;
          
          if (srcset && srcset.includes('m.media-amazon.com')) {
            // Extract the largest image from srcset
            const srcsetParts = srcset.split(',').map(s => s.trim());
            let largestUrl = '';
            let largestSize = 0;
            
            for (const part of srcsetParts) {
              const match = part.match(/^(.+?)\s+(\d+)w$/);
              if (match) {
                const url = match[1];
                const size = parseInt(match[2]);
                if (size > largestSize && url.includes('m.media-amazon.com')) {
                  largestSize = size;
                  largestUrl = url;
                }
              }
            }
            
            if (largestUrl) {
              bestSrc = largestUrl;
            }
          }
          
          if (bestSrc.includes('m.media-amazon.com')) {
            // Accept any Amazon Media image that's not a logo/icon
            if (!bestSrc.includes('logo') && 
                !bestSrc.includes('icon') &&
                !bestSrc.includes('placeholder') &&
                !bestSrc.includes('spinner') &&
                !bestSrc.includes('avatar')) {
              return bestSrc;
            }
          }
        }
      }
      
      // Strategy 2: Find images by their position relative to the title
      // The poster is usually before the h1 title element
      const titleElement = document.querySelector('h1, [class*="title"], h2');
      if (titleElement) {
        // Get all images that appear before the title in DOM order
        let currentElement = titleElement;
        const imagesBeforeTitle = [];
        
        while (currentElement && currentElement.previousElementSibling) {
          currentElement = currentElement.previousElementSibling;
          const imgs = currentElement.querySelectorAll('img');
          imgs.forEach(img => imagesBeforeTitle.push(img));
        }
        
        // Also check parent containers
        let parent = titleElement.parentElement;
        while (parent) {
          const imgs = parent.querySelectorAll('img');
          imgs.forEach(img => {
            if (!imagesBeforeTitle.includes(img)) {
              imagesBeforeTitle.push(img);
            }
          });
          parent = parent.parentElement;
        }
        
        // Look for Amazon Media images before title - accept any size
        for (const img of imagesBeforeTitle) {
          const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
          if (src.includes('m.media-amazon.com')) {
            // Accept any Amazon Media image that's not a logo/icon
            if (!src.includes('logo') && 
                !src.includes('icon') &&
                !src.includes('placeholder') &&
                !src.includes('spinner')) {
              return src;
            }
          }
        }
      }
      
      // Strategy 3: Get all images and find Amazon Media images, prioritizing by DOM order
      const allImages = Array.from(document.querySelectorAll('img'));
      const amazonImages = [];
      
      for (let i = 0; i < allImages.length; i++) {
        const img = allImages[i];
        
        // Check multiple sources for the image URL
        let src = img.src || 
                 img.getAttribute('data-src') || 
                 img.getAttribute('data-lazy-src') || 
                 img.getAttribute('data-full-src') ||
                 img.getAttribute('data-original') ||
                 '';
        
        // Check srcset for larger versions
        const srcset = img.getAttribute('srcset') || '';
        if (srcset && srcset.includes('m.media-amazon.com')) {
          const srcsetParts = srcset.split(',').map(s => s.trim());
          let largestUrl = '';
          let largestSize = 0;
          
          for (const part of srcsetParts) {
            const match = part.match(/^(.+?)\s+(\d+)w$/);
            if (match) {
              const url = match[1];
              const size = parseInt(match[2]);
              if (size > largestSize && url.includes('m.media-amazon.com')) {
                largestSize = size;
                largestUrl = url;
              }
            }
          }
          
          if (largestUrl) {
            src = largestUrl;
          }
        }
        
        if (src.includes('m.media-amazon.com')) {
          // Accept any Amazon Media image that's not a logo/icon (thumbnails can be small)
          if (!src.includes('logo') && 
              !src.includes('icon') &&
              !src.includes('placeholder') &&
              !src.includes('spinner') &&
              !src.includes('avatar')) {
            const rect = img.getBoundingClientRect();
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            amazonImages.push({
              src,
              width,
              height,
              top: rect.top,
              area: width * height,
              domIndex: i // Position in DOM (earlier = better)
            });
          }
        }
      }
      
      if (amazonImages.length > 0) {
        // Sort by: 1) DOM order (earlier in DOM = better), 2) Top position, 3) Size
        amazonImages.sort((a, b) => {
          // First prioritize by DOM order (earlier = better)
          if (Math.abs(a.domIndex - b.domIndex) > 10) {
            return a.domIndex - b.domIndex;
          }
          // If similar DOM position, prefer higher on screen
          if (Math.abs(a.top - b.top) > 100) {
            return a.top - b.top;
          }
          // If similar position, prefer larger
          return b.area - a.area;
        });
        return amazonImages[0].src;
      }
      
      // Strategy 4: Fallback - any Amazon image (no size restriction)
      for (const img of allImages) {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src.includes('m.media-amazon.com') || src.includes('images-na.ssl-images-amazon.com')) {
          // Accept any Amazon image that's not a logo/icon
          if (!src.includes('logo') && 
              !src.includes('icon') &&
              !src.includes('placeholder') &&
              !src.includes('spinner')) {
            return src;
          }
        }
      }
      
      return null;
    });
    
    // Convert thumbnail URL to larger version if found
    if (imageUrl) {
      return getLargerAmazonImageUrl(imageUrl);
    }
    
    return null;
  } catch (error) {
    console.error(`  ✗ Error fetching image from ${movieUrl}:`, error.message);
    return null;
  }
}

// Parse movies from a page
async function parseMoviesPage(page, pageNumber) {
  const offset = (pageNumber - 1) * 200;
  const url = pageNumber === 1 ? BASE_URL : `${BASE_URL}?offset=${offset}`;
  
  console.log(`Fetching page ${pageNumber} (${url})...`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the table to load
    await page.waitForSelector('table.a-bordered', { timeout: 10000 });
    
    // Extract movie data from the table
    const movies = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table.a-bordered tbody tr'));
      const movieData = [];
      
      rows.forEach((row, index) => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          
          // Rank is in the first cell
          const rankText = cells[0].textContent.trim();
          const rank = parseInt(rankText);
          
          // Title link is in the second cell
          const titleLink = cells[1].querySelector('a');
          if (!titleLink) return;
          
          const title = titleLink.textContent.trim();
          const movieUrl = titleLink.href;
          
          // Year is in the last cell
          const yearText = cells[cells.length - 1].textContent.trim();
          const year = parseInt(yearText);
          
          if (rank && title && movieUrl && year) {
            movieData.push({
              rank,
              title,
              year,
              movieUrl: movieUrl.startsWith('http') ? movieUrl : `https://www.boxofficemojo.com${movieUrl}`
            });
          }
        } catch (error) {
          console.error(`Error parsing row ${index}:`, error);
        }
      });
      
      return movieData;
    });
    
    console.log(`  Found ${movies.length} movies on page ${pageNumber}`);
    return movies;
  } catch (error) {
    console.error(`Error parsing page ${pageNumber}:`, error.message);
    return [];
  }
}

// Main parsing function
async function parseTopMovies(maxMovies = 1000) {
  console.log('Starting Box Office Mojo movies parsing with Puppeteer...');
  await ensureDirectory(OUTPUT_DIR);
  
  // Check if data file already exists and warn
  if (await fs.pathExists(DATA_FILE)) {
    try {
      const existingData = require(DATA_FILE);
      if (Array.isArray(existingData) && existingData.length > 0) {
        console.log(`⚠️  Warning: Existing data file found with ${existingData.length} movies`);
        console.log('   Parser will preserve existing data if parsing fails or finds no results');
        console.log('   To force re-parse, delete movies-data.js first\n');
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
    
    const allMovies = [];
    const moviesPerPage = 200;
    const maxPages = Math.ceil(maxMovies / moviesPerPage);
    
    // First, collect all movie data from all pages
    for (let pageNumber = 1; pageNumber <= maxPages && allMovies.length < maxMovies; pageNumber++) {
      const moviesOnPage = await parseMoviesPage(page, pageNumber);
      
      if (moviesOnPage.length === 0) {
        console.log(`No movies found on page ${pageNumber}, stopping...`);
        break;
      }
      
      allMovies.push(...moviesOnPage);
      console.log(`Total movies collected: ${allMovies.length}/${maxMovies}`);
      
      if (allMovies.length >= maxMovies) break;
      
      // Rate limiting between pages
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Limit to maxMovies
    const moviesToProcess = allMovies.slice(0, maxMovies);
    console.log(`\nFound ${moviesToProcess.length} movies. Starting image downloads...`);
    
    // Now download images for each movie
    for (let i = 0; i < moviesToProcess.length; i++) {
      const movie = moviesToProcess[i];
      const movieId = extractMovieId(movie.movieUrl) || `movie-${movie.rank}`;
      
      console.log(`Processing ${i + 1}/${moviesToProcess.length}: ${movie.title} (${movie.year}) - Rank #${movie.rank}`);
      
      // Get image from movie profile page
      const imageUrl = await getMovieImage(page, movie.movieUrl);
      
      let imagePath = null;
      if (imageUrl) {
        console.log(`  Found image URL: ${imageUrl.substring(0, 100)}...`);
        const downloadedPath = await downloadImage(imageUrl, movieId);
        if (downloadedPath) {
          const relativeImagePath = path.relative(__dirname, downloadedPath).replace(/\\/g, '/');
          imagePath = relativeImagePath;
          console.log(`  ✓ Downloaded: ${relativeImagePath}`);
        }
      } else {
        console.log(`  ⚠ No image found for ${movie.title}`);
        // Debug: log what images were found
        try {
          const debugInfo = await page.evaluate(() => {
            const allImages = Array.from(document.querySelectorAll('img'));
            const amazonImages = allImages.filter(img => {
              const src = img.src || img.getAttribute('data-src') || '';
              return src.includes('m.media-amazon.com');
            });
            return {
              totalImages: allImages.length,
              amazonImages: amazonImages.length,
              amazonUrls: amazonImages.slice(0, 5).map(img => {
                const src = img.src || img.getAttribute('data-src') || '';
                const width = img.naturalWidth || img.width || 0;
                const height = img.naturalHeight || img.height || 0;
                return { src: src.substring(0, 80), width, height };
              })
            };
          });
          console.log(`  Debug - Total images: ${debugInfo.totalImages}, Amazon images: ${debugInfo.amazonImages}`);
          if (debugInfo.amazonUrls.length > 0) {
            console.log(`  Debug - Sample Amazon URLs:`, JSON.stringify(debugInfo.amazonUrls, null, 2));
          }
        } catch (e) {
          // Ignore debug errors
        }
      }
      
      // Update movie data
      moviesToProcess[i] = {
        id: movieId,
        name: movie.title,
        year: movie.year,
        rank: movie.rank,
        imagePath: imagePath
      };
      
      // Save progress periodically
      if ((i + 1) % 50 === 0) {
        await saveProgress(moviesToProcess.slice(0, i + 1));
        console.log(`  💾 Progress saved: ${i + 1} movies processed`);
      }
      
      // Rate limiting - be nice to the server
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final save - only if we have data
    if (moviesToProcess.length > 0) {
      await saveProgress(moviesToProcess);
    } else {
      console.log('⚠️  No movies found! Existing data file will be preserved.');
    }
    
    return moviesToProcess;
  } finally {
    await browser.close();
  }
}

// Save progress to file
async function saveProgress(movies) {
  // Don't overwrite existing data with empty array
  if (movies.length === 0) {
    console.log('⚠️  Warning: No movies to save, skipping file write to preserve existing data');
    return;
  }
  
  // Check if file exists and has data
  if (await fs.pathExists(DATA_FILE)) {
    try {
      const existingData = require(DATA_FILE);
      if (Array.isArray(existingData) && existingData.length > 0 && movies.length < existingData.length) {
        console.log(`⚠️  Warning: Attempting to save ${movies.length} movies, but file already has ${existingData.length} movies`);
        console.log('   Only overwriting if new data has more entries or user explicitly wants to replace');
        // Only overwrite if we have more or equal data
        if (movies.length < existingData.length) {
          console.log('   Preserving existing data. If you want to replace, delete the file first.');
          return;
        }
      }
    } catch (e) {
      // File exists but can't be read, proceed with write
      console.log('   Existing file could not be read, proceeding with write...');
    }
  }
  
  const jsContent = `// Movies data parsed from Box Office Mojo
// Generated automatically - do not edit manually
// Progress: ${movies.length} movies processed

const moviesData = ${JSON.stringify(movies, null, 2)};

module.exports = moviesData;
`;

  await fs.writeFile(DATA_FILE, jsContent, 'utf8');
}

// Run the parser
if (require.main === module) {
  parseTopMovies(1000)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseTopMovies };
