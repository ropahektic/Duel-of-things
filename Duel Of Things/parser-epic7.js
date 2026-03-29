const fs = require('fs-extra');
const path = require('path');

const INPUT_FILE = path.join(__dirname, 'epic7.txt');
const OUTPUT_FILE = path.join(__dirname, 'epic7-data.js');

async function parseEpic7() {
  try {
    console.log('📖 Reading epic7.txt...');
    const content = await fs.readFile(INPUT_FILE, 'utf-8');
    const lines = content.split('\n');
    
    const characters = [];
    let rank = 1;
    
    // Pattern: c{numbers}{Name}\t{pickrate}%\t{winrate}%\t{banrate}%
    const characterPattern = /^c(\d+)([^\t]+)\t([\d.]+)%\t([\d.]+)%\t([\d.]+)%/;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      const match = trimmedLine.match(characterPattern);
      if (match) {
        const [, id, name, pickrate, winrate, banrate] = match;
        
        const character = {
          id: `c${id}`,
          name: name.trim(),
          pickrate: parseFloat(pickrate),
          winrate: parseFloat(winrate),
          banrate: parseFloat(banrate),
          rank: rank++
        };
        
        characters.push(character);
        console.log(`[${rank - 1}] Parsed: ${character.name} (${character.pickrate}% pick, ${character.winrate}% win, ${character.banrate}% ban)`);
      }
    }
    
    console.log(`\n✅ Parsed ${characters.length} characters!`);
    
    // Sort by pickrate descending (most picked first)
    characters.sort((a, b) => b.pickrate - a.pickrate);
    
    // Update ranks after sorting
    characters.forEach((char, index) => {
      char.rank = index + 1;
    });
    
    // Write to JavaScript file
    const jsContent = `// Epic7 Character Data
// Generated from epic7.txt
// Contains ${characters.length} characters with pickrate, winrate, and banrate

module.exports = ${JSON.stringify(characters, null, 2)};
`;
    
    await fs.writeFile(OUTPUT_FILE, jsContent, 'utf-8');
    console.log(`\n💾 Saved to ${OUTPUT_FILE}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Total characters: ${characters.length}`);
    console.log(`   Top pickrate: ${characters[0].name} (${characters[0].pickrate}%)`);
    console.log(`   Highest winrate: ${characters.reduce((max, c) => c.winrate > max.winrate ? c : max).name} (${characters.reduce((max, c) => c.winrate > max.winrate ? c : max).winrate}%)`);
    console.log(`   Highest banrate: ${characters.reduce((max, c) => c.banrate > max.banrate ? c : max).name} (${characters.reduce((max, c) => c.banrate > max.banrate ? c : max).banrate}%)`);
    
  } catch (error) {
    console.error('❌ Error parsing epic7.txt:', error);
    process.exit(1);
  }
}

parseEpic7();
