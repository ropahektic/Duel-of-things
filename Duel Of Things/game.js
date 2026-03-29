const fs = require('fs-extra');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const sharp = require('sharp');

const RANKING_FILE = path.join(__dirname, 'ranking.json');
const COMPOSITE_DIR = path.join(__dirname, 'composites');

// Initialize ranking file if it doesn't exist
async function initRanking() {
  if (!await fs.pathExists(RANKING_FILE)) {
    await fs.writeJSON(RANKING_FILE, {
      anime: [],
      people: [],
      games: [],
      movies: [],
      shows: [],
      cities: [],
      epic7: [],
      cityid: [],
      instagram: [],
      cars: [],
      multiduel: []
    });
  } else {
    // Migrate old format to new format if needed
    const ranking = await fs.readJSON(RANKING_FILE);
    if (Array.isArray(ranking)) {
      // Old format - migrate to new format
      await fs.writeJSON(RANKING_FILE, {
        anime: ranking,
        people: [],
        games: [],
        movies: [],
        shows: [],
        cities: [],
        epic7: [],
        cityid: [],
        instagram: [],
        cars: [],
        multiduel: []
      });
    } else {
      // Ensure all required fields exist
      const requiredFields = ['anime', 'people', 'games', 'movies', 'shows', 'cities', 'epic7', 'cityid', 'instagram', 'cars', 'multiduel'];
      let updated = false;
      for (const field of requiredFields) {
        if (!ranking[field]) {
          ranking[field] = [];
          updated = true;
        }
      }
      if (updated) {
        await fs.writeJSON(RANKING_FILE, ranking);
      }
    }
  }
  await fs.ensureDir(COMPOSITE_DIR);
}

// Get random character (excluding used ones)
function getRandomCharacter(characters, usedIds = []) {
  const available = characters.filter(c => !usedIds.includes(c.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two different random characters (excluding used ones)
function getTwoRandomCharacters(characters, usedIds = []) {
  const char1 = getRandomCharacter(characters, usedIds);
  if (!char1) return null;
  
  const char2 = getRandomCharacter(characters, [...usedIds, char1.id]);
  if (!char2) return null;
  
  return [char1, char2];
}

// Get character with 10-20% difference (for round 4)
function getCharacterWithDifference(referenceChar, characters, usedIds = []) {
  const availableChars = characters.filter(c => 
    !usedIds.includes(c.id) && c.id !== referenceChar.id
  );
  
  if (availableChars.length === 0) {
    return getRandomCharacter(characters, usedIds);
  }

  // 10-20% difference
  const minDiff = 0.10; // 10%
  const maxDiff = 0.20; // 20%
  
  const isHigher = Math.random() < 0.5;
  
  let targetMin, targetMax;
  if (isHigher) {
    targetMin = referenceChar.favorites * (1 + minDiff);
    targetMax = referenceChar.favorites * (1 + maxDiff);
  } else {
    targetMin = referenceChar.favorites * (1 - maxDiff);
    targetMax = referenceChar.favorites * (1 - minDiff);
  }

  const candidates = availableChars.filter(char => {
    return char.favorites >= targetMin && char.favorites <= targetMax;
  });

  if (candidates.length === 0) {
    // Expand search slightly
    const expanded = availableChars.filter(char => {
      return char.favorites >= targetMin * 0.95 && char.favorites <= targetMax * 1.05;
    });
    if (expanded.length > 0) {
      return expanded[Math.floor(Math.random() * expanded.length)];
    }
    // Last resort: closest to range
    const sorted = availableChars.sort((a, b) => {
      const aDist = Math.min(Math.abs(a.favorites - targetMin), Math.abs(a.favorites - targetMax));
      const bDist = Math.min(Math.abs(b.favorites - targetMin), Math.abs(b.favorites - targetMax));
      return aDist - bDist;
    });
    return sorted[0] || getRandomCharacter(characters, usedIds);
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Get random anime (excluding used ones)
function getRandomAnime(animeList, usedIds = []) {
  const available = animeList.filter(a => !usedIds.includes(a.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two different random animes (excluding used ones)
function getTwoRandomAnimes(animeList, usedIds = []) {
  const anime1 = getRandomAnime(animeList, usedIds);
  if (!anime1) return null;
  
  const anime2 = getRandomAnime(animeList, [...usedIds, anime1.id]);
  if (!anime2) return null;
  
  return [anime1, anime2];
}

// Get random person (excluding used ones)
function getRandomPerson(peopleList, usedIds = []) {
  const available = peopleList.filter(p => !usedIds.includes(p.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two different random people (excluding used ones)
function getTwoRandomPeople(peopleList, usedIds = []) {
  const person1 = getRandomPerson(peopleList, usedIds);
  if (!person1) return null;
  
  const person2 = getRandomPerson(peopleList, [...usedIds, person1.id]);
  if (!person2) return null;
  
  return [person1, person2];
}

// Get random game (excluding used ones)
function getRandomGame(gamesList, usedIds = []) {
  const available = gamesList.filter(g => !usedIds.includes(g.id) && g.imagePath && g.metacriticScore !== undefined && g.metacriticScore !== null); // Only games with images and Metacritic scores
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two different random games (excluding used ones and ensuring different Metacritic scores)
function getTwoRandomGames(gamesList, usedIds = []) {
  const game1 = getRandomGame(gamesList, usedIds);
  if (!game1) return null;
  
  // Ensure game2 has a different Metacritic score than game1
  const game1Score = game1.metacriticScore;
  const availableGames = gamesList.filter(g => 
    !usedIds.includes(g.id) && 
    g.id !== game1.id &&
    g.imagePath && 
    g.metacriticScore !== undefined && 
    g.metacriticScore !== null &&
    g.metacriticScore !== game1Score // Different score
  );
  
  if (availableGames.length === 0) {
    // If no games with different scores, fallback to any game
    return getTwoRandomGamesFallback(gamesList, usedIds, game1);
  }
  
  const game2 = availableGames[Math.floor(Math.random() * availableGames.length)];
  if (!game2) return null;
  
  return [game1, game2];
}

// Fallback function if no games with different scores are available
function getTwoRandomGamesFallback(gamesList, usedIds, game1) {
  const availableGames = gamesList.filter(g => 
    !usedIds.includes(g.id) && 
    g.id !== game1.id &&
    g.imagePath && 
    g.metacriticScore !== undefined && 
    g.metacriticScore !== null
  );
  
  if (availableGames.length === 0) return null;
  
  const game2 = availableGames[Math.floor(Math.random() * availableGames.length)];
  return [game1, game2];
}

// Get game with Metacritic score difference of ±2 (for hard matchup on round 5, every 6th round is a reset)
// Also ensures the selected game has a different score than the reference game
function getGameWithRankDifference(referenceGame, gamesList, usedIds = []) {
  const targetScore = referenceGame.metacriticScore;
  if (targetScore === undefined || targetScore === null) {
    return getRandomGame(gamesList, usedIds);
  }
  
  const availableGames = gamesList.filter(g => 
    !usedIds.includes(g.id) && 
    g.id !== referenceGame.id &&
    g.imagePath && // Only games with images
    g.metacriticScore !== undefined && 
    g.metacriticScore !== null &&
    g.metacriticScore !== targetScore // Different score from reference
  );
  
  if (availableGames.length === 0) {
    return getRandomGame(gamesList, usedIds);
  }

  // Find games within ±2 Metacritic score points
  const minScore = Math.max(0, targetScore - 2);
  const maxScore = Math.min(100, targetScore + 2);
  
  const closeGames = availableGames.filter(g => 
    g.metacriticScore >= minScore && g.metacriticScore <= maxScore
  );
  
  if (closeGames.length > 0) {
    return closeGames[Math.floor(Math.random() * closeGames.length)];
  }
  
  // Fallback to random if no close games found (but still different score)
  const fallbackGames = availableGames.filter(g => g.metacriticScore !== targetScore);
  if (fallbackGames.length > 0) {
    return fallbackGames[Math.floor(Math.random() * fallbackGames.length)];
  }
  
  return getRandomGame(gamesList, usedIds);
}

// Get random movie (excluding used ones)
function getRandomMovie(moviesList, usedIds = []) {
  const available = moviesList.filter(m => !usedIds.includes(m.id) && m.imagePath); // Only movies with images
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two random movies
function getTwoRandomMovies(moviesList, usedIds = []) {
  const movie1 = getRandomMovie(moviesList, usedIds);
  if (!movie1) return null;
  
  const movie2 = getRandomMovie(moviesList, [...usedIds, movie1.id]);
  if (!movie2) return null;
  
  return [movie1, movie2];
}

// Get movie with rank difference of ±5 (for hard matchup on round 4)
function getMovieWithRankDifference(referenceMovie, moviesList, usedIds = []) {
  const availableMovies = moviesList.filter(m => 
    !usedIds.includes(m.id) && 
    m.id !== referenceMovie.id &&
    m.imagePath // Only movies with images
  );
  
  if (availableMovies.length === 0) {
    return getRandomMovie(moviesList, usedIds);
  }

  // Find movies within ±5 ranks
  const targetRank = referenceMovie.rank;
  const minRank = Math.max(1, targetRank - 5);
  const maxRank = targetRank + 5;
  
  const closeMovies = availableMovies.filter(m => 
    m.rank >= minRank && m.rank <= maxRank
  );
  
  if (closeMovies.length > 0) {
    return closeMovies[Math.floor(Math.random() * closeMovies.length)];
  }
  
  // Fallback to random if no close movies found
  return getRandomMovie(moviesList, usedIds);
}

// Get random show (excluding used ones)
function getRandomShow(showsList, usedIds = []) {
  const available = showsList.filter(s => !usedIds.includes(s.id) && s.imagePath);
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function normalizeImdbRating(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

// Get two random shows
function getTwoRandomShows(showsList, usedIds = []) {
  const show1 = getRandomShow(showsList, usedIds);
  if (!show1) return null;

  const show1Rating = normalizeImdbRating(show1.rating);
  const usedPlusShow1 = [...usedIds, show1.id];

  // Safeguard: never pair two shows with the same IMDb rating (e.g. 8.7 vs 8.7).
  // If ratings are missing in the dataset, we fall back to the original behavior.
  let show2 = null;
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = getRandomShow(showsList, usedPlusShow1);
    if (!candidate) break;

    const candidateRating = normalizeImdbRating(candidate.rating);
    if (show1Rating !== null && candidateRating !== null && candidateRating === show1Rating) {
      continue;
    }

    show2 = candidate;
    break;
  }

  // Fallback: if we couldn't find a different-rating candidate, use any other show.
  if (!show2) {
    show2 = getRandomShow(showsList, usedPlusShow1);
  }
  if (!show2) return null;

  return [show1, show2];
}

// Get show with rank difference of ±4 (for hard matchup on round 4)
function getShowWithRankDifference(referenceShow, showsList, usedIds = []) {
  const availableShows = showsList.filter(s =>
    !usedIds.includes(s.id) &&
    s.id !== referenceShow.id &&
    s.imagePath
  );

  if (availableShows.length === 0) {
    return getRandomShow(showsList, usedIds);
  }

  const targetRank = referenceShow.rank;
  const minRank = Math.max(1, targetRank - 4);
  const maxRank = targetRank + 4;

  const closeShows = availableShows.filter(s =>
    s.rank >= minRank && s.rank <= maxRank
  );

  if (closeShows.length > 0) {
    return closeShows[Math.floor(Math.random() * closeShows.length)];
  }

  return getRandomShow(showsList, usedIds);
}

// Get random city
function getRandomCity(citiesList, usedIds = []) {
  const availableCities = citiesList.filter(c => 
    !usedIds.includes(c.id) && 
    c.imagePath // Only cities with images
  );
  
  if (availableCities.length === 0) return null;
  return availableCities[Math.floor(Math.random() * availableCities.length)];
}

// Get random Instagram influencer
function getRandomInstagramer(instagramList, usedIds = []) {
  const available = instagramList.filter(i => !usedIds.includes(i.id) && i.imagePath); // Only influencers with images
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two random Instagram influencers
function getTwoRandomInstagramers(instagramList, usedIds = []) {
  const influencer1 = getRandomInstagramer(instagramList, usedIds);
  if (!influencer1) return null;
  
  const influencer2 = getRandomInstagramer(instagramList, [...usedIds, influencer1.id]);
  if (!influencer2) return null;
  
  return [influencer1, influencer2];
}

// Get Instagram influencer with rank difference of ±5 (for hard matchup on round 4)
function getInstagramerWithRankDifference(referenceInfluencer, instagramList, usedIds = []) {
  const availableInfluencers = instagramList.filter(i => 
    !usedIds.includes(i.id) && 
    i.id !== referenceInfluencer.id &&
    i.imagePath // Only influencers with images
  );
  
  if (availableInfluencers.length === 0) {
    return getRandomInstagramer(instagramList, usedIds);
  }

  // Find influencers within ±5 ranks
  const targetRank = referenceInfluencer.rank;
  const minRank = Math.max(1, targetRank - 5);
  const maxRank = targetRank + 5;
  
  const closeInfluencers = availableInfluencers.filter(i => 
    i.rank >= minRank && i.rank <= maxRank
  );
  
  if (closeInfluencers.length > 0) {
    return closeInfluencers[Math.floor(Math.random() * closeInfluencers.length)];
  }
  
  // Fallback to random if no close influencers found
  return getRandomInstagramer(instagramList, usedIds);
}

// Get random car (optionally excluding a specific max speed to avoid ties)
function getRandomCar(carsList, usedIds = [], excludeMaxSpeedKmh = null) {
  const available = carsList.filter(c =>
    !usedIds.includes(c.id) &&
    c.imagePath && // Only cars with images
    typeof c.maxSpeedKmh === 'number' &&
    c.maxSpeedKmh > 0 &&
    (excludeMaxSpeedKmh == null || c.maxSpeedKmh !== excludeMaxSpeedKmh)
  );
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two random cars with DIFFERENT max speeds (to avoid draws)
function getTwoRandomCars(carsList, usedIds = []) {
  const car1 = getRandomCar(carsList, usedIds);
  if (!car1) return null;

  const car2 = getRandomCar(carsList, [...usedIds, car1.id], car1.maxSpeedKmh);
  if (!car2) return null;

  return [car1, car2];
}

// Get car within ±20 km/h max speed of reference (hard matchup on round 4), always different speed
function getCarWithSpeedDifference(referenceCar, carsList, usedIds = [], maxDeltaKmh = 20) {
  const refSpeed = referenceCar?.maxSpeedKmh;
  if (typeof refSpeed !== 'number') {
    return getRandomCar(carsList, usedIds);
  }

  const availableCars = carsList.filter(c =>
    !usedIds.includes(c.id) &&
    c.id !== referenceCar.id &&
    c.imagePath &&
    typeof c.maxSpeedKmh === 'number' &&
    c.maxSpeedKmh > 0 &&
    c.maxSpeedKmh !== refSpeed // avoid ties
  );

  if (availableCars.length === 0) {
    return getRandomCar(carsList, usedIds, refSpeed);
  }

  const closeCars = availableCars.filter(c => Math.abs(c.maxSpeedKmh - refSpeed) <= maxDeltaKmh);
  if (closeCars.length > 0) {
    return closeCars[Math.floor(Math.random() * closeCars.length)];
  }

  // Fallback: pick the closest-by-speed car (still different speed)
  let closest = null;
  let bestDelta = Infinity;
  for (const c of availableCars) {
    const delta = Math.abs(c.maxSpeedKmh - refSpeed);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = c;
    }
  }

  return closest || getRandomCar(carsList, usedIds, refSpeed);
}

// Get two random cities
function getTwoRandomCities(citiesList, usedIds = []) {
  const city1 = getRandomCity(citiesList, usedIds);
  if (!city1) return null;
  
  const city2 = getRandomCity(citiesList, [...usedIds, city1.id]);
  if (!city2) return null;
  
  return [city1, city2];
}

// Get city with rank difference of ±5 (for hard matchup)
function getCityWithRankDifference(referenceCity, citiesList, usedIds = []) {
  const availableCities = citiesList.filter(c => 
    !usedIds.includes(c.id) && 
    c.id !== referenceCity.id &&
    c.imagePath // Only cities with images
  );
  
  if (availableCities.length === 0) {
    return getRandomCity(citiesList, usedIds);
  }

  // Find cities within ±5 ranks
  const targetRank = referenceCity.rank;
  const minRank = Math.max(1, targetRank - 5);
  const maxRank = targetRank + 5;
  
  const closeCities = availableCities.filter(c => 
    c.rank >= minRank && c.rank <= maxRank
  );
  
  if (closeCities.length > 0) {
    return closeCities[Math.floor(Math.random() * closeCities.length)];
  }
  
  // Fallback to random if no close cities found
  return getRandomCity(citiesList, usedIds);
}

// Get random Epic7 character
function getRandomEpic7(epic7List, usedIds = []) {
  const available = epic7List.filter(c => 
    !usedIds.includes(c.id) && 
    c.imagePath // Only characters with images
  );
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// Get two random Epic7 characters
function getTwoRandomEpic7(epic7List, usedIds = []) {
  const char1 = getRandomEpic7(epic7List, usedIds);
  if (!char1) return null;
  
  const char2 = getRandomEpic7(epic7List, [...usedIds, char1.id]);
  if (!char2) return null;
  
  return [char1, char2];
}

// Get random country from cities-by-country data
function getRandomCountry(citiesByCountry, usedCountries = []) {
  const availableCountries = Object.keys(citiesByCountry).filter(
    country => !usedCountries.includes(country)
  );
  
  if (availableCountries.length === 0) return null;
  
  return availableCountries[Math.floor(Math.random() * availableCountries.length)];
}

// Get two random cities from a country (excluding used city names)
function getTwoRandomCitiesFromCountry(country, citiesByCountry, usedCityNames = []) {
  const countryCities = citiesByCountry[country] || [];
  
  // Filter out used cities
  const availableCities = countryCities.filter(
    cityName => !usedCityNames.includes(cityName)
  );
  
  if (availableCities.length < 2) return null;
  
  // Get first city
  const city1Index = Math.floor(Math.random() * availableCities.length);
  const city1Name = availableCities[city1Index];
  
  // Get second city (different from first)
  const remainingCities = availableCities.filter((_, idx) => idx !== city1Index);
  if (remainingCities.length === 0) return null;
  
  const city2Index = Math.floor(Math.random() * remainingCities.length);
  const city2Name = remainingCities[city2Index];
  
  return [city1Name, city2Name];
}

// Get two random cities from two different countries
function getTwoCitiesFromDifferentCountries(citiesByCountry, citiesList) {
  const countries = Object.keys(citiesByCountry);
  if (countries.length < 2) return null;
  
  // Get first country and a random city from it
  const country1 = countries[Math.floor(Math.random() * countries.length)];
  const country1Cities = citiesByCountry[country1] || [];
  if (country1Cities.length === 0) return null;
  
  const city1Name = country1Cities[Math.floor(Math.random() * country1Cities.length)];
  const city1 = findCityByName(city1Name, citiesList);
  if (!city1 || !city1.imagePath) return null;
  
  // Get second country (different from first) and a random city from it
  const remainingCountries = countries.filter(c => c !== country1);
  if (remainingCountries.length === 0) return null;
  
  const country2 = remainingCountries[Math.floor(Math.random() * remainingCountries.length)];
  const country2Cities = citiesByCountry[country2] || [];
  if (country2Cities.length === 0) return null;
  
  const city2Name = country2Cities[Math.floor(Math.random() * country2Cities.length)];
  const city2 = findCityByName(city2Name, citiesList);
  if (!city2 || !city2.imagePath) return null;
  
  return [city1, city2];
}

// Find city data by name (case-insensitive, handles variations)
function findCityByName(cityName, citiesList) {
  // Try exact match first
  let city = citiesList.find(c => c.name === cityName);
  if (city) return city;
  
  // Try case-insensitive match
  city = citiesList.find(c => c.name.toLowerCase() === cityName.toLowerCase());
  if (city) return city;
  
  // Try matching without parentheses (e.g., "New York (NY)" matches "New York")
  const cleanName = cityName.replace(/\s*\([^)]+\)\s*/g, '').trim();
  city = citiesList.find(c => {
    const cleanCityName = c.name.replace(/\s*\([^)]+\)\s*/g, '').trim();
    return cleanCityName.toLowerCase() === cleanName.toLowerCase();
  });
  if (city) return city;
  
  // Try partial match (city name contains or is contained in search name)
  city = citiesList.find(c => {
    const cName = c.name.toLowerCase();
    const sName = cityName.toLowerCase();
    return cName.includes(sName) || sName.includes(cName);
  });
  
  return city || null;
}

// Validate image file before processing
async function validateImage(imagePath) {
  try {
    const metadata = await sharp(imagePath).metadata();
    return metadata.width > 0 && metadata.height > 0;
  } catch (error) {
    console.error(`Invalid image file: ${imagePath}`, error.message);
    return false;
  }
}

// Escape XML entities in text for SVG
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Create composite image with two characters/animes side by side
async function createCompositeImage(item1, item2, type = 'character', noLabels = false) {
  try {
    // Check if items exist and have imagePath
    if (!item1 || !item2 || !item1.imagePath || !item2.imagePath) {
      console.error('Missing item data or imagePath');
      return null;
    }
    
    const imagePath1 = path.join(__dirname, item1.imagePath);
    const imagePath2 = path.join(__dirname, item2.imagePath);
    
    if (!await fs.pathExists(imagePath1) || !await fs.pathExists(imagePath2)) {
      console.error(`Image file not found: ${imagePath1} or ${imagePath2}`);
      return null;
    }

    // Validate images before processing
    const isValid1 = await validateImage(imagePath1);
    const isValid2 = await validateImage(imagePath2);
    
    if (!isValid1 || !isValid2) {
      console.error(`Invalid image file detected: ${!isValid1 ? imagePath1 : imagePath2}`);
      return null;
    }

    const imageWidth = 300;
    const imageHeight = 400;
    const padding = 20;
    const vsWidth = 100;
    const totalWidth = imageWidth * 2 + vsWidth + padding * 4;
    const totalHeight = imageHeight + padding * 2 + 50;

    // Use 'contain' for cars to show the whole image, 'cover' for others to fill the space
    const fitMode = type === 'cars' ? 'contain' : 'cover';
    
    const img1Buffer = await sharp(imagePath1)
      .resize(imageWidth, imageHeight, { fit: fitMode })
      .toBuffer();
    
    const img2Buffer = await sharp(imagePath2)
      .resize(imageWidth, imageHeight, { fit: fitMode })
      .toBuffer();

    const vsSvg = Buffer.from(`
      <svg width="${vsWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="48" font-weight="bold" 
              fill="white" text-anchor="middle" dominant-baseline="middle">VS</text>
      </svg>
    `);

    const vsBuffer = await sharp(vsSvg).png().toBuffer();

    // Escape XML entities in names to prevent SVG parsing errors
    const name1Display = item1.name.length > 25 ? item1.name.substring(0, 25) + '...' : item1.name;
    const name2Display = item2.name.length > 25 ? item2.name.substring(0, 25) + '...' : item2.name;
    const escapedName1 = escapeXml(name1Display);
    const escapedName2 = escapeXml(name2Display);

    const name1Svg = Buffer.from(`
      <svg width="${imageWidth}" height="50" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#2f3136"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="20" font-weight="bold" 
              fill="white" text-anchor="middle" dominant-baseline="middle">${escapedName1}</text>
      </svg>
    `);

    const name2Svg = Buffer.from(`
      <svg width="${imageWidth}" height="50" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#2f3136"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="20" font-weight="bold" 
              fill="white" text-anchor="middle" dominant-baseline="middle">${escapedName2}</text>
      </svg>
    `);

    const name1Buffer = await sharp(name1Svg).png().toBuffer();
    const name2Buffer = await sharp(name2Svg).png().toBuffer();

    const background = sharp({
      create: {
        width: totalWidth,
        height: noLabels ? imageHeight + padding * 2 : totalHeight,
        channels: 3,
        background: { r: 47, g: 49, b: 54 }
      }
    });

    const compositePath = path.join(COMPOSITE_DIR, `${type}_${item1.id}_vs_${item2.id}.png`);
    
    const compositeItems = [
      { input: img1Buffer, left: padding, top: padding },
      { input: vsBuffer, left: imageWidth + padding * 2, top: padding },
      { input: img2Buffer, left: imageWidth + vsWidth + padding * 3, top: padding }
    ];
    
    // Only add name labels if not in no-labels mode
    if (!noLabels) {
      compositeItems.push(
        { input: name1Buffer, left: padding, top: imageHeight + padding },
        { input: name2Buffer, left: imageWidth + vsWidth + padding * 3, top: imageHeight + padding }
      );
    }
    
    await background
      .composite(compositeItems)
      .png()
      .toFile(compositePath);

    return compositePath;
  } catch (error) {
    console.error('Error creating composite image:', error);
    console.error(`Item1: ${item1?.name} (${item1?.imagePath}), Item2: ${item2?.name} (${item2?.imagePath})`);
    return null;
  }
}

// Delete composite image after it's been sent to Discord
async function cleanupCompositeImage(compositePath) {
  if (!compositePath) return;
  
  try {
    // Wait a bit to ensure Discord has received the image
    setTimeout(async () => {
      try {
        if (await fs.pathExists(compositePath)) {
          await fs.remove(compositePath);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }, 5000); // Wait 5 seconds before cleanup
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Create character duel message
async function createCharacterDuelMessage(char1, char2, userId, round) {
  const compositePath = await createCompositeImage(char1, char2, 'character');
  
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Character Duel - Round ${round} ⚔️`)
    .setDescription(`**${char1.name}** vs **${char2.name}**\n\nChoose the character with more favorites!`)
    .setColor(0x5865F2)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`duel_char_${userIdPrefix}${char1.id}_${char2.id}_left`)
          .setLabel(char1.name.length > 20 ? char1.name.substring(0, 20) + '...' : char1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⚔️'),
        new ButtonBuilder()
          .setCustomId(`duel_char_${userIdPrefix}${char1.id}_${char2.id}_right`)
          .setLabel(char2.name.length > 20 ? char2.name.substring(0, 20) + '...' : char2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⚔️')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create anime duel message
async function createAnimeDuelMessage(anime1, anime2, userId, round) {
  const compositePath = await createCompositeImage(anime1, anime2, 'anime');
  
  const embed = new EmbedBuilder()
    .setTitle(`🎌 Anime Duel - Round ${round} 🎌`)
    .setDescription(`**${anime1.name}** vs **${anime2.name}**\n\nChoose the anime with the better rank (lower number = better)!`)
    .setColor(0x9B59B6)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`duel_anime_${userIdPrefix}${anime1.id}_${anime2.id}_left`)
          .setLabel(anime1.name.length > 20 ? anime1.name.substring(0, 20) + '...' : anime1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎌'),
        new ButtonBuilder()
          .setCustomId(`duel_anime_${userIdPrefix}${anime1.id}_${anime2.id}_right`)
          .setLabel(anime2.name.length > 20 ? anime2.name.substring(0, 20) + '...' : anime2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎌')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create people duel message
async function createPeopleDuelMessage(person1, person2, userId) {
  const compositePath = await createCompositeImage(person1, person2, 'people');
  
  const embed = new EmbedBuilder()
    .setTitle(`👥 Who is More Famous? 👥`)
    .setDescription(`**${person1.name}** vs **${person2.name}**\n\nChoose the person who is more famous (lower rank number = more famous)!`)
    .setColor(0xFF6B6B)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`duel_people_${userIdPrefix}${person1.id}_${person2.id}_left`)
          .setLabel(person1.name.length > 20 ? person1.name.substring(0, 20) + '...' : person1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤'),
        new ButtonBuilder()
          .setCustomId(`duel_people_${userIdPrefix}${person1.id}_${person2.id}_right`)
          .setLabel(person2.name.length > 20 ? person2.name.substring(0, 20) + '...' : person2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create game duel message (shows title and year only, no rank)
async function createGameDuelMessage(game1, game2, userId, round) {
  // Validate games exist and have required properties
  if (!game1 || !game2 || !game1.name || !game2.name) {
    throw new Error('Invalid game data provided to createGameDuelMessage');
  }
  
  const compositePath = await createCompositeImage(game1, game2, 'games');
  
  const embed = new EmbedBuilder()
    .setTitle(`🎮 Game Duel - Round ${round} 🎮`)
    .setDescription(`**${game1.name}** (${game1.year || 'N/A'}) vs **${game2.name}** (${game2.year || 'N/A'})\n\nWhich game has a better Metacritic score?`)
    .setColor(0x4ECDC4)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    const label1 = `${game1.name} (${game1.year})`;
    const label2 = `${game2.name} (${game2.year})`;
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: dg_{userId}_{rank1}_{rank2}_{side} (dg = duel games)
    const customIdLeft = `dg_${userId || '0'}_${game1.rank}_${game2.rank}_l`;
    const customIdRight = `dg_${userId || '0'}_${game1.rank}_${game2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(label1.length > 20 ? label1.substring(0, 20) + '...' : label1)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎮'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(label2.length > 20 ? label2.substring(0, 20) + '...' : label2)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎮')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create movie duel message
async function createMovieDuelMessage(movie1, movie2, userId, round) {
  // Validate movies exist and have required properties
  if (!movie1 || !movie2 || !movie1.name || !movie2.name) {
    throw new Error('Invalid movie data provided to createMovieDuelMessage');
  }
  
  const compositePath = await createCompositeImage(movie1, movie2, 'movies');
  
  const embed = new EmbedBuilder()
    .setTitle(`🎬 Movie Duel - Round ${round} 🎬`)
    .setDescription(`**${movie1.name}** (${movie1.year || 'N/A'}) vs **${movie2.name}** (${movie2.year || 'N/A'})\n\nChoose the movie that made more box office!`)
    .setColor(0xFF6B9D)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Create labels with year - ensure year is always visible
    const year1 = movie1.year || 'N/A';
    const year2 = movie2.year || 'N/A';
    const label1 = `${movie1.name} (${year1})`;
    const label2 = `${movie2.name} (${year2})`;
    
    // Truncate labels but try to keep the year visible
    const truncateLabel = (label, year) => {
      if (label.length <= 20) return label;
      // Try to keep year visible: truncate name, keep " (YYYY)"
      const yearPart = ` (${year})`;
      const maxNameLength = 20 - yearPart.length;
      if (maxNameLength > 0) {
        const name = label.substring(0, label.indexOf(' ('));
        return name.substring(0, maxNameLength) + '...' + yearPart;
      }
      // If year is too long, just truncate normally
      return label.substring(0, 17) + '...';
    };
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: dm_{userId}_{rank1}_{rank2}_{side} (dm = duel movies)
    const customIdLeft = `dm_${userId || '0'}_${movie1.rank}_${movie2.rank}_l`;
    const customIdRight = `dm_${userId || '0'}_${movie1.rank}_${movie2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(truncateLabel(label1, year1))
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎬'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(truncateLabel(label2, year2))
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎬')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create city duel message
async function createCityDuelMessage(city1, city2, userId, round) {
  // Validate cities exist and have required properties
  if (!city1 || !city2 || !city1.name || !city2.name) {
    throw new Error('Invalid city data provided to createCityDuelMessage');
  }
  
  const compositePath = await createCompositeImage(city1, city2, 'cities');
  
  const embed = new EmbedBuilder()
    .setTitle(`🏙️ City Duel - Round ${round} 🏙️`)
    .setDescription(`**${city1.name}**${city1.country ? `, ${city1.country}` : ''} vs **${city2.name}**${city2.country ? `, ${city2.country}` : ''}\n\nChoose the city with more population!`)
    .setColor(0x00D4FF)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Create labels with country
    const label1 = city1.country ? `${city1.name}, ${city1.country}` : city1.name;
    const label2 = city2.country ? `${city2.name}, ${city2.country}` : city2.name;
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: dc_{userId}_{rank1}_{rank2}_{side} (dc = duel cities)
    const customIdLeft = `dc_${userId || '0'}_${city1.rank}_${city2.rank}_l`;
    const customIdRight = `dc_${userId || '0'}_${city1.rank}_${city2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(label1.length > 20 ? label1.substring(0, 20) + '...' : label1)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🏙️'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(label2.length > 20 ? label2.substring(0, 20) + '...' : label2)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🏙️')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create Epic7 duel message
async function createEpic7DuelMessage(char1, char2, userId, round) {
  // Validate characters exist and have required properties
  if (!char1 || !char2 || !char1.name || !char2.name) {
    throw new Error('Invalid Epic7 character data provided to createEpic7DuelMessage');
  }
  
  const compositePath = await createCompositeImage(char1, char2, 'epic7');
  
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Epic7 Duel - Round ${round} ⚔️`)
    .setDescription(`**${char1.name}** vs **${char2.name}**\n\nWho has a better RTA winrate?`)
    .setColor(0xFF6B35)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: de_{userId}_{rank1}_{rank2}_{side} (de = duel epic7)
    const customIdLeft = `de_${userId || '0'}_${char1.rank}_${char2.rank}_l`;
    const customIdRight = `de_${userId || '0'}_${char1.rank}_${char2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(char1.name.length > 20 ? char1.name.substring(0, 20) + '...' : char1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⚔️'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(char2.name.length > 20 ? char2.name.substring(0, 20) + '...' : char2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('⚔️')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create Instagram duel message
async function createInstagramDuelMessage(influencer1, influencer2, userId, round) {
  // Validate influencers exist and have required properties
  if (!influencer1 || !influencer2 || !influencer1.name || !influencer2.name) {
    throw new Error('Invalid Instagram influencer data provided to createInstagramDuelMessage');
  }
  
  const compositePath = await createCompositeImage(influencer1, influencer2, 'instagram');
  
  const embed = new EmbedBuilder()
    .setTitle(`📱 Instagram Duel - Round ${round} 📱`)
    .setDescription(`**${influencer1.name}** vs **${influencer2.name}**\n\nWho has more followers?`)
    .setColor(0xE4405F)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: di8_{userId}_{rank1}_{rank2}_{side} (di8 = duel instagram 8)
    const customIdLeft = `di8_${userId || '0'}_${influencer1.rank}_${influencer2.rank}_l`;
    const customIdRight = `di8_${userId || '0'}_${influencer1.rank}_${influencer2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(influencer1.name.length > 20 ? influencer1.name.substring(0, 20) + '...' : influencer1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📱'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(influencer2.name.length > 20 ? influencer2.name.substring(0, 20) + '...' : influencer2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📱')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create car duel message
async function createCarDuelMessage(car1, car2, userId, round) {
  // Validate cars exist and have required properties
  if (!car1 || !car2 || !car1.name || !car2.name) {
    throw new Error('Invalid car data provided to createCarDuelMessage');
  }
  
  const compositePath = await createCompositeImage(car1, car2, 'cars');
  
  const embed = new EmbedBuilder()
    .setTitle(`🚗 Car Duel - Round ${round} 🚗`)
    .setDescription(`**${car1.name}** vs **${car2.name}**\n\nWhich car has a higher top speed?`)
    .setColor(0xFF6B35)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Use shorter custom IDs to stay under Discord's 100 character limit
    // Format: dc9_{userId}_{rank1}_{rank2}_{side} (dc9 = duel cars 9)
    const customIdLeft = `dc9_${userId || '0'}_${car1.rank}_${car2.rank}_l`;
    const customIdRight = `dc9_${userId || '0'}_${car1.rank}_${car2.rank}_r`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(car1.name.length > 20 ? car1.name.substring(0, 20) + '...' : car1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🚗'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(car2.name.length > 20 ? car2.name.substring(0, 20) + '...' : car2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🚗')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath // Store path for cleanup
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create show duel message
async function createShowDuelMessage(show1, show2, userId, round) {
  if (!show1 || !show2 || !show1.name || !show2.name) {
    throw new Error('Invalid show data provided to createShowDuelMessage');
  }

  const compositePath = await createCompositeImage(show1, show2, 'shows');

  const embed = new EmbedBuilder()
    .setTitle(`📺 Show Duel - Round ${round} 📺`)
    .setDescription(`**${show1.name}** vs **${show2.name}**\n\nWhat show is better rated?`)
    .setColor(0x3498DB)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';

  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');

    // Format: dtv_{userId}_{rank1}_{rank2}_{side} (dtv = duel TV shows)
    const customIdLeft = `dtv_${userId || '0'}_${show1.rank}_${show2.rank}_l`;
    const customIdRight = `dtv_${userId || '0'}_${show1.rank}_${show2.rank}_r`;

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdLeft)
          .setLabel(show1.name.length > 20 ? show1.name.substring(0, 20) + '...' : show1.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📺'),
        new ButtonBuilder()
          .setCustomId(customIdRight)
          .setLabel(show2.name.length > 20 ? show2.name.substring(0, 20) + '...' : show2.name)
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📺')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Create city identification duel message (without names on images)
async function createCityIdentificationDuelMessage(city1, city2, correctCityName, userId, round) {
  // Validate cities exist and have required properties
  if (!city1 || !city2 || !city1.name || !city2.name || !correctCityName) {
    throw new Error('Invalid city data provided to createCityIdentificationDuelMessage');
  }
  
  // Create composite image without text labels (just images)
  const compositePath = await createCompositeImage(city1, city2, 'cities', true); // true = no text labels
  
  const embed = new EmbedBuilder()
    .setTitle(`🌍 City Identification - Round ${round} 🌍`)
    .setDescription(`Which one of these cities is **${correctCityName}**?`)
    .setColor(0x00D4FF)
    .setTimestamp();

  const userIdPrefix = userId ? `${userId}_` : '';
  
  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    
    // Use custom IDs: di7_{userId}_{city1Id}_{city2Id}_{correctCityName}_{a/b} (di7 = duel identification 7)
    // Button A always corresponds to city1 (left image), Button B always corresponds to city2 (right image)
    // The last part (_a or _b) indicates which button was clicked
    // Button A = city1 (left) = ends with _a
    // Button B = city2 (right) = ends with _b
    const customIdA = `di7_${userId || '0'}_${city1.id}_${city2.id}_${encodeURIComponent(correctCityName)}_a`;
    const customIdB = `di7_${userId || '0'}_${city1.id}_${city2.id}_${encodeURIComponent(correctCityName)}_b`;
    
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(customIdA)
          .setLabel('Choice A')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🇦'),
        new ButtonBuilder()
          .setCustomId(customIdB)
          .setLabel('Choice B')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🇧')
      );

    return {
      embeds: [embed],
      components: [row],
      files: [attachment],
      _compositePath: compositePath,
      _correctCity: correctCityName,
      _city1: city1,
      _city2: city2
    };
  }

  return {
    embeds: [embed],
    components: []
  };
}

// Handle duel choice
async function handleDuelChoice(interaction, selectedId, leftId, rightId, characters, animeList, peopleList, gamesList, moviesList, showsList, citiesList, epic7List, citiesByCountry, instagramList, carsList, userStreaks, expectedUserId = null, duelType = 'char') {
  // Check user
  if (expectedUserId && interaction.user.id !== expectedUserId) {
    return interaction.reply({ 
      content: '❌ This duel was started by someone else! Use `!duel` to start your own game.', 
      ephemeral: true 
    });
  }

  const userId = interaction.user.id;
  if (!userStreaks[userId]) {
    userStreaks[userId] = {
      currentStreak: 0,
      round: 1,
      winner: null,
      usedCharacterIds: [],
      usedAnimeIds: [],
      usedPeopleIds: [],
      usedGameIds: [],
      usedMovieIds: [],
      usedShowIds: [],
      usedCityIds: [],
      usedEpic7Ids: [],
      usedInstagramIds: [],
      usedCarIds: []
    };
  }

  const session = userStreaks[userId];
  const selected = selectedId === leftId ? leftId : rightId;

  if (duelType === 'char') {
    // Character duel
    const leftChar = characters.find(c => c.id === leftId);
    const rightChar = characters.find(c => c.id === rightId);
    
    if (!leftChar || !rightChar) {
      return interaction.reply({ content: '❌ Error: Character not found!', ephemeral: true });
    }

    const winner = leftChar.favorites > rightChar.favorites ? leftChar : rightChar;
    const loser = winner.id === leftChar.id ? rightChar : leftChar;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedCharacterIds) {
        session.usedCharacterIds = [];
      }
      session.usedCharacterIds.push(leftChar.id, rightChar.id);

      // Update winner FIRST before determining next round
      session.winner = winner;

      // Determine next round:
      // - First round: 2 random characters
      // - Every 4th round (4, 8, 12...): hard mode (10–20% diff)
      // - Every 5th round (5, 10, 15...): reset with 2 random characters
      session.round++;

      let nextDuel;

      if (session.round % 5 === 0) {
        // Every 5th round: reset – 2 random characters, no carry-over winner
        const chars = getTwoRandomCharacters(characters, session.usedCharacterIds);
        if (!chars) {
          return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
        }
        nextDuel = await createCharacterDuelMessage(chars[0], chars[1], userId, session.round);
        session.usedCharacterIds.push(chars[0].id, chars[1].id);
        session.winner = null;
      } else if (session.round % 4 === 0) {
        // Every 4th round: hard mode – 10–20% favorites difference
        if (!session.winner) {
          const chars = getTwoRandomCharacters(characters, session.usedCharacterIds);
          if (!chars) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createCharacterDuelMessage(chars[0], chars[1], userId, session.round);
          session.usedCharacterIds.push(chars[0].id, chars[1].id);
        } else {
          const hardChar = getCharacterWithDifference(session.winner, characters, session.usedCharacterIds);
          if (!hardChar) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createCharacterDuelMessage(session.winner, hardChar, userId, session.round);
          session.usedCharacterIds.push(hardChar.id);
        }
      } else if (session.round === 1) {
        // Round 1: 2 random characters
        const chars = getTwoRandomCharacters(characters, session.usedCharacterIds);
        if (!chars) {
          return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
        }
        nextDuel = await createCharacterDuelMessage(chars[0], chars[1], userId, session.round);
        session.usedCharacterIds.push(chars[0].id, chars[1].id);
      } else {
        // Normal rounds: previous winner vs random new character
        if (!session.winner) {
          const chars = getTwoRandomCharacters(characters, session.usedCharacterIds);
          if (!chars) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createCharacterDuelMessage(chars[0], chars[1], userId, session.round);
          session.usedCharacterIds.push(chars[0].id, chars[1].id);
        } else {
          const newChar = getRandomCharacter(characters, session.usedCharacterIds);
          if (!newChar) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createCharacterDuelMessage(session.winner, newChar, userId, session.round);
          session.usedCharacterIds.push(newChar.id);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** has ${winner.favorites.toLocaleString()} favorites!\n**${loser.name}** has ${loser.favorites.toLocaleString()} favorites.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'anime');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** has ${winner.favorites.toLocaleString()} favorites!\n**${loser.name}** has ${loser.favorites.toLocaleString()} favorites.\n\nYou selected **${selected === leftId ? leftChar.name : rightChar.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'anime') {
    // Anime duel
    const leftAnime = animeList.find(a => a.id === leftId);
    const rightAnime = animeList.find(a => a.id === rightId);
    
    if (!leftAnime || !rightAnime) {
      return interaction.reply({ content: '❌ Error: Anime not found!', ephemeral: true });
    }

    // Lower rank number wins
    const winner = leftAnime.rank < rightAnime.rank ? leftAnime : rightAnime;
    const loser = winner.id === leftAnime.id ? rightAnime : leftAnime;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      session.usedAnimeIds.push(leftAnime.id, rightAnime.id);

      // Reset cycle - go back to round 1
      session.round = 1;
      session.winner = null;

      // Round 1: 2 random characters
      const chars = getTwoRandomCharacters(characters, session.usedCharacterIds);
      if (!chars) {
        return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
      }
      const nextDuel = await createCharacterDuelMessage(chars[0], chars[1], userId, session.round);
      session.usedCharacterIds.push(chars[0].id, chars[1].id);

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** is ranked #${winner.rank}!\n**${loser.name}** is ranked #${loser.rank}.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**New Cycle - Round 1!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'anime');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** is ranked #${winner.rank}!\n**${loser.name}** is ranked #${loser.rank}.\n\nYou selected **${selected === leftId ? leftAnime.name : rightAnime.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'people') {
    // People duel
    const leftPerson = peopleList.find(p => p.id === leftId);
    const rightPerson = peopleList.find(p => p.id === rightId);
    
    if (!leftPerson || !rightPerson) {
      return interaction.reply({ content: '❌ Error: Person not found!', ephemeral: true });
    }

    // Lower rank number wins (more famous)
    const winner = leftPerson.rank < rightPerson.rank ? leftPerson : rightPerson;
    const loser = winner.id === leftPerson.id ? rightPerson : leftPerson;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedPeopleIds) {
        session.usedPeopleIds = [];
      }
      session.usedPeopleIds.push(leftPerson.id, rightPerson.id);

      // Get next 2 random people
      const [nextPerson1, nextPerson2] = getTwoRandomPeople(peopleList, session.usedPeopleIds);
      if (!nextPerson1 || !nextPerson2) {
        return interaction.reply({ content: '❌ Not enough people available!', ephemeral: true });
      }
      session.usedPeopleIds.push(nextPerson1.id, nextPerson2.id);
      const nextDuel = await createPeopleDuelMessage(nextPerson1, nextPerson2, userId);

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** is ranked #${winner.rank}!\n**${loser.name}** is ranked #${loser.rank}.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Next Round!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'people');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** is ranked #${winner.rank}!\n**${loser.name}** is ranked #${loser.rank}.\n\nYou selected **${selected === leftId ? leftPerson.name : rightPerson.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'games') {
    // Games duel
    const leftGame = gamesList.find(g => g.id === leftId);
    const rightGame = gamesList.find(g => g.id === rightId);
    
    if (!leftGame || !rightGame) {
      return interaction.reply({ content: '❌ Error: Game not found!', ephemeral: true });
    }

    // Higher Metacritic score wins (better score)
    // Handle games without Metacritic scores
    const leftScore = leftGame.metacriticScore !== undefined && leftGame.metacriticScore !== null ? leftGame.metacriticScore : -1;
    const rightScore = rightGame.metacriticScore !== undefined && rightGame.metacriticScore !== null ? rightGame.metacriticScore : -1;
    
    if (leftScore === -1 && rightScore === -1) {
      return interaction.reply({ content: '❌ Error: Both games are missing Metacritic scores!', ephemeral: true });
    }
    
    const winner = leftScore > rightScore ? leftGame : rightGame;
    const loser = winner.id === leftGame.id ? rightGame : leftGame;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedGameIds) {
        session.usedGameIds = [];
      }
      session.usedGameIds.push(leftGame.id, rightGame.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      
      // Determine next round (cycles 1-5)
      // Round 4 is hard mode (±2 Metacritic score), Round 5 resets to 2 random games
      session.round = (session.round % 5) + 1;
      
      let nextDuel;
      
      if (session.round === 1) {
        // Round 1: 2 random games
        const games = getTwoRandomGames(gamesList, session.usedGameIds);
        if (!games) {
          return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
        }
        nextDuel = await createGameDuelMessage(games[0], games[1], userId, session.round);
        session.usedGameIds.push(games[0].id, games[1].id);
        // Winner already updated above
      } else if (session.round >= 2 && session.round <= 3) {
        // Round 2-3: Previous winner vs random (with different Metacritic score)
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random games if winner is invalid
          const games = getTwoRandomGames(gamesList, session.usedGameIds);
          if (!games) {
            return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
          }
          nextDuel = await createGameDuelMessage(games[0], games[1], userId, session.round);
          session.usedGameIds.push(games[0].id, games[1].id);
          // Winner already updated above
        } else {
          // Get a random game with different Metacritic score
          const winnerScore = session.winner.metacriticScore;
          const availableGames = gamesList.filter(g => 
            !session.usedGameIds.includes(g.id) && 
            g.id !== session.winner.id &&
            g.imagePath && 
            g.metacriticScore !== undefined && 
            g.metacriticScore !== null &&
            g.metacriticScore !== winnerScore // Different score
          );
          
          if (availableGames.length === 0) {
            // Fallback to any game if no different scores available
            const newGame = getRandomGame(gamesList, session.usedGameIds);
            if (!newGame) {
              return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
            }
            nextDuel = await createGameDuelMessage(session.winner, newGame, userId, session.round);
            session.usedGameIds.push(newGame.id);
          } else {
            const newGame = availableGames[Math.floor(Math.random() * availableGames.length)];
            nextDuel = await createGameDuelMessage(session.winner, newGame, userId, session.round);
            session.usedGameIds.push(newGame.id);
          }
          // Winner already updated above
        }
      } else if (session.round === 4) {
        // Round 4: Hard matchup - ±2 Metacritic score
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random games if winner is invalid
          const games = getTwoRandomGames(gamesList, session.usedGameIds);
          if (!games) {
            return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
          }
          nextDuel = await createGameDuelMessage(games[0], games[1], userId, session.round);
          session.usedGameIds.push(games[0].id, games[1].id);
          // Winner already updated above
        } else {
          const hardGame = getGameWithRankDifference(session.winner, gamesList, session.usedGameIds);
          if (!hardGame) {
            return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
          }
          nextDuel = await createGameDuelMessage(session.winner, hardGame, userId, session.round);
          session.usedGameIds.push(hardGame.id);
          // Winner already updated above
        }
      } else if (session.round === 5) {
        // Round 5: Reset round - 2 random games (don't carry winner to prevent infinite streaks)
        const games = getTwoRandomGames(gamesList, session.usedGameIds);
        if (!games) {
          return interaction.reply({ content: '❌ Not enough games available!', ephemeral: true });
        }
        nextDuel = await createGameDuelMessage(games[0], games[1], userId, session.round);
        session.usedGameIds.push(games[0].id, games[1].id);
        session.winner = null; // Reset winner - next round will be round 1 with 2 random games
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** has more!\n**${loser.name}** has less.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'games');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** has more!\n**${loser.name}** has less.\n\nYou selected **${selected === leftId ? leftGame.name : rightGame.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'movies') {
    // Movies duel
    const leftMovie = moviesList.find(m => m.id === leftId);
    const rightMovie = moviesList.find(m => m.id === rightId);
    
    if (!leftMovie || !rightMovie) {
      return interaction.reply({ content: '❌ Error: Movie not found!', ephemeral: true });
    }

    // Lower rank number wins (more box office)
    const winner = leftMovie.rank < rightMovie.rank ? leftMovie : rightMovie;
    const loser = winner.id === leftMovie.id ? rightMovie : leftMovie;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedMovieIds) {
        session.usedMovieIds = [];
      }
      session.usedMovieIds.push(leftMovie.id, rightMovie.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      
      // Determine next round (cycles 1-5)
      // Round 4 is hard mode (±5 ranks), Round 5 resets to 2 random movies
      session.round = (session.round % 5) + 1;
      
      let nextDuel;
      
      if (session.round === 1) {
        // Round 1: 2 random movies
        const movies = getTwoRandomMovies(moviesList, session.usedMovieIds);
        if (!movies) {
          return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
        }
        nextDuel = await createMovieDuelMessage(movies[0], movies[1], userId, session.round);
        session.usedMovieIds.push(movies[0].id, movies[1].id);
        // Winner will be set from this round's result
      } else if (session.round >= 2 && session.round <= 3) {
        // Round 2-3: Previous winner vs random
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random movies if winner is invalid
          const movies = getTwoRandomMovies(moviesList, session.usedMovieIds);
          if (!movies) {
            return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
          }
          nextDuel = await createMovieDuelMessage(movies[0], movies[1], userId, session.round);
          session.usedMovieIds.push(movies[0].id, movies[1].id);
          // Winner already updated above
        } else {
          const newMovie = getRandomMovie(moviesList, session.usedMovieIds);
          if (!newMovie) {
            return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
          }
          nextDuel = await createMovieDuelMessage(session.winner, newMovie, userId, session.round);
          session.usedMovieIds.push(newMovie.id);
          // Winner already updated above
        }
      } else if (session.round === 4) {
        // Round 4: Hard matchup - ±5 ranks
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random movies if winner is invalid
          const movies = getTwoRandomMovies(moviesList, session.usedMovieIds);
          if (!movies) {
            return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
          }
          nextDuel = await createMovieDuelMessage(movies[0], movies[1], userId, session.round);
          session.usedMovieIds.push(movies[0].id, movies[1].id);
          // Winner already updated above
        } else {
          const hardMovie = getMovieWithRankDifference(session.winner, moviesList, session.usedMovieIds);
          if (!hardMovie) {
            return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
          }
          nextDuel = await createMovieDuelMessage(session.winner, hardMovie, userId, session.round);
          session.usedMovieIds.push(hardMovie.id);
          // Winner already updated above
        }
      } else if (session.round === 5) {
        // Round 5: Reset round - 2 random movies (don't carry winner)
        const movies = getTwoRandomMovies(moviesList, session.usedMovieIds);
        if (!movies) {
          return interaction.reply({ content: '❌ Not enough movies available!', ephemeral: true });
        }
        nextDuel = await createMovieDuelMessage(movies[0], movies[1], userId, session.round);
        session.usedMovieIds.push(movies[0].id, movies[1].id);
        session.winner = null; // Reset winner - next round will be round 1 with 2 random movies
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** made more!\n**${loser.name}** made less.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'movies');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** made more!\n**${loser.name}** made less.\n\nYou selected **${selected === leftId ? leftMovie.name : rightMovie.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'cities') {
    // Cities duel
    const leftCity = citiesList.find(c => c.id === leftId);
    const rightCity = citiesList.find(c => c.id === rightId);
    
    if (!leftCity || !rightCity) {
      return interaction.reply({ content: '❌ Error: City not found!', ephemeral: true });
    }

    // Lower rank number wins (more population)
    const winner = leftCity.rank < rightCity.rank ? leftCity : rightCity;
    const loser = winner.id === leftCity.id ? rightCity : leftCity;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedCityIds) {
        session.usedCityIds = [];
      }
      session.usedCityIds.push(leftCity.id, rightCity.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      
      // Determine next round
      // Round 4, 8, 12... (every 4th): Hard mode (±5 ranks)
      // Round 5, 10, 15... (every 5th): Reset (2 random cities)
      session.round++;
      
      let nextDuel;
      
      if (session.round % 5 === 0) {
        // Every 5th round: Reset - 2 random cities
        const cities = getTwoRandomCities(citiesList, session.usedCityIds);
        if (!cities) {
          return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
        }
        nextDuel = await createCityDuelMessage(cities[0], cities[1], userId, session.round);
        session.usedCityIds.push(cities[0].id, cities[1].id);
        session.winner = null; // Reset winner
      } else if (session.round % 4 === 0) {
        // Every 4th round: Hard mode - ±5 ranks
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random cities if winner is invalid
          const cities = getTwoRandomCities(citiesList, session.usedCityIds);
          if (!cities) {
            return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
          }
          nextDuel = await createCityDuelMessage(cities[0], cities[1], userId, session.round);
          session.usedCityIds.push(cities[0].id, cities[1].id);
        } else {
          const hardCity = getCityWithRankDifference(session.winner, citiesList, session.usedCityIds);
          if (!hardCity) {
            return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
          }
          nextDuel = await createCityDuelMessage(session.winner, hardCity, userId, session.round);
          session.usedCityIds.push(hardCity.id);
        }
      } else if (session.round === 1) {
        // Round 1: 2 random cities
        const cities = getTwoRandomCities(citiesList, session.usedCityIds);
        if (!cities) {
          return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
        }
        nextDuel = await createCityDuelMessage(cities[0], cities[1], userId, session.round);
        session.usedCityIds.push(cities[0].id, cities[1].id);
      } else {
        // Round 2-3, 6-7, 11-12, etc.: Previous winner vs random
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random cities if winner is invalid
          const cities = getTwoRandomCities(citiesList, session.usedCityIds);
          if (!cities) {
            return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
          }
          nextDuel = await createCityDuelMessage(cities[0], cities[1], userId, session.round);
          session.usedCityIds.push(cities[0].id, cities[1].id);
        } else {
          const newCity = getRandomCity(citiesList, session.usedCityIds);
          if (!newCity) {
            return interaction.reply({ content: '❌ Not enough cities available!', ephemeral: true });
          }
          nextDuel = await createCityDuelMessage(session.winner, newCity, userId, session.round);
          session.usedCityIds.push(newCity.id);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** has more population!\n**${loser.name}** has less population.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'cities');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedCityIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** has more population!\n**${loser.name}** has less population.\n\nYou selected **${selected === leftId ? leftCity.name : rightCity.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'epic7') {
    // Epic7 duel
    const leftChar = epic7List.find(c => c.id === leftId);
    const rightChar = epic7List.find(c => c.id === rightId);
    
    if (!leftChar || !rightChar) {
      return interaction.reply({ content: '❌ Error: Character not found!', ephemeral: true });
    }

    // Higher winrate wins (better RTA winrate)
    const winner = leftChar.winrate > rightChar.winrate ? leftChar : rightChar;
    const loser = winner.id === leftChar.id ? rightChar : leftChar;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedEpic7Ids) {
        session.usedEpic7Ids = [];
      }
      session.usedEpic7Ids.push(leftChar.id, rightChar.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      
      // Determine next round (cycles 1-5)
      // Round 5 resets to 2 random characters
      session.round = (session.round % 5) + 1;
      
      let nextDuel;
      
      if (session.round === 1) {
        // Round 1: 2 random characters
        const chars = getTwoRandomEpic7(epic7List, session.usedEpic7Ids);
        if (!chars) {
          return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
        }
        nextDuel = await createEpic7DuelMessage(chars[0], chars[1], userId, session.round);
        session.usedEpic7Ids.push(chars[0].id, chars[1].id);
      } else if (session.round >= 2 && session.round <= 4) {
        // Round 2-4: Previous winner vs random
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random characters if winner is invalid
          const chars = getTwoRandomEpic7(epic7List, session.usedEpic7Ids);
          if (!chars) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createEpic7DuelMessage(chars[0], chars[1], userId, session.round);
          session.usedEpic7Ids.push(chars[0].id, chars[1].id);
        } else {
          const newChar = getRandomEpic7(epic7List, session.usedEpic7Ids);
          if (!newChar) {
            return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
          }
          nextDuel = await createEpic7DuelMessage(session.winner, newChar, userId, session.round);
          session.usedEpic7Ids.push(newChar.id);
        }
      } else if (session.round === 5) {
        // Round 5: Reset round - 2 random characters (don't carry winner)
        const chars = getTwoRandomEpic7(epic7List, session.usedEpic7Ids);
        if (!chars) {
          return interaction.reply({ content: '❌ Not enough characters available!', ephemeral: true });
        }
        nextDuel = await createEpic7DuelMessage(chars[0], chars[1], userId, session.round);
        session.usedEpic7Ids.push(chars[0].id, chars[1].id);
        session.winner = null; // Reset winner - next round will be round 1 with 2 random characters
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${leftChar.name}** has ${leftChar.winrate}% winrate!\n**${rightChar.name}** has ${rightChar.winrate}% winrate.\n\n**${winner.name}** wins with ${winner.winrate}% winrate!\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'epic7');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedCityIds: [],
        usedEpic7Ids: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${leftChar.name}** has ${leftChar.winrate}% winrate!\n**${rightChar.name}** has ${rightChar.winrate}% winrate.\n\n**${winner.name}** wins with ${winner.winrate}% winrate!\n\nYou selected **${selected === leftId ? leftChar.name : rightChar.name}** (${selected === leftId ? leftChar.winrate : rightChar.winrate}% winrate).\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'cityid') {
    // City identification duel
    const leftCity = citiesList.find(c => c.id === leftId);
    const rightCity = citiesList.find(c => c.id === rightId);
    
    if (!leftCity || !rightCity) {
      return interaction.reply({ content: '❌ Error: City not found!', ephemeral: true });
    }

    // Parse the button ID to get the correct answer
    // Format: di7_{userId}_{city1Id}_{city2Id}_{correctCityName}_{a/b}
    const customIdParts = interaction.customId.split('_');
    const correctCityName = decodeURIComponent(customIdParts[4]);
    const clickedButton = customIdParts[5]; // 'a' or 'b' - indicates which button was clicked
    
    // Determine which city is correct
    const isCity1Correct = leftCity.name === correctCityName || 
                          leftCity.name.toLowerCase() === correctCityName.toLowerCase() ||
                          leftCity.name.replace(/\s*\([^)]+\)\s*/g, '').trim().toLowerCase() === correctCityName.replace(/\s*\([^)]+\)\s*/g, '').trim().toLowerCase();
    
    const correctCity = isCity1Correct ? leftCity : rightCity;
    
    // Verify button mapping: Button A (_a) = city1 (leftId), Button B (_b) = city2 (rightId)
    // selected should already be set correctly from index.js parsing
    const userSelectedCorrect = (selected === leftId && isCity1Correct) || (selected === rightId && !isCity1Correct);
    const userSelectedA = clickedButton === 'a'; // Use the button indicator directly instead of selected === leftId

    if (userSelectedCorrect) {
      session.currentStreak++;
      session.round++;
      
      // Get next round: 2 cities from 2 different countries
      const nextCities = getTwoCitiesFromDifferentCountries(citiesByCountry, citiesList);
      
      if (!nextCities) {
        // Couldn't find cities, end game
        const finalStreak = session.currentStreak;
        await saveToRanking(userId, interaction.user.username, finalStreak, 'cityid');
        
        const embed = new EmbedBuilder()
          .setTitle('🎉 Perfect Game!')
          .setDescription(`You've identified all cities correctly!\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
          .setColor(0x57F287)
          .setTimestamp();
        
        await interaction.update({
          embeds: [embed],
          components: []
        });
        
        // Reset session
        userStreaks[userId] = {
          currentStreak: 0,
          round: 1,
          winner: null,
          usedCharacterIds: [],
          usedAnimeIds: [],
          usedPeopleIds: [],
          usedGameIds: [],
          usedMovieIds: [],
          usedCityIds: [],
          usedEpic7Ids: []
        };
        return;
      }
      
      const [nextCity1, nextCity2] = nextCities;
      
      // Randomly pick which city to ask about
      const nextCorrectCity = Math.random() < 0.5 ? nextCity1 : nextCity2;
      const nextDuel = await createCityIdentificationDuelMessage(nextCity1, nextCity2, nextCorrectCity.name, userId, session.round);

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${correctCity.name}** is correct!\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'cityid');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedCityIds: [],
        usedEpic7Ids: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${correctCity.name}** is the correct answer!\n\nYou selected **${userSelectedA ? 'Choice A' : 'Choice B'}** (${userSelectedA ? leftCity.name : rightCity.name}).\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'instagram') {
    // Instagram duel
    const leftInfluencer = instagramList.find(i => i.id === leftId);
    const rightInfluencer = instagramList.find(i => i.id === rightId);
    
    if (!leftInfluencer || !rightInfluencer) {
      return interaction.reply({ content: '❌ Error: Instagram influencer not found!', ephemeral: true });
    }

    // Higher followers wins (more followers)
    const winner = leftInfluencer.followers > rightInfluencer.followers ? leftInfluencer : rightInfluencer;
    const loser = winner.id === leftInfluencer.id ? rightInfluencer : leftInfluencer;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedInstagramIds) {
        session.usedInstagramIds = [];
      }
      session.usedInstagramIds.push(leftInfluencer.id, rightInfluencer.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      
      // Determine next round (cycles 1-5)
      // Round 4 is hard mode (±5 ranks), Round 5 resets to 2 random influencers
      session.round = (session.round % 5) + 1;
      
      let nextDuel;
      
      if (session.round === 1) {
        // Round 1: 2 random influencers
        const influencers = getTwoRandomInstagramers(instagramList, session.usedInstagramIds);
        if (!influencers) {
          return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
        }
        nextDuel = await createInstagramDuelMessage(influencers[0], influencers[1], userId, session.round);
        session.usedInstagramIds.push(influencers[0].id, influencers[1].id);
      } else if (session.round >= 2 && session.round <= 3) {
        // Round 2-3: Previous winner vs random
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random influencers if winner is invalid
          const influencers = getTwoRandomInstagramers(instagramList, session.usedInstagramIds);
          if (!influencers) {
            return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
          }
          nextDuel = await createInstagramDuelMessage(influencers[0], influencers[1], userId, session.round);
          session.usedInstagramIds.push(influencers[0].id, influencers[1].id);
        } else {
          const newInfluencer = getRandomInstagramer(instagramList, session.usedInstagramIds);
          if (!newInfluencer) {
            return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
          }
          nextDuel = await createInstagramDuelMessage(session.winner, newInfluencer, userId, session.round);
          session.usedInstagramIds.push(newInfluencer.id);
        }
      } else if (session.round === 4) {
        // Round 4: Hard matchup - ±5 ranks
        if (!session.winner || !session.winner.imagePath) {
          // Fallback to 2 random influencers if winner is invalid
          const influencers = getTwoRandomInstagramers(instagramList, session.usedInstagramIds);
          if (!influencers) {
            return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
          }
          nextDuel = await createInstagramDuelMessage(influencers[0], influencers[1], userId, session.round);
          session.usedInstagramIds.push(influencers[0].id, influencers[1].id);
        } else {
          const hardInfluencer = getInstagramerWithRankDifference(session.winner, instagramList, session.usedInstagramIds);
          if (!hardInfluencer) {
            return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
          }
          nextDuel = await createInstagramDuelMessage(session.winner, hardInfluencer, userId, session.round);
          session.usedInstagramIds.push(hardInfluencer.id);
        }
      } else if (session.round === 5) {
        // Round 5: Reset round - 2 random influencers (don't carry winner)
        const influencers = getTwoRandomInstagramers(instagramList, session.usedInstagramIds);
        if (!influencers) {
          return interaction.reply({ content: '❌ Not enough Instagram influencers available!', ephemeral: true });
        }
        nextDuel = await createInstagramDuelMessage(influencers[0], influencers[1], userId, session.round);
        session.usedInstagramIds.push(influencers[0].id, influencers[1].id);
        session.winner = null; // Reset winner - next round will be round 1 with 2 random influencers
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** has more!\n**${loser.name}** has less.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'instagram');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedCityIds: [],
        usedEpic7Ids: [],
        usedInstagramIds: [],
        usedCarIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** has more!\n**${loser.name}** has less.\n\nYou selected **${selected === leftId ? leftInfluencer.name : rightInfluencer.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'cars') {
    // Cars duel
    const leftCar = carsList.find(c => c.id === leftId);
    const rightCar = carsList.find(c => c.id === rightId);
    
    if (!leftCar || !rightCar) {
      return interaction.reply({ content: '❌ Error: Car not found!', ephemeral: true });
    }

    // Higher top speed wins
    const winner = (leftCar.maxSpeedKmh || 0) > (rightCar.maxSpeedKmh || 0) ? leftCar : rightCar;
    const loser = winner.id === leftCar.id ? rightCar : leftCar;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedCarIds) {
        session.usedCarIds = [];
      }
      session.usedCarIds.push(leftCar.id, rightCar.id);

      // Update winner FIRST before determining next round
      session.winner = winner;
      // Round system: 1 -> 2 -> 3 -> 4 -> 1 -> ...
      // - Round 1: 2 random cars (different max speeds)
      // - Round 2-3: winner stays vs random (different max speeds)
      // - Round 4: hard round (±20 km/h max speed difference, no tie)
      // - After round 4: reset to round 1 with 2 new random cars (winner does NOT carry)
      const currentRound = session.round || 1;
      const nextRound = currentRound === 4 ? 1 : currentRound + 1;
      session.round = nextRound;

      let nextDuel;

      if (nextRound === 1) {
        // Reset round: 2 random cars, don't carry winner
        const cars = getTwoRandomCars(carsList, session.usedCarIds);
        if (!cars) {
          return interaction.reply({ content: '❌ Not enough cars available!', ephemeral: true });
        }
        nextDuel = await createCarDuelMessage(cars[0], cars[1], userId, nextRound);
        session.usedCarIds.push(cars[0].id, cars[1].id);
        session.winner = null;
      } else if (nextRound === 4) {
        // Hard round: winner vs close-speed opponent (±20 km/h), always different speed
        if (!session.winner || !session.winner.imagePath) {
          const cars = getTwoRandomCars(carsList, session.usedCarIds);
          if (!cars) {
            return interaction.reply({ content: '❌ Not enough cars available!', ephemeral: true });
          }
          nextDuel = await createCarDuelMessage(cars[0], cars[1], userId, nextRound);
          session.usedCarIds.push(cars[0].id, cars[1].id);
        } else {
          const hardCar = getCarWithSpeedDifference(session.winner, carsList, session.usedCarIds, 20);
          if (!hardCar) {
            return interaction.reply({ content: '❌ Not enough cars available!', ephemeral: true });
          }
          nextDuel = await createCarDuelMessage(session.winner, hardCar, userId, nextRound);
          session.usedCarIds.push(hardCar.id);
        }
      } else {
        // Round 2-3: winner vs random car with different max speed (no tie)
        if (!session.winner || !session.winner.imagePath) {
          const cars = getTwoRandomCars(carsList, session.usedCarIds);
          if (!cars) {
            return interaction.reply({ content: '❌ Not enough cars available!', ephemeral: true });
          }
          nextDuel = await createCarDuelMessage(cars[0], cars[1], userId, nextRound);
          session.usedCarIds.push(cars[0].id, cars[1].id);
        } else {
          const newCar = getRandomCar(carsList, session.usedCarIds, session.winner.maxSpeedKmh);
          if (!newCar) {
            return interaction.reply({ content: '❌ Not enough cars available!', ephemeral: true });
          }
          nextDuel = await createCarDuelMessage(session.winner, newCar, userId, nextRound);
          session.usedCarIds.push(newCar.id);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** has a higher top speed!\n**${loser.name}** has a lower top speed.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });
        
        // Cleanup composite image after sending
        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      // User lost
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'cars');
      
      // Reset session
      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedCityIds: [],
        usedEpic7Ids: [],
        usedInstagramIds: [],
        usedCarIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** has a higher top speed!\n**${loser.name}** has a lower top speed.\n\nYou selected **${selected === leftId ? leftCar.name : rightCar.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  } else if (duelType === 'shows') {
    const leftShow = showsList.find(s => s.id === leftId);
    const rightShow = showsList.find(s => s.id === rightId);

    if (!leftShow || !rightShow) {
      return interaction.reply({ content: '❌ Error: Show not found!', ephemeral: true });
    }

    // Lower rank (closer to #1) is better rated
    const winner = leftShow.rank < rightShow.rank ? leftShow : rightShow;
    const loser = winner.id === leftShow.id ? rightShow : leftShow;
    const userWon = selected === winner.id;

    if (userWon) {
      session.currentStreak++;
      if (!session.usedShowIds) {
        session.usedShowIds = [];
      }
      session.usedShowIds.push(leftShow.id, rightShow.id);

      session.winner = winner;

      // Round cycle: 1 -> 2 -> 3 -> 4 -> 1 -> ...
      // 1: two random shows
      // 2-3: winner vs random
      // 4: winner vs ±4 rank hard matchup
      const currentRound = session.round || 1;
      const nextRound = currentRound === 4 ? 1 : currentRound + 1;
      session.round = nextRound;

      let nextDuel;

      if (nextRound === 1) {
        const shows = getTwoRandomShows(showsList, session.usedShowIds);
        if (!shows) {
          return interaction.reply({ content: '❌ Not enough shows available!', ephemeral: true });
        }
        nextDuel = await createShowDuelMessage(shows[0], shows[1], userId, nextRound);
        session.usedShowIds.push(shows[0].id, shows[1].id);
        session.winner = null;
      } else if (nextRound === 4) {
        if (!session.winner || !session.winner.imagePath) {
          const shows = getTwoRandomShows(showsList, session.usedShowIds);
          if (!shows) {
            return interaction.reply({ content: '❌ Not enough shows available!', ephemeral: true });
          }
          nextDuel = await createShowDuelMessage(shows[0], shows[1], userId, nextRound);
          session.usedShowIds.push(shows[0].id, shows[1].id);
        } else {
          const hardShow = getShowWithRankDifference(session.winner, showsList, session.usedShowIds);
          if (!hardShow) {
            return interaction.reply({ content: '❌ Not enough shows available!', ephemeral: true });
          }
          nextDuel = await createShowDuelMessage(session.winner, hardShow, userId, nextRound);
          session.usedShowIds.push(hardShow.id);
        }
      } else {
        if (!session.winner || !session.winner.imagePath) {
          const shows = getTwoRandomShows(showsList, session.usedShowIds);
          if (!shows) {
            return interaction.reply({ content: '❌ Not enough shows available!', ephemeral: true });
          }
          nextDuel = await createShowDuelMessage(shows[0], shows[1], userId, nextRound);
          session.usedShowIds.push(shows[0].id, shows[1].id);
        } else {
          const newShow = getRandomShow(showsList, session.usedShowIds);
          if (!newShow) {
            return interaction.reply({ content: '❌ Not enough shows available!', ephemeral: true });
          }
          nextDuel = await createShowDuelMessage(session.winner, newShow, userId, nextRound);
          session.usedShowIds.push(newShow.id);
        }
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Correct!')
        .setDescription(`**${winner.name}** is better rated!\n**${loser.name}** is lower rated.\n\n**Streak: ${session.currentStreak}** 🔥`)
        .setColor(0x57F287)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });

      setTimeout(async () => {
        await interaction.followUp({
          ...nextDuel,
          content: `**Round ${session.round}!** Choose wisely...`
        });

        if (nextDuel._compositePath) {
          cleanupCompositeImage(nextDuel._compositePath);
        }
      }, 1500);
    } else {
      const finalStreak = session.currentStreak;
      await saveToRanking(userId, interaction.user.username, finalStreak, 'shows');

      userStreaks[userId] = {
        currentStreak: 0,
        round: 1,
        winner: null,
        usedCharacterIds: [],
        usedAnimeIds: [],
        usedPeopleIds: [],
        usedGameIds: [],
        usedMovieIds: [],
        usedShowIds: [],
        usedCityIds: [],
        usedEpic7Ids: [],
        usedInstagramIds: [],
        usedCarIds: []
      };

      const embed = new EmbedBuilder()
        .setTitle('❌ Wrong Choice!')
        .setDescription(`**${winner.name}** is better rated!\n**${loser.name}** is lower rated.\n\nYou selected **${selected === leftId ? leftShow.name : rightShow.name}**.\n\n**Final Streak: ${finalStreak}**\nYour score has been added to the leaderboard!`)
        .setColor(0xED4245)
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: []
      });
    }
  }
}

// Save streak to ranking
async function saveToRanking(userId, username, streak, type = 'anime') {
  const ranking = await fs.readJSON(RANKING_FILE);
  
  // Ensure structure exists
  if (!ranking[type]) {
    ranking[type] = [];
  }
  
  const typeRanking = ranking[type];
  const existingIndex = typeRanking.findIndex(entry => entry.userId === userId);
  
  const entry = {
    userId,
    username,
    streak,
    date: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    if (streak > typeRanking[existingIndex].streak) {
      typeRanking[existingIndex] = entry;
    }
  } else {
    typeRanking.push(entry);
  }

  typeRanking.sort((a, b) => b.streak - a.streak);
  ranking[type] = typeRanking;
  await fs.writeJSON(RANKING_FILE, ranking, { spaces: 2 });
}

// Reset rankings
async function resetRankings() {
  await fs.writeJSON(RANKING_FILE, {
    anime: [],
    people: [],
    games: [],
    movies: [],
    shows: [],
    cities: [],
    epic7: [],
    cityid: [],
    instagram: [],
    cars: [],
    multiduel: []
  }, { spaces: 2 });
  return true;
}

// Get ranking
async function getRanking(limit = 10, type = 'anime') {
  const ranking = await fs.readJSON(RANKING_FILE);
  const typeRanking = ranking[type] || [];
  return typeRanking.slice(0, limit);
}

// Create ranking embed
function createRankingEmbed(ranking, title = '🏆 Leaderboard', description = 'Top players by highest streak!') {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xFFD700)
    .setTimestamp();

  if (ranking.length === 0) {
    embed.setDescription('No scores yet! Be the first to play!');
  } else {
    const leaderboard = ranking.map((entry, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      return `${medal} **${entry.username}** - ${entry.streak} streak`;
    }).join('\n');
    
    embed.setDescription(leaderboard);
  }

  return embed;
}

// Create combined ranking embeds (anime, people, games, and movies)
async function createCombinedRankingEmbeds() {
  try {
    const animeRanking = await getRanking(10, 'anime');
    const peopleRanking = await getRanking(10, 'people');
    const gamesRanking = await getRanking(10, 'games');
    const moviesRanking = await getRanking(10, 'movies');
  const showsRanking = await getRanking(10, 'shows');
    
    const embeds = [];
    
    // Anime leaderboard
    embeds.push(createRankingEmbed(
      animeRanking,
      '🎌 Anime Duel Leaderboard',
      'Top players in Anime Duels!'
    ));
    
    // People leaderboard
    embeds.push(createRankingEmbed(
      peopleRanking,
      '👥 People Duel Leaderboard',
      'Top players in "Who is More Famous?" Duels!'
    ));
    
    // Games leaderboard
    embeds.push(createRankingEmbed(
      gamesRanking,
      '🎮 Games Duel Leaderboard',
      'Top players in "Which Game Has Better Metacritic Score?" Duels!'
    ));
    
    // Movies leaderboard
    embeds.push(createRankingEmbed(
      moviesRanking,
      '🎬 Movies Duel Leaderboard',
      'Top players in "Which Movie Made More Box Office?" Duels!'
    ));
  
  // Shows leaderboard
  embeds.push(createRankingEmbed(
    showsRanking,
    '📺 Shows Duel Leaderboard',
    'Top players in "What Show Is Better Rated?" Duels!'
  ));
    
    // Cities leaderboard
    const citiesRanking = await getRanking(10, 'cities');
    embeds.push(createRankingEmbed(
      citiesRanking,
      '🏙️ Cities Duel Leaderboard',
      'Top players in "Which City Has More Population?" Duels!'
    ));
    
    // Epic7 leaderboard
    const epic7Ranking = await getRanking(10, 'epic7');
    embeds.push(createRankingEmbed(
      epic7Ranking,
      '⚔️ Epic7 Duel Leaderboard',
      'Top players in "Who Has Better RTA Winrate?" Duels!'
    ));
    
    // City Identification leaderboard
    const cityidRanking = await getRanking(10, 'cityid');
    embeds.push(createRankingEmbed(
      cityidRanking,
      '🌍 City Identification Leaderboard',
      'Top players in "Which City Is This?" Duels!'
    ));
    
    return embeds;
  } catch (error) {
    console.error('Error in createCombinedRankingEmbeds:', error);
    throw error;
  }
}

module.exports = {
  initRanking,
  getTwoRandomCharacters,
  createCharacterDuelMessage,
  handleDuelChoice,
  getRanking,
  createRankingEmbed,
  createCombinedRankingEmbeds,
  resetRankings,
  getTwoRandomAnimes,
  getTwoRandomPeople,
  createPeopleDuelMessage,
  getTwoRandomGames,
  createGameDuelMessage,
  getGameWithRankDifference,
  getTwoRandomMovies,
  createMovieDuelMessage,
  getMovieWithRankDifference,
   getTwoRandomShows,
   createShowDuelMessage,
   getShowWithRankDifference,
  getTwoRandomCities,
  createCityDuelMessage,
  getCityWithRankDifference,
  getTwoRandomEpic7,
  createEpic7DuelMessage,
  getTwoRandomInstagramers,
  createInstagramDuelMessage,
  getInstagramerWithRankDifference,
  getRandomCar,
  getTwoRandomCars,
  createCarDuelMessage,
  getCarWithSpeedDifference,
  createCompositeImage,
  cleanupCompositeImage,
  getRandomCountry,
  getTwoRandomCitiesFromCountry,
  getTwoCitiesFromDifferentCountries,
  findCityByName,
  createCityIdentificationDuelMessage
};
