const fs = require('fs');
const path = require('path');

const SHOWS_TXT = path.join(__dirname, 'shows.txt');
const SHOWS_DATA_FILE = path.join(__dirname, 'shows-data.js');

function parseShowsTxtRatings(txt) {
  const blocks = txt.split(/\r?\n\s*\r?\n/).filter(b => b.trim());
  const byRank = new Map();

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const rankLine = lines.find(l => /^#\d+$/.test(l));
    const rank = rankLine ? parseInt(rankLine.slice(1), 10) : null;
    if (!rank) continue;

    // First "X.Y" line is the IMDb rating in this file format.
    const ratingLine = lines.find(l => /^\d\.\d$/.test(l));
    const rating = ratingLine ? parseFloat(ratingLine) : null;

    if (rating !== null && Number.isFinite(rating)) {
      byRank.set(rank, rating);
    }
  }

  return byRank;
}

function main() {
  if (!fs.existsSync(SHOWS_TXT)) {
    console.error(`Missing ${SHOWS_TXT}`);
    process.exit(1);
  }
  if (!fs.existsSync(SHOWS_DATA_FILE)) {
    console.error(`Missing ${SHOWS_DATA_FILE}`);
    process.exit(1);
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const shows = require('./shows-data');
  if (!Array.isArray(shows) || shows.length === 0) {
    console.error('shows-data.js did not export an array');
    process.exit(1);
  }

  const txt = fs.readFileSync(SHOWS_TXT, 'utf-8');
  const ratingsByRank = parseShowsTxtRatings(txt);

  let updated = 0;
  for (const s of shows) {
    if (!s || typeof s.rank !== 'number') continue;
    const rating = ratingsByRank.get(s.rank);
    if (rating === undefined) continue;
    if (s.rating !== rating) {
      s.rating = rating;
      updated++;
    }
  }

  fs.writeFileSync(
    SHOWS_DATA_FILE,
    `module.exports = ${JSON.stringify(shows, null, 2)};\n`,
    'utf-8'
  );

  console.log(`✅ Wrote ratings to shows-data.js (${updated} updated)`);
}

main();

