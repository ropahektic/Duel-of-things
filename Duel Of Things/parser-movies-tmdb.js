require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://www.boxofficemojo.com/chart/ww_top_lifetime_gross/';
const OUTPUT_DIR = path.join(__dirname, 'movies');
const DATA_FILE = path.join(__dirname, 'movies-data.js');

// TMDB API setup
// Get free API key from: https://www.themoviedb.org/settings/api
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500'; // w500 = 500px width poster

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });

    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const filename = `${movieId}${ext}`;
    const filePath = path.join(OUTPUT_DIR, filename);

    await fs.writeFile(filePath, response.data);
    return filePath;
  } catch (error) {
    console.error(`  ✗ Failed to download image:`, error.message);
    return null;
  }
}

// Search for movie in TMDB
async function searchMovieTMDB(movieTitle, year) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY must be set in environment variables!\n' +
      'Get it from: https://www.themoviedb.org/settings/api');
  }

  try {
    // Clean movie title
    let searchTitle = movieTitle.trim();
    
    // Remove common suffixes in parentheses
    searchTitle = searchTitle.replace(/\s*\(.*?\)$/, '').trim();
    
    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        query: searchTitle,
        year: year,
        language: 'en-US'
      }
    });

    if (!response.data.results || response.data.results.length === 0) {
      return null;
    }

    // Try to find best match
    let bestMatch = response.data.results[0];
    
    // Prefer exact title match
    for (const movie of response.data.results) {
      const movieTitleLower = movie.title.toLowerCase();
      const searchTitleLower = searchTitle.toLowerCase();
      
      if (movieTitleLower === searchTitleLower) {
        bestMatch = movie;
        break;
      }
    }
    
    // Prefer movies with poster
    if (!bestMatch.poster_path) {
      for (const movie of response.data.results) {
        if (movie.poster_path) {
          bestMatch = movie;
          break;
        }
      }
    }

    return bestMatch;
  } catch (error) {
    console.error(`  ✗ Error searching TMDB for "${movieTitle}":`, error.response?.data || error.message);
    return null;
  }
}

// Parse movies from a page (just get titles, years, ranks - no images yet)
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
          
          // Year is in the last cell
          const yearText = cells[cells.length - 1].textContent.trim();
          const year = parseInt(yearText);
          
          if (rank && title && year) {
            movieData.push({
              rank,
              title,
              year
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
  console.log('Starting Box Office Mojo movies parsing with TMDB API...');
  await ensureDirectory(OUTPUT_DIR);
  
  if (!TMDB_API_KEY) {
    console.error('❌ Error: TMDB_API_KEY not found!');
    console.log('To get free TMDB API credentials:');
    console.log('1. Go to https://www.themoviedb.org/settings/api');
    console.log('2. Create an account (free)');
    console.log('3. Request an API key');
    console.log('4. Set it as environment variable: TMDB_API_KEY=your_api_key');
    console.log('   Or create a .env file with: TMDB_API_KEY=your_api_key');
    process.exit(1);
  }
  
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
    
    // First, collect all movie data from all pages (just titles, years, ranks)
    console.log('Step 1: Collecting movie titles and ranks from Box Office Mojo...');
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await browser.close();
    
    // Limit to maxMovies
    const moviesToProcess = allMovies.slice(0, maxMovies);
    console.log(`\nStep 2: Found ${moviesToProcess.length} movies. Fetching images from TMDB API...`);
    
    // Now fetch images from TMDB API (much faster!)
    const processedMovies = [];
    const notFoundMovies = [];
    
    for (let i = 0; i < moviesToProcess.length; i++) {
      const movie = moviesToProcess[i];
      const movieId = `movie-${movie.rank}`;
      
      console.log(`[${i + 1}/${moviesToProcess.length}] Processing: ${movie.title} (${movie.year}) - Rank #${movie.rank}`);
      
      // Search TMDB for the movie
      const tmdbMovie = await searchMovieTMDB(movie.title, movie.year);
      
      let imagePath = null;
      
      if (tmdbMovie && tmdbMovie.poster_path) {
        // Build full poster URL
        const posterUrl = `${TMDB_IMAGE_BASE_URL}${tmdbMovie.poster_path}`;
        
        // Download the poster
        const downloadedPath = await downloadImage(posterUrl, movieId);
        if (downloadedPath) {
          const relativeImagePath = path.relative(__dirname, downloadedPath).replace(/\\/g, '/');
          imagePath = relativeImagePath;
          console.log(`  ✓ Downloaded: ${relativeImagePath}`);
        }
      } else {
        console.log(`  ⚠ Could not find movie in TMDB: ${movie.title}`);
        notFoundMovies.push(movie);
      }
      
      // Update movie data
      processedMovies.push({
        id: movieId,
        name: movie.title,
        year: movie.year,
        rank: movie.rank,
        imagePath: imagePath
      });
      
      // Save progress periodically
      if ((i + 1) % 50 === 0) {
        await saveProgress(processedMovies);
        console.log(`  💾 Progress saved: ${i + 1} movies processed`);
      }
      
      // Rate limiting - TMDB allows 40 requests per 10 seconds
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Final save - only if we have data
    if (processedMovies.length > 0) {
      await saveProgress(processedMovies);
    } else {
      console.log('⚠️  No movies found! Existing data file will be preserved.');
    }
    
    console.log(`\n✅ Parsing complete!`);
    console.log(`   Total movies processed: ${processedMovies.length}`);
    console.log(`   Movies with images: ${processedMovies.filter(m => m.imagePath).length}`);
    console.log(`   Movies NOT found in TMDB: ${notFoundMovies.length} ⚠️`);
    
    if (notFoundMovies.length > 0) {
      const notFoundFile = path.join(__dirname, 'movies-not-found.json');
      await fs.writeJSON(notFoundFile, notFoundMovies, { spaces: 2 });
      console.log(`   Not found movies saved to: ${notFoundFile}`);
    }
    
    return processedMovies;
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
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
  
  const jsContent = `// Movies data parsed from Box Office Mojo (images from TMDB API)
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
