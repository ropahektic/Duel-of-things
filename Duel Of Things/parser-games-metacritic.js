const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');

const GAMES_DATA_FILE = path.join(__dirname, 'games-data.js');
const UPDATED_DATA_FILE = path.join(__dirname, 'games-data.js');

// Load existing games data
function loadGamesData() {
  try {
    delete require.cache[require.resolve(GAMES_DATA_FILE)];
    return require(GAMES_DATA_FILE);
  } catch (error) {
    console.error('Error loading games data:', error);
    return [];
  }
}

// Search Metacritic for game score
async function searchMetacriticScore(page, gameName, platform, year) {
  try {
    // Clean game name for search
    const searchQuery = `${gameName} ${platform} ${year}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    
    // Navigate to Metacritic search
    const searchUrl = `https://www.metacritic.com/search/${encodedQuery}/?category=2`; // category=2 is games
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait a bit for results to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to find the first result with a score
    const score = await page.evaluate(() => {
      // Look for score elements - Metacritic uses various selectors
      // Try different selectors for score
      const selectors = [
        'a[href*="/game/"] .metascore_w',
        'a[href*="/game/"] .metascore_w.large',
        '.search_results .metascore_w',
        '.search_results .metascore_w.large',
        'a[href*="/game/"] .c-siteReviewScore',
        '.search_results .c-siteReviewScore'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          const score = parseInt(text);
          if (!isNaN(score) && score >= 0 && score <= 100) {
            return score;
          }
        }
      }
      
      // Try to find links to game pages and extract score from there
      const gameLinks = document.querySelectorAll('a[href*="/game/"]');
      if (gameLinks.length > 0) {
        // Return the first link URL so we can visit it
        return gameLinks[0].href;
      }
      
      return null;
    });
    
    // If we got a URL, visit the game page to get the score
    if (typeof score === 'string' && score.startsWith('http')) {
      try {
        await page.goto(score, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const pageScore = await page.evaluate(() => {
          const selectors = [
            '.metascore_w.large',
            '.c-siteReviewScore',
            '.metascore_w',
            '[class*="metascore"]'
          ];
          
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              const text = element.textContent.trim();
              const score = parseInt(text);
              if (!isNaN(score) && score >= 0 && score <= 100) {
                return score;
              }
            }
          }
          
          return null;
        });
        
        if (pageScore !== null) {
          return pageScore;
        }
      } catch (error) {
        console.log(`    ⚠ Error visiting game page: ${error.message}`);
      }
    }
    
    return typeof score === 'number' ? score : null;
  } catch (error) {
    console.log(`    ⚠ Error searching Metacritic: ${error.message}`);
    return null;
  }
}

// Main function to parse Metacritic scores
async function parseMetacriticScores() {
  console.log('🎮 Starting Metacritic score parsing...\n');
  
  const games = loadGamesData();
  console.log(`Loaded ${games.length} games\n`);
  
  // Filter games that don't have a metacritic score yet
  const gamesToProcess = games.filter(game => game.metacriticScore === undefined);
  console.log(`Games to process: ${gamesToProcess.length}\n`);
  
  if (gamesToProcess.length === 0) {
    console.log('✅ All games already have Metacritic scores!');
    return;
  }
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  
  try {
    for (let i = 0; i < gamesToProcess.length; i++) {
      const game = gamesToProcess[i];
      console.log(`[${i + 1}/${gamesToProcess.length}] Processing: ${game.name} (${game.platform}, ${game.year})`);
      
      // Skip if already has score
      if (game.metacriticScore !== undefined) {
        console.log(`  ⏭ Skipped (already has score)`);
        skipCount++;
        continue;
      }
      
      const score = await searchMetacriticScore(page, game.name, game.platform, game.year);
      
      if (score !== null && score >= 0 && score <= 100) {
        game.metacriticScore = score;
        successCount++;
        console.log(`  ✓ Found Metacritic score: ${score}`);
      } else {
        failCount++;
        console.log(`  ✗ Could not find Metacritic score`);
      }
      
      // Save progress every 10 games
      if ((i + 1) % 10 === 0) {
        const jsContent = `// Games data parsed from sales dataset with Metacritic scores
// Generated automatically - do not edit manually
// Total: ${games.length} games

module.exports = ${JSON.stringify(games, null, 2)};
`;
        await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf8');
        console.log(`\n💾 Progress saved: ${i + 1} processed, ${successCount} successful, ${skipCount} skipped, ${failCount} failed\n`);
      }
      
      // Rate limiting: wait 2-3 seconds between requests
      const delay = 2000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Final save
    const jsContent = `// Games data parsed from sales dataset with Metacritic scores
// Generated automatically - do not edit manually
// Total: ${games.length} games

module.exports = ${JSON.stringify(games, null, 2)};
`;
    await fs.writeFile(UPDATED_DATA_FILE, jsContent, 'utf8');
    
    console.log(`\n✅ Metacritic score parsing complete!`);
    console.log(`Total games: ${games.length}`);
    console.log(`Processed: ${gamesToProcess.length}`);
    console.log(`Successful: ${successCount}`);
    console.log(`Skipped: ${skipCount}`);
    console.log(`Failed: ${failCount}`);
    console.log(`Games with scores: ${games.filter(g => g.metacriticScore !== undefined).length}`);
    console.log(`Data saved to: ${UPDATED_DATA_FILE}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await browser.close();
  }
}

// Run parser
parseMetacriticScores().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
