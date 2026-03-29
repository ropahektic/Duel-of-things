const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const game = require('./game');
const path = require('path');
const fs = require('fs-extra');

const RANKING_FILE = path.join(__dirname, 'ranking.json');

// Store active multiduel lobbies
// Format: { channelId: { players: [], timer: null, timerEnd: null, round: 0, duelType: null, item1: null, item2: null, answers: {}, status: 'lobby'|'playing'|'ended' } }
const multiduelLobbies = {};

// Duel type configurations (duel1 to duel6)
const DUEL_TYPES = [
  {
    id: 1,
    name: 'Character Duel',
    question: 'Choose the character with more favorites!',
    emoji: '⚔️',
    getTwoRandom: (data) => game.getTwoRandomCharacters(data, []),
    getWinner: (item1, item2) => item1.favorites > item2.favorites ? item1 : item2,
    getResultText: (item1, item2, winner) => `**${item1.name}** has ${item1.favorites.toLocaleString()} favorites!\n**${item2.name}** has ${item2.favorites.toLocaleString()} favorites.\n\n**${winner.name}** wins!`
  },
  {
    id: 2,
    name: 'Anime Duel',
    question: 'Choose the anime ranked higher!',
    emoji: '🎌',
    getTwoRandom: (data) => game.getTwoRandomAnimes(data, []),
    getWinner: (item1, item2) => item1.rank < item2.rank ? item1 : item2,
    getResultText: (item1, item2, winner) => `**${item1.name}** is ranked #${item1.rank}!\n**${item2.name}** is ranked #${item2.rank}.\n\n**${winner.name}** wins!`
  },
  {
    id: 3,
    name: 'Games Duel',
    question: 'Which game has a better Metacritic score?',
    emoji: '🎮',
    getTwoRandom: (data) => game.getTwoRandomGames(data, []),
    getWinner: (item1, item2) => {
      const score1 = item1.metacriticScore !== undefined && item1.metacriticScore !== null ? item1.metacriticScore : -1;
      const score2 = item2.metacriticScore !== undefined && item2.metacriticScore !== null ? item2.metacriticScore : -1;
      return score1 > score2 ? item1 : item2;
    },
    getResultText: (item1, item2, winner) => `**${item1.name}** has more!\n**${item2.name}** has less.\n\n**${winner.name}** wins!`
  },
  {
    id: 4,
    name: 'Movies Duel',
    question: 'What movie has made more box office?',
    emoji: '🎬',
    getTwoRandom: (data) => game.getTwoRandomMovies(data, []),
    getWinner: (item1, item2) => item1.rank < item2.rank ? item1 : item2,
    getResultText: (item1, item2, winner) => `**${item1.name}** (${item1.year}) made more!\n**${item2.name}** (${item2.year}) made less.\n\n**${winner.name}** wins!`
  },
  {
    id: 5,
    name: 'Cities Duel',
    question: 'Which city has more population?',
    emoji: '🏙️',
    getTwoRandom: (data) => game.getTwoRandomCities(data, []),
    getWinner: (item1, item2) => item1.rank < item2.rank ? item1 : item2,
    getResultText: (item1, item2, winner) => `**${item1.name}** has more population!\n**${item2.name}** has less population.\n\n**${winner.name}** wins!`
  },
  {
    id: 6,
    name: 'Epic7 Duel',
    question: 'Who has a better RTA winrate?',
    emoji: '⚔️',
    getTwoRandom: (data) => game.getTwoRandomEpic7(data, []),
    getWinner: (item1, item2) => item1.winrate > item2.winrate ? item1 : item2,
    getResultText: (item1, item2, winner) => `**${item1.name}** has ${item1.winrate}% winrate!\n**${item2.name}** has ${item2.winrate}% winrate.\n\n**${winner.name}** wins!`
  }
];

// Start a multiduel lobby
function startMultiduelLobby(channelId, hostUserId, hostUsername, client) {
  // Check if lobby already exists
  if (multiduelLobbies[channelId] && multiduelLobbies[channelId].status !== 'ended') {
    return { error: 'A multiduel is already in progress in this channel!' };
  }

  const lobby = {
    players: [{ userId: hostUserId, username: hostUsername }],
    timer: null,
    timerEnd: Date.now() + 10000, // 10 seconds from now
    round: 0,
    duelType: null,
    item1: null,
    item2: null,
    answers: {},
    status: 'lobby',
    channelId: channelId,
    roundTimer: null,
    roundTimerEnd: null,
    client: client
  };

  multiduelLobbies[channelId] = lobby;

  // Start countdown timer
  startLobbyTimer(channelId, client);

  return { success: true, lobby };
}

// Start lobby timer
function startLobbyTimer(channelId, client) {
  const lobby = multiduelLobbies[channelId];
  if (!lobby) return;

  // Clear existing timer
  if (lobby.timer) {
    clearInterval(lobby.timer);
  }

  // Store client reference
  if (client) {
    lobby.client = client;
  }

  // Reset timer to 10 seconds
  lobby.timerEnd = Date.now() + 10000;

  // Update every second
  lobby.timer = setInterval(async () => {
    const remaining = Math.ceil((lobby.timerEnd - Date.now()) / 1000);
    
    if (remaining <= 0) {
      clearInterval(lobby.timer);
      lobby.timer = null;
      // Start game if at least 2 players (minimum required)
      if (lobby.players.length >= 2) {
        startMultiduelGame(channelId, lobby.client);
      } else {
        // Not enough players - game is null
        const embed = new EmbedBuilder()
          .setTitle('❌ Multiduel Cancelled')
          .setDescription('Not enough players! Multiduel requires at least 2 players.')
          .setColor(0xED4245)
          .setTimestamp();
        
        if (lobby.client) {
          try {
            const channel = await lobby.client.channels.fetch(channelId);
            if (channel) {
              await channel.send({ embeds: [embed] });
            }
          } catch (error) {
            console.error('Error sending multiduel cancellation message:', error);
          }
        }
        
        lobby.status = 'ended';
        delete multiduelLobbies[channelId];
      }
    }
  }, 1000);
}

// Join multiduel lobby
function joinMultiduelLobby(channelId, userId, username) {
  const lobby = multiduelLobbies[channelId];
  
  if (!lobby || lobby.status !== 'lobby') {
    return { error: 'No active multiduel lobby found! Use `!multiduel` to start one.' };
  }

  // Check if already joined
  if (lobby.players.some(p => p.userId === userId)) {
    return { error: 'You are already in this multiduel!' };
  }

  // Check if full
  if (lobby.players.length >= 5) {
    return { error: 'Multiduel is full! (Max 5 players)' };
  }

  // Add player
  lobby.players.push({ userId, username });

  // Reset timer
  lobby.timerEnd = Date.now() + 10000;

  // If full, start immediately (will be handled by index.js)
  if (lobby.players.length >= 5) {
    clearInterval(lobby.timer);
    lobby.timer = null;
    return { success: true, started: true };
  }

  return { success: true, started: false, playerCount: lobby.players.length };
}

// Start the multiduel game
async function startMultiduelGame(channelId, client) {
  const lobby = multiduelLobbies[channelId];
  if (!lobby) return;

  lobby.status = 'playing';
  lobby.round = 1;
  lobby.client = client; // Store client reference for sending messages
  
  // Start first round
  await startMultiduelRound(channelId, client);
}

// Start a round
async function startMultiduelRound(channelId, client) {
  const lobby = multiduelLobbies[channelId];
  if (!lobby) return;

  // Check if game should end
  if (lobby.players.length === 0) {
    lobby.status = 'ended';
    delete multiduelLobbies[channelId];
    return;
  }

  if (lobby.players.length === 1) {
    // Only 1 player remaining - game is null (no winner)
    const embed = new EmbedBuilder()
      .setTitle('❌ Multiduel Cancelled')
      .setDescription('Not enough players remaining! Multiduel requires at least 2 players. Game is null.')
      .setColor(0xED4245)
      .setTimestamp();
    
    if (client) {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    }
    
    lobby.status = 'ended';
    delete multiduelLobbies[channelId];
    return { winner: null, gameNull: true };
  }

  // Cycle through duel types: 1,2,3,4,5,6,1,2,3...
  const duelTypeIndex = ((lobby.round - 1) % 6);
  const duelType = DUEL_TYPES[duelTypeIndex];
  lobby.duelType = duelType;

  // Get data based on duel type
  let data;
  switch (duelType.id) {
    case 1: data = require('./characters-data'); break;
    case 2: data = require('./anime-data'); break;
    case 3: data = require('./games-data'); break;
    case 4: data = require('./movies-data'); break;
    case 5: data = require('./cities-data'); break;
    case 6: data = require('./epic7-data'); break;
  }

  // Get two random items
  const items = duelType.getTwoRandom(data);
  if (!items || !items[0] || !items[1]) {
    return { error: 'Failed to get duel items!' };
  }

  lobby.item1 = items[0];
  lobby.item2 = items[1];
  lobby.answers = {};
  lobby.roundTimerEnd = Date.now() + 10000; // 10 seconds to answer

  // Create round message
  const roundMessage = await createMultiduelRoundMessage(lobby, duelType);

  // Send round message
  if (client) {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      await channel.send(roundMessage);
    }
  }

  // Start round timer
  lobby.roundTimer = setTimeout(async () => {
    await endMultiduelRound(channelId, client);
  }, 10000);

  return roundMessage;
}

// Create multiduel round message
async function createMultiduelRoundMessage(lobby, duelType) {
  const imageType = duelType.id === 1 ? 'character' : duelType.id === 2 ? 'anime' : duelType.id === 3 ? 'games' : duelType.id === 4 ? 'movies' : duelType.id === 5 ? 'cities' : 'epic7';
  const compositePath = await game.createCompositeImage(lobby.item1, lobby.item2, imageType);

  const embed = new EmbedBuilder()
    .setTitle(`${duelType.emoji} Multi-Duel Round ${lobby.round} - ${duelType.name} ${duelType.emoji}`)
    .setDescription(`**${lobby.item1.name}** vs **${lobby.item2.name}**\n\n${duelType.question}\n\n**Players remaining:** ${lobby.players.length}\n**Time limit:** 10 seconds`)
    .setColor(0x5865F2)
    .setTimestamp();

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`md_${lobby.channelId}_${lobby.item1.id}_${lobby.item2.id}_left`)
        .setLabel(lobby.item1.name.length > 20 ? lobby.item1.name.substring(0, 20) + '...' : lobby.item1.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(duelType.emoji),
      new ButtonBuilder()
        .setCustomId(`md_${lobby.channelId}_${lobby.item1.id}_${lobby.item2.id}_right`)
        .setLabel(lobby.item2.name.length > 20 ? lobby.item2.name.substring(0, 20) + '...' : lobby.item2.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(duelType.emoji)
    );

  const result = {
    embeds: [embed],
    components: [row],
    _compositePath: compositePath
  };

  if (compositePath) {
    const attachment = new AttachmentBuilder(compositePath, { name: 'duel.png' });
    embed.setImage('attachment://duel.png');
    result.files = [attachment];
  }

  return result;
}

// Handle multiduel answer
function handleMultiduelAnswer(channelId, userId, selectedId, leftId, rightId, client) {
  const lobby = multiduelLobbies[channelId];
  
  if (!lobby || lobby.status !== 'playing') {
    return { error: 'No active multiduel round!' };
  }

  // Check if player is in the game
  const player = lobby.players.find(p => p.userId === userId);
  if (!player) {
    return { error: 'You are not in this multiduel!' };
  }

  // Check if already answered
  if (lobby.answers[userId]) {
    return { error: 'You have already answered this round!' };
  }

  // Check if time is up
  if (Date.now() >= lobby.roundTimerEnd) {
    return { error: 'Time is up! You did not answer in time.' };
  }

  // Record answer
  const selected = selectedId === leftId ? 'left' : 'right';
  lobby.answers[userId] = selected;

  // Check if all players have answered - end round early
  const allAnswered = lobby.players.every(p => lobby.answers[p.userId]);
  if (allAnswered && lobby.roundTimer) {
    // Clear timer and end round early
    clearTimeout(lobby.roundTimer);
    lobby.roundTimer = null;
    setTimeout(async () => {
      await endMultiduelRound(channelId, client || lobby.client);
    }, 500);
  }

  return { success: true, answered: true, allAnswered };
}

// End multiduel round
async function endMultiduelRound(channelId, client) {
  const lobby = multiduelLobbies[channelId];
  if (!lobby) return;

  // Clear round timer
  if (lobby.roundTimer) {
    clearTimeout(lobby.roundTimer);
    lobby.roundTimer = null;
  }

  const duelType = lobby.duelType;
  const winner = duelType.getWinner(lobby.item1, lobby.item2);
  const winnerSide = winner.id === lobby.item1.id ? 'left' : 'right';

  // Determine who answered correctly and who didn't
  const correctPlayers = [];
  const wrongPlayers = [];
  const noAnswerPlayers = [];

  for (const player of lobby.players) {
    const answer = lobby.answers[player.userId];
    if (!answer) {
      noAnswerPlayers.push(player);
    } else if (answer === winnerSide) {
      correctPlayers.push(player);
    } else {
      wrongPlayers.push(player);
    }
  }

  // Eliminate wrong and no-answer players
  lobby.players = correctPlayers;

  // Create result embed
  const resultEmbed = new EmbedBuilder()
    .setTitle(`📊 Round ${lobby.round} Results`)
    .setDescription(duelType.getResultText(lobby.item1, lobby.item2, winner))
    .setColor(0xFFD700)
    .setTimestamp();

  let resultText = '';

  if (correctPlayers.length > 0) {
    resultText += `\n\n✅ **Correct:** ${correctPlayers.map(p => p.username).join(', ')}`;
  }

  if (wrongPlayers.length > 0) {
    resultText += `\n\n❌ **Wrong (Eliminated):** ${wrongPlayers.map(p => p.username).join(', ')}`;
  }

  if (noAnswerPlayers.length > 0) {
    resultText += `\n\n⏰ **No Answer (Eliminated):** ${noAnswerPlayers.map(p => p.username).join(', ')}`;
  }

  resultEmbed.setDescription(resultEmbed.data.description + resultText);

  // Send result message
  if (client) {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      await channel.send({ embeds: [resultEmbed] });
    }
  }

  // Check for winner - if only 1 player remains after elimination, they win (since game started with 2+)
  if (lobby.players.length === 1) {
    const winnerPlayer = lobby.players[0];
    const winnerEmbed = new EmbedBuilder()
      .setTitle(`🏆 ${winnerPlayer.username} Wins! 🏆`)
      .setDescription(`**${winnerPlayer.username}** is the last player standing!\n\n**Rounds survived:** ${lobby.round}`)
      .setColor(0xFFD700)
      .setTimestamp();
    
    if (client) {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send({ embeds: [winnerEmbed] });
      }
    }
    
    // Save multiduel ranking (streak = rounds survived)
    await saveMultiduelRanking(winnerPlayer.userId, winnerPlayer.username, lobby.round);
    
    lobby.status = 'ended';
    delete multiduelLobbies[channelId];
    return { embed: resultEmbed, winner: winnerPlayer, gameEnded: true };
  }

  if (lobby.players.length === 0) {
    const noWinnerEmbed = new EmbedBuilder()
      .setTitle('❌ All Players Eliminated')
      .setDescription('No players remain!')
      .setColor(0xED4245)
      .setTimestamp();
    
    if (client) {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send({ embeds: [noWinnerEmbed] });
      }
    }
    
    lobby.status = 'ended';
    delete multiduelLobbies[channelId];
    return { embed: resultEmbed, gameEnded: true };
  }

  // Continue to next round after 2 seconds
  lobby.round++;
  
  setTimeout(async () => {
    await startMultiduelRound(channelId, client);
  }, 2000);
  
  return { embed: resultEmbed, gameEnded: false, nextRound: lobby.round };
}

// Save multiduel ranking
async function saveMultiduelRanking(userId, username, roundsSurvived) {
  try {
    const ranking = await fs.readJSON(RANKING_FILE);
    
    if (!ranking.multiduel) {
      ranking.multiduel = [];
    }
    
    const existingIndex = ranking.multiduel.findIndex(entry => entry.userId === userId);
    
    const entry = {
      userId,
      username,
      streak: roundsSurvived,
      date: new Date().toISOString()
    };
    
    if (existingIndex >= 0) {
      if (roundsSurvived > ranking.multiduel[existingIndex].streak) {
        ranking.multiduel[existingIndex] = entry;
      }
    } else {
      ranking.multiduel.push(entry);
    }
    
    ranking.multiduel.sort((a, b) => b.streak - a.streak);
    await fs.writeJSON(RANKING_FILE, ranking, { spaces: 2 });
  } catch (error) {
    console.error('Error saving multiduel ranking:', error);
  }
}

// Get lobby status
function getLobbyStatus(channelId) {
  return multiduelLobbies[channelId];
}

module.exports = {
  startMultiduelLobby,
  joinMultiduelLobby,
  handleMultiduelAnswer,
  endMultiduelRound,
  startMultiduelGame,
  startMultiduelRound,
  getLobbyStatus,
  DUEL_TYPES
};
