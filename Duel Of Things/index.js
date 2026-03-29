require('dotenv').config();
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const config = require('./config');
const game = require('./game');
const multiduel = require('./multiduel');

let charactersData = [];
try {
  charactersData = require('./characters-data');
} catch (error) {
  console.warn('⚠️  characters-data.js not found. Run "npm run parse" first to generate character data.');
}

let animeData = [];
try {
  animeData = require('./anime-data');
} catch (error) {
  console.warn('⚠️  anime-data.js not found. Run "npm run parse-anime" first to generate anime data.');
}

let peopleData = [];
try {
  peopleData = require('./people-data');
} catch (error) {
  console.warn('⚠️  people-data.js not found. Run "npm run parse-people" first to generate people data.');
}

let gamesData = [];
try {
  gamesData = require('./games-data');
} catch (error) {
  console.warn('⚠️  games-data.js not found. Run "npm run parse-games" first to generate games data.');
}

let moviesData = [];
try {
  moviesData = require('./movies-data');
} catch (error) {
  console.warn('⚠️  movies-data.js not found. Run "npm run parse-movies" first to generate movies data.');
}

let citiesData = [];
try {
  citiesData = require('./cities-data');
} catch (error) {
  console.warn('⚠️  cities-data.js not found. Run "npm run parse-cities" first to generate cities data.');
}

let epic7Data = [];
try {
  epic7Data = require('./epic7-data');
} catch (error) {
  console.warn('⚠️  epic7-data.js not found. Run "npm run parse-epic7" first to generate Epic7 data.');
}

let citiesByCountry = {};
try {
  citiesByCountry = require('./cities-by-country');
} catch (error) {
  console.warn('⚠️  cities-by-country.js not found. Run "npm run organize-cities-by-country" first to generate cities-by-country data.');
}

let instagramData = [];
try {
  instagramData = require('./instagram-data');
} catch (error) {
  console.warn('⚠️  instagram-data.js not found. Run "npm run parse-instagram-pdf" first to generate Instagram data.');
}

let carsData = [];
try {
  carsData = require('./cars-data');
} catch (error) {
  console.warn('⚠️  cars-data.js not found.');
}

let showsData = [];
try {
  showsData = require('./shows-data');
} catch (error) {
  console.warn('⚠️  shows-data.js not found. Run "npm run parse-shows-imdb-images" first to generate shows data.');
}

// Store active user streaks
const userStreaks = {};

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// When the client is ready, run this code
client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
  console.log(`📊 Loaded ${charactersData.length} characters`);
  console.log(`📺 Loaded ${animeData.length} anime`);
  console.log(`👥 Loaded ${peopleData.length} people`);
  console.log(`🎮 Loaded ${gamesData.length} games`);
  console.log(`🎬 Loaded ${moviesData.length} movies`);
  console.log(`🏙️ Loaded ${citiesData.length} cities`);
  console.log(`⚔️ Loaded ${epic7Data.length} Epic7 characters`);
  console.log(`🌍 Loaded ${Object.keys(citiesByCountry).length} countries with cities`);
  console.log(`📱 Loaded ${instagramData.length} Instagram influencers`);
  console.log(`🚗 Loaded ${carsData.length} cars`);
  console.log(`📺 Loaded ${showsData.length} shows`);
  await game.initRanking();
  console.log('🎮 Game initialized!');
});

// Handle interactions (buttons and commands)
client.on(Events.InteractionCreate, async interaction => {
  // Handle button clicks
  if (interaction.isButton()) {
    const customId = interaction.customId;
    
    if (customId.startsWith('md_')) {
      // Multiduel button: md_{channelId}_{leftId}_{rightId}_{left/right}
      const parts = customId.split('_');
      const channelId = parts[1];
      const side = parts[parts.length - 1]; // 'left' or 'right'
      
      // Get lobby to access item IDs
      const lobby = multiduel.getLobbyStatus(channelId);
      if (!lobby || !lobby.item1 || !lobby.item2) {
        return interaction.reply({ content: '❌ Invalid multiduel round!', ephemeral: true });
      }
      
      const leftId = lobby.item1.id;
      const rightId = lobby.item2.id;
      const selectedId = side === 'left' ? leftId : rightId;

      const result = multiduel.handleMultiduelAnswer(channelId, interaction.user.id, selectedId, leftId, rightId, client);
      
      if (result.error) {
        return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      }

      if (result.success) {
        return interaction.reply({ content: '✅ Answer recorded!', ephemeral: true });
      }
    } else if (customId.startsWith('duel_') || customId.startsWith('dg_') || customId.startsWith('dm_') || customId.startsWith('dc_') || customId.startsWith('de_') || customId.startsWith('di7_') || customId.startsWith('di8_') || customId.startsWith('dc9_') || customId.startsWith('dtv_')) {
      // Parse button ID
      // Old format: duel_{type}_{userId}_{leftId}_{rightId}_{side}
      // New format (games/movies/cities/epic7): dg/dm/dc/de_{userId}_{rank1}_{rank2}_{l/r}
      const parts = customId.split('_');
      let duelType, userId, leftId, rightId, selectedSide;
      
      if (customId.startsWith('dg_')) {
        // Games: dg_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'games';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find games by rank
        const game1 = gamesData.find(g => g.rank === rank1);
        const game2 = gamesData.find(g => g.rank === rank2);
        
        if (!game1 || !game2) {
          return interaction.reply({ content: '❌ Error: Game not found!', ephemeral: true });
        }
        
        leftId = game1.id;
        rightId = game2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('dm_')) {
        // Movies: dm_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'movies';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find movies by rank
        const movie1 = moviesData.find(m => m.rank === rank1);
        const movie2 = moviesData.find(m => m.rank === rank2);
        
        if (!movie1 || !movie2) {
          return interaction.reply({ content: '❌ Error: Movie not found!', ephemeral: true });
        }
        
        leftId = movie1.id;
        rightId = movie2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('dc_')) {
        // Cities: dc_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'cities';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find cities by rank
        const city1 = citiesData.find(c => c.rank === rank1);
        const city2 = citiesData.find(c => c.rank === rank2);
        
        if (!city1 || !city2) {
          return interaction.reply({ content: '❌ Error: City not found!', ephemeral: true });
        }
        
        leftId = city1.id;
        rightId = city2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('de_')) {
        // Epic7: de_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'epic7';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find Epic7 characters by rank
        const char1 = epic7Data.find(c => c.rank === rank1);
        const char2 = epic7Data.find(c => c.rank === rank2);
        
        if (!char1 || !char2) {
          return interaction.reply({ content: '❌ Error: Character not found!', ephemeral: true });
        }
        
        leftId = char1.id;
        rightId = char2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('di7_')) {
        // City Identification: di7_{userId}_{city1Id}_{city2Id}_{correctCityName}_{a/b}
        // The last part (parts[5]) indicates which button is CORRECT ('a' or 'b')
        // But we need to determine which button was CLICKED
        // Button A (first button) always has '_a' at the end, Button B (second button) always has '_b' at the end
        // So if the clicked button ends with '_a', the user selected Choice A (leftId)
        // If it ends with '_b', the user selected Choice B (rightId)
        duelType = 'cityid';
        userId = parts[1];
        leftId = parts[2];
        rightId = parts[3];
        // correctCityName is in parts[4] (URL encoded)
        // parts[5] indicates which button is correct ('a' or 'b')
        // Determine which button was clicked based on the last part of the customId
        const clickedButton = parts[5]; // 'a' means Choice A was clicked, 'b' means Choice B was clicked
        selectedSide = clickedButton === 'a' ? 'left' : 'right';
      } else if (customId.startsWith('di8_')) {
        // Instagram: di8_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'instagram';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find Instagram influencers by rank
        const influencer1 = instagramData.find(i => i.rank === rank1);
        const influencer2 = instagramData.find(i => i.rank === rank2);
        
        if (!influencer1 || !influencer2) {
          return interaction.reply({ content: '❌ Error: Instagram influencer not found!', ephemeral: true });
        }
        
        leftId = influencer1.id;
        rightId = influencer2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('dc9_')) {
        // Cars: dc9_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'cars';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'
        
        // Find cars by rank
        const car1 = carsData.find(c => c.rank === rank1);
        const car2 = carsData.find(c => c.rank === rank2);
        
        if (!car1 || !car2) {
          return interaction.reply({ content: '❌ Error: Car not found!', ephemeral: true });
        }
        
        leftId = car1.id;
        rightId = car2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (customId.startsWith('dtv_')) {
        // Shows: dtv_{userId}_{rank1}_{rank2}_{l/r}
        duelType = 'shows';
        userId = parts[1];
        const rank1 = parseInt(parts[2]);
        const rank2 = parseInt(parts[3]);
        const side = parts[4]; // 'l' or 'r'

        const show1 = showsData.find(s => s.rank === rank1);
        const show2 = showsData.find(s => s.rank === rank2);

        if (!show1 || !show2) {
          return interaction.reply({ content: '❌ Error: Show not found!', ephemeral: true });
        }

        leftId = show1.id;
        rightId = show2.id;
        selectedSide = side === 'l' ? 'left' : 'right';
      } else if (parts.length >= 6) {
        // Old format: duel_char_userId_leftId_rightId_side or duel_anime_userId_leftId_rightId_side or duel_people_userId_leftId_rightId_side
        duelType = parts[1]; // 'char', 'anime', or 'people'
        userId = parts[2];
        leftId = parts[3];
        rightId = parts[4];
        selectedSide = parts[5];
      } else {
        return interaction.reply({ content: '❌ Invalid button format!', ephemeral: true });
      }
      
      const selectedId = selectedSide === 'left' ? leftId : rightId;
      
      await game.handleDuelChoice(interaction, selectedId, leftId, rightId, charactersData, animeData, peopleData, gamesData, moviesData, showsData, citiesData, epic7Data, citiesByCountry, instagramData, carsData, userStreaks, userId, duelType);
    }
    return;
  }

  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'ping') {
      await interaction.reply('Pong! 🏓');
    }
    return;
  }
});

// Handle text commands (!duel and !rank)
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots
  if (message.author.bot) return;

  // Check if data is loaded
  if (charactersData.length === 0) {
    if (message.content.toLowerCase() === '!duel' || message.content.toLowerCase() === '!rank') {
      return message.reply('❌ Character data not loaded! Please run the parser first.');
    }
    return;
  }

  if (animeData.length === 0) {
    if (message.content.toLowerCase() === '!duel') {
      return message.reply('❌ Anime data not loaded! Please run "npm run parse-anime" first.');
    }
  }

  // !duel command
  if (message.content.toLowerCase() === '!duel') {
    try {
      const userId = message.author.id;
      
      // Initialize user session if needed
      if (!userStreaks[userId]) {
        userStreaks[userId] = {
          currentStreak: 0,
          round: 1,
          winner: null,
          usedCharacterIds: [],
          usedAnimeIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random characters
      const [char1, char2] = game.getTwoRandomCharacters(charactersData, session.usedCharacterIds);
      if (!char1 || !char2) {
        return message.reply('❌ Not enough characters available!');
      }
      
      session.usedCharacterIds.push(char1.id, char2.id);
      const duelMessage = await game.createCharacterDuelMessage(char1, char2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !rank command - Multiduel rankings only
  if (message.content.toLowerCase() === '!rank') {
    try {
      const multiduelRanking = await game.getRanking(10, 'multiduel');
      const embed = game.createRankingEmbed(
        multiduelRanking,
        '🏆 Multiduel Leaderboard',
        'Top players by highest rounds survived in Multiduel!'
      );
      await message.reply({ embeds: [embed] });
    } catch (error) {
      console.error('Error getting ranking:', error);
      await message.reply('❌ An error occurred while fetching the ranking.');
    }
    return;
  }

  // !me command - Show user's streaks in all duel games
  if (message.content.toLowerCase() === '!me') {
    try {
      const userId = message.author.id;
      const username = message.author.username;
      
      const rankings = await fs.readJSON(path.join(__dirname, 'ranking.json'));
      
      const getUserStreak = (type) => {
        const typeRanking = rankings[type] || [];
        const userEntry = typeRanking.find(e => e.userId === userId);
        return userEntry ? userEntry.streak : 0;
      };
      
      const streaks = {
        'Anime Character Duel': getUserStreak('anime'),
        'Famous People Duel': getUserStreak('people'),
        'Videogame Duel': getUserStreak('games'),
        'Movies Duel': getUserStreak('movies'),
        'Cities Duel': getUserStreak('cities'),
        'Epic7 Duel': getUserStreak('epic7'),
        'City Identification Duel': getUserStreak('cityid'),
        'Instagram Influencers Duel': getUserStreak('instagram'),
        'Cars Duel': getUserStreak('cars'),
        'TV Shows Duel': getUserStreak('shows'),
        'Multiduel': getUserStreak('multiduel')
      };
      
      const streakText = Object.entries(streaks)
        .sort((a, b) => b[1] - a[1]) // Sort by streak (descending: highest first)
        .map(([game, streak]) => {
          const fireEmoji = streak > 0 ? '🔥' : '⚪';
          return `${fireEmoji} **${streak}** • ${game}`;
        })
        .join('\n');
      
      const meEmbed = new EmbedBuilder()
        .setTitle(`📊 ${username}'s Streaks`)
        .setDescription(streakText || 'No streaks yet! Start playing to build your streaks.')
        .setColor(0x5865F2)
        .setTimestamp();
      
      await message.reply({ embeds: [meEmbed] });
    } catch (error) {
      console.error('Error getting user streaks:', error);
      await message.reply('❌ An error occurred while fetching your streaks.');
    }
    return;
  }

  // !data command - Sources of truth
  if (message.content.toLowerCase() === '!data') {
    const dataEmbed = new EmbedBuilder()
      .setTitle('📊 Sources of Truth')
      .setDescription(
        '**Anime Character Duel:** MyAnimeList Favorite count\n' +
        '**Famous People Duel:** Pantheon.world Database\n' +
        '**Videogame Duel:** Metacritic score\n' +
        '**TV Shows Duel:** IMDB Rankings\n\n' +
        'The rest of the data, car speeds, instagram followers and movie box office is simply factual.'
      )
      .setColor(0x5865F2)
      .setTimestamp();
    
    await message.reply({ embeds: [dataEmbed] });
    return;
  }

  // !info command - List all duel games
  if (message.content.toLowerCase() === '!info') {
    const infoEmbed = new EmbedBuilder()
      .setTitle('🎮 Available Duel Games')
      .setDescription(
        '**!duel** - Anime Character Duel\n' +
        'Choose the character with more favorites!\n\n' +
        '**!duel2** - Famous People Duel\n' +
        'Choose the person who is more famous (lower rank = more famous)!\n\n' +
        '**!duel3** - Videogame Duel\n' +
        'Which game has a better Metacritic score?\n\n' +
        '**!duel4** - Movies Duel\n' +
        'Choose the movie that made more box office!\n\n' +
        '**!duel5** - Cities Duel\n' +
        'Choose the city with more population!\n\n' +
        '**!duel6** - Epic7 Duel\n' +
        'Who has a better RTA winrate?\n\n' +
        '**!duel7** - City Identification Duel\n' +
        'Which city is this?\n\n' +
        '**!duel8** - Instagram Influencers Duel\n' +
        'Who has more followers?\n\n' +
        '**!duel9** - Cars Duel\n' +
        'Which car has a higher top speed?\n\n' +
        '**!duel10** - TV Shows Duel\n' +
        'What show is better rated?'
      )
      .setColor(0x5865F2)
      .setTimestamp();
    
    await message.reply({ embeds: [infoEmbed] });
    return;
  }

  // !duel2 command - People duel (who is more famous)
  if (message.content.toLowerCase() === '!duel2') {
    try {
      if (peopleData.length === 0) {
        return message.reply('❌ People data not loaded! Please run "npm run parse-people" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
      if (!userStreaks[userId]) {
        userStreaks[userId] = {
          currentStreak: 0,
          round: 1,
          winner: null,
          usedCharacterIds: [],
          usedAnimeIds: [],
          usedPeopleIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Get 2 random people
      const [person1, person2] = game.getTwoRandomPeople(peopleData, session.usedPeopleIds || []);
      if (!person1 || !person2) {
        return message.reply('❌ Not enough people available!');
      }
      
      if (!session.usedPeopleIds) {
        session.usedPeopleIds = [];
      }
      session.usedPeopleIds.push(person1.id, person2.id);
      
      const duelMessage = await game.createPeopleDuelMessage(person1, person2, userId);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting people duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel4 command - Movies duel (which movie made more box office)
  if (message.content.toLowerCase() === '!duel4') {
    try {
      if (moviesData.length === 0) {
        return message.reply('❌ Movies data not loaded! Please run "npm run parse-movies" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
      if (!userStreaks[userId]) {
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
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random movies
      const [movie1, movie2] = game.getTwoRandomMovies(moviesData, session.usedMovieIds || []);
      if (!movie1 || !movie2) {
        return message.reply('❌ Not enough movies available!');
      }
      
      if (!session.usedMovieIds) {
        session.usedMovieIds = [];
      }
      session.usedMovieIds.push(movie1.id, movie2.id);
      
      const duelMessage = await game.createMovieDuelMessage(movie1, movie2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting movie duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel5 command - Cities duel (which city has more population)
  if (message.content.toLowerCase() === '!duel5') {
    try {
      if (citiesData.length === 0) {
        return message.reply('❌ Cities data not loaded! Please run "npm run parse-cities" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
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
          usedCityIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random cities
      const [city1, city2] = game.getTwoRandomCities(citiesData, session.usedCityIds || []);
      if (!city1 || !city2) {
        return message.reply('❌ Not enough cities available!');
      }
      
      if (!session.usedCityIds) {
        session.usedCityIds = [];
      }
      session.usedCityIds.push(city1.id, city2.id);
      
      const duelMessage = await game.createCityDuelMessage(city1, city2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting city duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel6 command - Epic7 duel (who has better RTA winrate)
  if (message.content.toLowerCase() === '!duel6') {
    try {
      if (epic7Data.length === 0) {
        return message.reply('❌ Epic7 data not loaded! Please run "npm run parse-epic7" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
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
          usedCityIds: [],
          usedEpic7Ids: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random Epic7 characters
      const [char1, char2] = game.getTwoRandomEpic7(epic7Data, session.usedEpic7Ids || []);
      if (!char1 || !char2) {
        return message.reply('❌ Not enough characters available!');
      }
      
      if (!session.usedEpic7Ids) {
        session.usedEpic7Ids = [];
      }
      session.usedEpic7Ids.push(char1.id, char2.id);
      
      const duelMessage = await game.createEpic7DuelMessage(char1, char2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting Epic7 duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel7 command - City identification duel
  if (message.content.toLowerCase() === '!duel7') {
    try {
      if (Object.keys(citiesByCountry).length === 0) {
        return message.reply('❌ Cities-by-country data not loaded! Please run "npm run organize-cities-by-country" first.');
      }
      
      if (citiesData.length === 0) {
        return message.reply('❌ Cities data not loaded! Please run "npm run parse-cities" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
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
          usedCityIds: [],
          usedEpic7Ids: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Reset session for new game
      session.currentStreak = 0;
      session.round = 1;
      
      // Get 2 cities from 2 different countries
      const cities = game.getTwoCitiesFromDifferentCountries(citiesByCountry, citiesData);
      if (!cities) {
        return message.reply('❌ Error: Could not find cities from different countries!');
      }
      
      const [city1, city2] = cities;
      
      // Randomly pick which city to ask about
      const correctCity = Math.random() < 0.5 ? city1 : city2;
      const correctCityName = correctCity.name;
      
      const duelMessage = await game.createCityIdentificationDuelMessage(city1, city2, correctCityName, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting city identification duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel3 command - Games duel (which game has better Metacritic score)
  if (message.content.toLowerCase() === '!duel3') {
    try {
      if (gamesData.length === 0) {
        return message.reply('❌ Games data not loaded! Please run "npm run parse-games" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
      if (!userStreaks[userId]) {
        userStreaks[userId] = {
          currentStreak: 0,
          round: 1,
          winner: null,
          usedCharacterIds: [],
          usedAnimeIds: [],
          usedPeopleIds: [],
          usedGameIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random games
      const [game1, game2] = game.getTwoRandomGames(gamesData, session.usedGameIds || []);
      if (!game1 || !game2) {
        return message.reply('❌ Not enough games available!');
      }
      
      if (!session.usedGameIds) {
        session.usedGameIds = [];
      }
      session.usedGameIds.push(game1.id, game2.id);
      
      const duelMessage = await game.createGameDuelMessage(game1, game2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting game duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !multiduel command - Start a multiduel lobby
  if (message.content.toLowerCase() === '!multiduel') {
    try {
      const channelId = message.channel.id;
      const userId = message.author.id;
      const username = message.author.username;

      const result = multiduel.startMultiduelLobby(channelId, userId, username, client);
      
      if (result.error) {
        return message.reply(`❌ ${result.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('🎮 Multi-Duel Lobby Started! 🎮')
        .setDescription(`**${username}** has started a multiduel!\n\n**Players:** ${result.lobby.players.map(p => p.username).join(', ')}\n**Max Players:** 5\n**Time remaining:** 10 seconds\n\nType \`!joinduel\` to join!`)
        .setColor(0x5865F2)
        .setTimestamp();

      const statusMessage = await message.reply({ embeds: [embed] });

      // Update status every second
      const statusInterval = setInterval(async () => {
        const lobby = multiduel.getLobbyStatus(channelId);
        if (!lobby || lobby.status !== 'lobby') {
          clearInterval(statusInterval);
          // If game started, clear interval
          if (lobby && lobby.status === 'playing') {
            try {
              await statusMessage.delete();
            } catch (error) {
              // Ignore delete errors
            }
          }
          return;
        }

        const remaining = Math.ceil((lobby.timerEnd - Date.now()) / 1000);
        const embed = new EmbedBuilder()
          .setTitle('🎮 Multi-Duel Lobby 🎮')
          .setDescription(`**Players:** ${lobby.players.map(p => p.username).join(', ')} (${lobby.players.length}/5)\n**Time remaining:** ${remaining} seconds\n\nType \`!joinduel\` to join!`)
          .setColor(0x5865F2)
          .setTimestamp();

        try {
          await statusMessage.edit({ embeds: [embed] });
        } catch (error) {
          // Message might be deleted or edited
          clearInterval(statusInterval);
        }
      }, 1000);
    } catch (error) {
      console.error('Error starting multiduel:', error);
      await message.reply('❌ An error occurred while starting the multiduel. Please try again.');
    }
    return;
  }

  // !joinduel command - Join a multiduel lobby
  if (message.content.toLowerCase() === '!joinduel') {
    try {
      const channelId = message.channel.id;
      const userId = message.author.id;
      const username = message.author.username;

      const result = multiduel.joinMultiduelLobby(channelId, userId, username);
      
      if (result.error) {
        return message.reply(`❌ ${result.error}`);
      }

      if (result.started) {
        await message.reply(`✅ **${username}** joined! Lobby is full, starting game...`);
        // Start the game
        setTimeout(async () => {
          await multiduel.startMultiduelGame(message.channel.id, client);
        }, 1000);
        return;
      }

      await message.reply(`✅ **${username}** joined the multiduel! (${result.playerCount}/5 players)`);
    } catch (error) {
      console.error('Error joining multiduel:', error);
      await message.reply('❌ An error occurred while joining the multiduel. Please try again.');
    }
    return;
  }

  // !duel8 command - Instagram influencers duel (who has more followers)
  if (message.content.toLowerCase() === '!duel8') {
    try {
      if (instagramData.length === 0) {
        return message.reply('❌ Instagram data not loaded! Please run "npm run parse-instagram-pdf" first.');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
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
          usedCityIds: [],
          usedEpic7Ids: [],
          usedInstagramIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random Instagram influencers
      const [influencer1, influencer2] = game.getTwoRandomInstagramers(instagramData, session.usedInstagramIds || []);
      if (!influencer1 || !influencer2) {
        return message.reply('❌ Not enough Instagram influencers available!');
      }
      
      if (!session.usedInstagramIds) {
        session.usedInstagramIds = [];
      }
      session.usedInstagramIds.push(influencer1.id, influencer2.id);
      
      const duelMessage = await game.createInstagramDuelMessage(influencer1, influencer2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting Instagram duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel9 command - Cars duel (fastest acceleration to 60mph)
  if (message.content.toLowerCase() === '!duel9') {
    try {
      if (carsData.length === 0) {
        return message.reply('❌ Cars data not loaded!');
      }
      
      const userId = message.author.id;
      
      // Initialize user session if needed
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
          usedCityIds: [],
          usedEpic7Ids: [],
          usedInstagramIds: [],
          usedCarIds: []
        };
      }
      
      const session = userStreaks[userId];
      
      // Round 1: 2 random cars
      const [car1, car2] = game.getTwoRandomCars(carsData, session.usedCarIds || []);
      if (!car1 || !car2) {
        return message.reply('❌ Not enough cars available!');
      }
      
      if (!session.usedCarIds) {
        session.usedCarIds = [];
      }
      session.usedCarIds.push(car1.id, car2.id);
      
      const duelMessage = await game.createCarDuelMessage(car1, car2, userId, 1);
      
      await message.reply(duelMessage);
      
      // Cleanup composite image after sending
      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting car duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !duel10 command - Shows duel (better rated TV show)
  if (message.content.toLowerCase() === '!duel10') {
    try {
      if (showsData.length === 0) {
        return message.reply('❌ Shows data not loaded! Please run "npm run parse-shows-imdb-images" first.');
      }

      const userId = message.author.id;

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

      const [show1, show2] = game.getTwoRandomShows(showsData, session.usedShowIds || []);
      if (!show1 || !show2) {
        return message.reply('❌ Not enough shows available!');
      }

      if (!session.usedShowIds) {
        session.usedShowIds = [];
      }
      session.usedShowIds.push(show1.id, show2.id);

      const duelMessage = await game.createShowDuelMessage(show1, show2, userId, 1);

      await message.reply(duelMessage);

      if (duelMessage._compositePath) {
        game.cleanupCompositeImage(duelMessage._compositePath);
      }
    } catch (error) {
      console.error('Error starting show duel:', error);
      await message.reply('❌ An error occurred while starting the duel. Please try again.');
    }
    return;
  }

  // !resetrank command (admin only - you can add permission checks if needed)
  if (message.content.toLowerCase() === '!resetrank') {
    try {
      await game.resetRankings();
      await message.reply('✅ Rankings have been reset!');
    } catch (error) {
      console.error('Error resetting rankings:', error);
      await message.reply('❌ An error occurred while resetting rankings.');
    }
    return;
  }
});

// Login to Discord with your client's token
if (!config.token) {
  console.error('❌ Error: DISCORD_BOT_TOKEN is not set!');
  console.log('Please set your bot token in a .env file or as an environment variable.');
  console.log('Get your bot token from: https://discord.com/developers/applications');
  process.exit(1);
}

client.login(config.token);
