require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, '937990245-Videogame-Sales-Data-Set-Top-1000.txt');
const OUTPUT_DIR = path.join(__dirname, 'games');
const OUTPUT_JS = path.join(__dirname, 'games-data.js');

// IGDB API setup
// You'll need to get free API credentials from:
// 1. Go to https://dev.twitch.tv/console/apps (Twitch owns IGDB)
// 2. Create a new app
// 3. Get Client ID and Client Secret
// 4. Set them as environment variables: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET
const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID;
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;
const IGDB_BASE_URL = 'https://api.igdb.com/v4';

let accessToken = null;

// Get IGDB access token
async function getIGDBAccessToken() {
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new Error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set in environment variables!\n' +
      'Get them from: https://dev.twitch.tv/console/apps');
  }

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: IGDB_CLIENT_ID,
        client_secret: IGDB_CLIENT_SECRET,
        grant_type: 'client_credentials'
      }
    });

    accessToken = response.data.access_token;
    console.log('✓ Got IGDB access token');
    return accessToken;
  } catch (error) {
    console.error('Error getting IGDB access token:', error.response?.data || error.message);
    throw error;
  }
}

// Search for game in IGDB
async function searchGameIGDB(gameName, platform = null, year = null) {
  if (!accessToken) {
    await getIGDBAccessToken();
  }

  try {
    // Clean game name for search
    let searchName = gameName;
    // Remove platform-specific suffixes
    searchName = searchName.replace(/\s*\(.*\)$/, '').trim();
    
    // Normalize Pokémon to Pokemon for IGDB search (IGDB uses "Pokemon" without accent)
    searchName = searchName.replace(/Pokémon/g, 'Pokemon');
    searchName = searchName.replace(/Pokemon/g, 'Pokemon'); // Ensure consistent
    
    // Build search query - search by name first, then filter results
    // IGDB uses Unix timestamps in seconds, not milliseconds
    let searchQuery = `search "${searchName}"; fields id,name,cover.url,cover.image_id,first_release_date; limit 20;`;

    const response = await axios.post(`${IGDB_BASE_URL}/games`, searchQuery, {
      headers: {
        'Client-ID': IGDB_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'text/plain'
      }
    });

    let games = response.data;
    
    if (games.length === 0) {
      return null;
    }

    // Filter by year if provided (IGDB timestamps are in seconds)
    if (year) {
      const yearStart = Math.floor(new Date(year - 1, 0, 1).getTime() / 1000);
      const yearEnd = Math.floor(new Date(year + 1, 11, 31).getTime() / 1000);
      
      games = games.filter(g => {
        if (!g.first_release_date) return true; // Keep games without release date
        return g.first_release_date >= yearStart && g.first_release_date <= yearEnd;
      });
    }

    if (games.length === 0) {
      // If year filter removed all results, use original results
      games = response.data;
    }

    // Try to find best match
    let bestMatch = games[0];
    
    // Prefer exact name match
    const exactMatch = games.find(g => {
      const gameName = g.name.toLowerCase();
      const searchLower = searchName.toLowerCase();
      return gameName === searchLower || 
             gameName.includes(searchLower) ||
             searchLower.includes(gameName);
    });
    if (exactMatch) {
      bestMatch = exactMatch;
    }

    // Get cover image URL
    if (bestMatch.cover) {
      // IGDB cover URLs need to be formatted: https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg
      const imageId = bestMatch.cover.image_id || bestMatch.cover.url?.split('/').pop()?.split('.')[0];
      if (imageId) {
        bestMatch.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
      } else if (bestMatch.cover.url) {
        bestMatch.coverUrl = bestMatch.cover.url.startsWith('http') 
          ? bestMatch.cover.url 
          : `https://images.igdb.com/igdb/image/upload/t_cover_big/${bestMatch.cover.url}`;
      }
    }

    return bestMatch;
  } catch (error) {
    if (error.response?.status === 401) {
      // Token expired, get new one
      await getIGDBAccessToken();
      return searchGameIGDB(gameName, platform, year);
    }
    console.error(`Error searching IGDB for "${gameName}":`, error.response?.data || error.message);
    return null;
  }
}

// Download image
async function downloadImage(imageUrl, gameId) {
  try {
    if (!imageUrl) return null;
    
    const imagePath = path.join(OUTPUT_DIR, `${gameId}.jpg`);
    
    // Skip if already exists
    if (await fs.pathExists(imagePath)) {
      return imagePath;
    }
    
    console.log(`  Downloading from: ${imageUrl}`);
    
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
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
    console.error(`  ✗ Failed to download image for ${gameId}:`, error.message);
    return null;
  }
}

// Parse game data file
function parseGameDataFile() {
  // Read with UTF-8 encoding to handle special characters like é in Pokémon
  let content = fs.readFileSync(DATA_FILE, 'utf8');
  
  // Fix encoding issues
  content = content.replace(/PokÃ©mon/g, 'Pokémon');
  
  // Remove form feed characters and normalize line breaks
  content = content.replace(/\f/g, ' ');
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const lines = content.split('\n');
  
  const games = [];
  
  // Skip header line (line 1, index 0)
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i];
    if (!line || line.trim().length === 0) continue;
    
    // Remove form feed and normalize whitespace
    line = line.replace(/\f/g, ' ').trim();
    
    // Format: Rank (spaces) Name (spaces) Platform (spaces) Year (spaces) Genre (spaces) Publisher
    // Example: "        1 Wii Sports                                   Wii           2006 Sports         Nintendo"
    
    // Find rank number at the start (handle form feeds)
    const rankMatch = line.match(/^[\s\f]*(\d+)/);
    if (!rankMatch) continue;
    
    const rank = parseInt(rankMatch[1]);
    if (isNaN(rank) || rank < 1 || rank > 1000) continue;
    
    // Find year (4 digits) - this is a reliable anchor
    const yearMatch = line.match(/\b(\d{4})\b/);
    if (!yearMatch) continue;
    
    const year = parseInt(yearMatch[1]);
    if (year < 1980 || year > 2025) continue; // Validate year range
    
    const yearIndex = line.indexOf(yearMatch[0]);
    
    // Everything before year should contain: rank, name, platform
    const beforeYear = line.substring(0, yearIndex).trim();
    
    // Remove rank from the beginning
    const rankEnd = rankMatch.index + rankMatch[0].length;
    const afterRank = beforeYear.substring(rankEnd).trim();
    
    // Split by multiple spaces (2 or more) to get columns
    const parts = afterRank.split(/\s{2,}/).filter(p => p.trim().length > 0);
    
    let platform = '';
    let name = '';
    
    if (parts.length >= 2) {
      // Usually: [name, platform] or [name parts..., platform]
      // Platform is typically the last part before year
      platform = parts[parts.length - 1].trim();
      name = parts.slice(0, -1).join(' ').trim();
    } else if (parts.length === 1) {
      // Single part - try to extract platform from the end
      const text = parts[0];
      // Common platforms at the end
      const platformPattern = /\b(Wii|DS|PS3|PS4|PS2|PSP|PS|X360|XB|XOne|GB|GBA|NES|SNES|3DS|N64|PC|2600|GEN|SAT|DC|GC|WiiU|NS|PSV)\s*$/i;
      const platformMatch = text.match(platformPattern);
      
      if (platformMatch) {
        platform = platformMatch[1];
        const platformIndex = text.lastIndexOf(platform);
        name = text.substring(0, platformIndex).trim();
      } else {
        // Try last word as platform
        const words = text.split(/\s+/);
        if (words.length > 1) {
          const lastWord = words[words.length - 1];
          if (lastWord.length <= 5 && /^[A-Z0-9]+$/i.test(lastWord) && !lastWord.match(/^\d+$/)) {
            platform = lastWord;
            name = words.slice(0, -1).join(' ');
          } else {
            name = text;
          }
        } else {
          name = text;
        }
      }
    } else {
      // No parts found, skip
      continue;
    }
    
    // Clean up name - remove extra spaces
    name = name.replace(/\s+/g, ' ').trim();
    
    // Validate: name should be meaningful (not just platform or too short)
    if (!name || name.length < 2) continue;
    
    // Skip if name is just a platform code
    if (name === platform || /^(Wii|DS|PS3|PS4|PS2|PSP|PS|X360|XB|XOne|GB|GBA|NES|SNES|3DS|N64|PC|2600|GEN|SAT|DC|GC|WiiU|NS|PSV)$/i.test(name)) {
      continue;
    }
    
    // Validate platform - should be a known platform code
    if (!platform || platform.length < 2) {
      continue;
    }
    
    // Normalize platform name
    platform = platform.toUpperCase();
    if (platform === 'XB') platform = 'X360'; // Normalize XB to X360
    
    games.push({
      rank: rank,
      name: name,
      platform: platform,
      year: year
    });
  }
  
  // Sort by rank to ensure correct order
  games.sort((a, b) => a.rank - b.rank);
  
  console.log(`Parsed ${games.length} games from file`);
  if (games.length > 0) {
    console.log(`Rank range: ${games[0].rank} to ${games[games.length - 1].rank}`);
  }
  
  return games;
}

// Main parsing function
async function parseGames(maxGames = 1000) {
  console.log('Starting game data parsing...');
  await fs.ensureDir(OUTPUT_DIR);
  
  // Check for IGDB credentials
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    console.error('\n❌ Error: IGDB API credentials not found!');
    console.log('\nTo get free IGDB API credentials:');
    console.log('1. Go to https://dev.twitch.tv/console/apps');
    console.log('2. Click "Register Your Application"');
    console.log('3. Fill in the form (name it anything, redirect URL can be http://localhost)');
    console.log('4. Get your Client ID and Client Secret');
    console.log('5. Set them as environment variables:');
    console.log('   - IGDB_CLIENT_ID=your_client_id');
    console.log('   - IGDB_CLIENT_SECRET=your_client_secret');
    console.log('\nOr create a .env file with:');
    console.log('IGDB_CLIENT_ID=your_client_id');
    console.log('IGDB_CLIENT_SECRET=your_client_secret');
    process.exit(1);
  }
  
  // Parse game data file
  console.log('Parsing game data file...');
  const games = parseGameDataFile();
  console.log(`Found ${games.length} games in data file`);
  
  if (games.length === 0) {
    console.error('No games found in data file!');
    return;
  }
  
  // Debug: Show first few games
  console.log('\nFirst 5 games parsed:');
  games.slice(0, 5).forEach(g => {
    console.log(`  Rank ${g.rank}: ${g.name} (${g.platform}, ${g.year})`);
  });
  
  // Get IGDB access token
  await getIGDBAccessToken();
  
  const processedGames = [];
  const notFoundGames = []; // Track games not found in IGDB
  const limit = Math.min(maxGames, games.length);
  
  for (let i = 0; i < limit; i++) {
    const game = games[i];
    console.log(`\n[${i + 1}/${limit}] Processing: ${game.name} (Rank #${game.rank}, ${game.platform}, ${game.year})`);
    
    // Generate game ID
    const gameId = game.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50) + `-${game.rank}`;
    
    // Search IGDB for game
    const igdbResult = await searchGameIGDB(game.name, game.platform, game.year);
    
    if (igdbResult && igdbResult.coverUrl) {
      // Download image
      const imagePath = await downloadImage(igdbResult.coverUrl, gameId);
      
      if (imagePath) {
        const relativeImagePath = path.relative(__dirname, imagePath).replace(/\\/g, '/');
        
        processedGames.push({
          id: gameId,
          name: game.name,
          rank: game.rank,
          platform: game.platform,
          year: game.year,
          imagePath: relativeImagePath,
          foundInIGDB: true
        });
        
        console.log(`  ✓ Successfully processed ${game.name}`);
      } else {
        console.log(`  ⚠ Could not download image for ${game.name} - FLAGGED`);
        // Flag as not found
        notFoundGames.push({
          ...game,
          id: gameId,
          reason: 'Image download failed'
        });
        
        processedGames.push({
          id: gameId,
          name: game.name,
          rank: game.rank,
          platform: game.platform,
          year: game.year,
          imagePath: null,
          foundInIGDB: false
        });
      }
    } else {
      console.log(`  ⚠ Could not find game in IGDB: ${game.name} - FLAGGED`);
      // Flag as not found
      notFoundGames.push({
        ...game,
        id: gameId,
        reason: 'Not found in IGDB'
      });
      
      processedGames.push({
        id: gameId,
        name: game.name,
        rank: game.rank,
        platform: game.platform,
        year: game.year,
        imagePath: null,
        foundInIGDB: false
      });
    }
    
    // Save progress every 10 games
    if ((i + 1) % 10 === 0) {
      await saveProgress(processedGames);
      console.log(`\n💾 Progress saved: ${processedGames.length} games processed`);
    }
    
    // Rate limiting - IGDB allows 4 requests per second
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Final save
  await saveProgress(processedGames);
  
  // Save list of games not found in IGDB
  const notFoundFile = path.join(__dirname, 'games-not-found.json');
  await fs.writeJSON(notFoundFile, notFoundGames, { spaces: 2 });
  
  console.log(`\n✅ Parsing complete!`);
  console.log(`   Total games processed: ${processedGames.length}`);
  console.log(`   Games with images: ${processedGames.filter(g => g.imagePath).length}`);
  console.log(`   Games NOT found in IGDB: ${notFoundGames.length} ⚠️`);
  console.log(`   Data saved to: ${OUTPUT_JS}`);
  console.log(`   Images saved to: ${OUTPUT_DIR}`);
  console.log(`   Not found games saved to: ${notFoundFile}`);
  
  if (notFoundGames.length > 0) {
    console.log(`\n⚠️  Games that need alternative image sources:`);
    notFoundGames.slice(0, 10).forEach(g => {
      console.log(`   - Rank #${g.rank}: ${g.name} (${g.platform}, ${g.year}) - ${g.reason}`);
    });
    if (notFoundGames.length > 10) {
      console.log(`   ... and ${notFoundGames.length - 10} more`);
    }
  }
  
  return processedGames;
}

// Save progress to file
async function saveProgress(games) {
  const jsContent = `// Games data parsed from sales dataset
// Generated automatically - do not edit manually
// Progress: ${games.length} games processed

const gamesData = ${JSON.stringify(games, null, 2)};

module.exports = gamesData;
`;

  await fs.writeFile(OUTPUT_JS, jsContent, 'utf8');
}

// Run the parser
if (require.main === module) {
  parseGames(1000)
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { parseGames };
