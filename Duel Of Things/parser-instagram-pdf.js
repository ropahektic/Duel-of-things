const fs = require('fs-extra');
const path = require('path');

const PDF_FILE = path.join(__dirname, 'instagram.pdf');
const DATA_FILE = path.join(__dirname, 'instagram-data.js');

// Parse followers string to number (e.g., "614.7M" -> 614700000)
function parseFollowers(followersStr) {
  if (!followersStr) return 0;
  
  const cleanStr = followersStr.trim().toUpperCase().replace(/,/g, '');
  const match = cleanStr.match(/^([\d.]+)([KM]?)$/);
  
  if (!match) return 0;
  
  const number = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'M') {
    return Math.round(number * 1000000);
  } else if (suffix === 'K') {
    return Math.round(number * 1000);
  }
  
  return Math.round(number);
}

// Main parsing function
async function parseInstagramPDF() {
  console.log('📱 Starting Instagram PDF Parser...\n');
  
  if (!await fs.pathExists(PDF_FILE)) {
    console.error(`❌ PDF file not found: ${PDF_FILE}`);
    return;
  }
  
  console.log(`📄 Reading PDF: ${PDF_FILE}`);
  
  // Try using pdf-parse (simpler API)
  try {
    const pdfParseModule = require('pdf-parse');
    const PDFParse = pdfParseModule.PDFParse;
    
    const dataBuffer = await fs.readFile(PDF_FILE);
    // Convert Buffer to Uint8Array
    const uint8Array = new Uint8Array(dataBuffer);
    
    const pdfParser = new PDFParse({ data: uint8Array });
    const pdfData = await pdfParser.getText();
    const text = pdfData.text || pdfData;
    const numpages = pdfData.total || pdfData.numpages || 0;
    
    console.log(`📊 PDF has ${numpages} pages`);
    console.log(`📝 Extracted ${text.length} characters of text\n`);
    
    // Parse the text to extract influencer data
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    const influencers = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Pattern: "1 Instagram (@instagram) 	~678 million"
      // or: "1 Cristiano Ronaldo (@cristiano) 	~641 million"
      const rankMatch = line.match(/^(\d{1,3})\s+(.+?)\s+\(@[^)]+\)\s+~?([\d.,]+)\s*(million|M|K|thousand)/i);
      
      if (rankMatch) {
        const rank = parseInt(rankMatch[1]);
        if (rank >= 1 && rank <= 200) {
          const name = rankMatch[2].trim();
          const followersNum = rankMatch[3].trim();
          const followersUnit = rankMatch[4].toLowerCase();
          
          // Convert to standard format (e.g., "678M" or "641M")
          let followers = followersNum;
          if (followersUnit === 'million' || followersUnit === 'm') {
            followers = followersNum + 'M';
          } else if (followersUnit === 'thousand' || followersUnit === 'k') {
            followers = followersNum + 'K';
          }
          
          if (name && followers) {
            influencers.push({
              rank,
              name,
              followersDisplay: followers,
              followers: parseFollowers(followers)
            });
            continue;
          }
        }
      }
      
      // Alternative pattern without @handle: "1 Name ~678 million"
      const simpleMatch = line.match(/^(\d{1,3})\s+(.+?)\s+~?([\d.,]+)\s*(million|M|K|thousand)/i);
      if (simpleMatch) {
        const rank = parseInt(simpleMatch[1]);
        if (rank >= 1 && rank <= 200) {
          const name = simpleMatch[2].trim();
          // Remove @handle if present
          const cleanName = name.replace(/\s*\(@[^)]+\)\s*/, '').trim();
          const followersNum = simpleMatch[3].trim();
          const followersUnit = simpleMatch[4].toLowerCase();
          
          let followers = followersNum;
          if (followersUnit === 'million' || followersUnit === 'm') {
            followers = followersNum + 'M';
          } else if (followersUnit === 'thousand' || followersUnit === 'k') {
            followers = followersNum + 'K';
          }
          
          if (cleanName && followers) {
            influencers.push({
              rank,
              name: cleanName,
              followersDisplay: followers,
              followers: parseFollowers(followers)
            });
            continue;
          }
        }
      }
    }
    
    console.log(`✅ Extracted ${influencers.length} influencers from PDF\n`);
    
    // Create data structure similar to other duel games
    const influencerData = influencers.map((inf) => ({
      id: `instagram-${inf.rank}`,
      name: inf.name,
      rank: inf.rank,
      followers: inf.followers,
      followersDisplay: inf.followersDisplay,
      imagePath: null // Will be added later
    }));
    
    // Sort by rank to ensure correct order
    influencerData.sort((a, b) => a.rank - b.rank);
    
    // Save to file
    const jsContent = `module.exports = ${JSON.stringify(influencerData, null, 2)};`;
    await fs.writeFile(DATA_FILE, jsContent, 'utf-8');
    
    console.log(`💾 Saved ${influencerData.length} influencers to: ${DATA_FILE}`);
    console.log(`\n📋 Sample data (first 5):`);
    influencerData.slice(0, 5).forEach(inf => {
      console.log(`   ${inf.rank}. ${inf.name} - ${inf.followersDisplay} followers`);
    });
    
    if (influencerData.length < 200) {
      console.log(`\n⚠️  Warning: Expected 200 influencers but found ${influencerData.length}`);
      console.log(`   First 10 lines of PDF text for debugging:`);
      lines.slice(0, 10).forEach((line, idx) => {
        console.log(`   ${idx + 1}: ${line.substring(0, 80)}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error parsing PDF:', error);
    throw error;
  }
}

// Run the parser
parseInstagramPDF().catch(console.error);
