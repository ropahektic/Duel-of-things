const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const SHOWS_TXT = path.join(__dirname, 'shows.txt');
const SHOWS_DATA_FILE = path.join(__dirname, 'shows-data.js');
const OUTPUT_DIR = path.join(__dirname, 'shows');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseShowsTxt(txt) {
  const blocks = txt.split(/\r?\n\s*\r?\n/).filter(b => b.trim());
  const shows = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    // Header line: "Title (YYYY)" after cleaning
    const header = lines[0];
    const yearMatch = header.match(/\((\d{4})\)\s*$/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const title = yearMatch ? header.replace(/\s*\(\d{4}\)\s*$/, '').trim() : header;

    // Rank line: "#1" somewhere near top (usually line 1)
    const rankLine = lines.find(l => /^#\d+$/.test(l));
    const rank = rankLine ? parseInt(rankLine.replace('#', ''), 10) : null;

    const id = `show-${slugify(title)}-${year || 'na'}`;

    shows.push({
      id,
      rank,
      title,
      year,
      name: year ? `${title} (${year})` : title,
      imagePath: null
    });
  }

  // Ensure sorted by rank if present; otherwise keep file order
  const withRank = shows.filter(s => typeof s.rank === 'number');
  if (withRank.length === shows.length) {
    shows.sort((a, b) => a.rank - b.rank);
  }

  return shows;
}

async function downloadImage(url, outPath) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 30000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.imdb.com/'
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    }
  });

  await fs.ensureDir(path.dirname(outPath));
  const writer = fs.createWriteStream(outPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function getImdbTopTvItems() {
  const res = await axios.get('https://www.imdb.com/chart/toptv/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 60000
  });

  const re = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
  const m = res.data.match(re);
  if (!m) {
    throw new Error('Could not find __NEXT_DATA__ in IMDb page');
  }

  const data = JSON.parse(m[1]);
  const edges = data?.props?.pageProps?.pageData?.chartTitles?.edges;
  if (!Array.isArray(edges) || edges.length < 200) {
    throw new Error(`Unexpected IMDb edges length: ${Array.isArray(edges) ? edges.length : 'null'}`);
  }

  return edges.map((e) => {
    const n = e?.node || {};
    return {
      title: n?.titleText?.text || null,
      year: n?.releaseYear?.year || null,
      imageUrl: n?.primaryImage?.url || null
    };
  });
}

async function run() {
  if (!await fs.pathExists(SHOWS_TXT)) {
    console.error(`Missing ${SHOWS_TXT}`);
    process.exit(1);
  }

  const txt = await fs.readFile(SHOWS_TXT, 'utf-8');
  const shows = parseShowsTxt(txt);
  console.log(`Loaded ${shows.length} shows from shows.txt`);

  if (shows.length !== 250) {
    console.warn(`⚠ Expected 250 shows; found ${shows.length}. Will still proceed by index.`);
  }

  await fs.ensureDir(OUTPUT_DIR);
  
  console.log('Fetching IMDb Top TV items via __NEXT_DATA__...');
  const imdbItems = await getImdbTopTvItems();
  console.log(`Found ${imdbItems.length} IMDb items`);

  const n = Math.min(shows.length, imdbItems.length);
  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < n; i++) {
    const show = shows[i];
    const imdb = imdbItems[i];

    const outPath = path.join(OUTPUT_DIR, `${show.id}.jpg`);
    const relPath = path.relative(__dirname, outPath).replace(/\\/g, '/');

    if (await fs.pathExists(outPath)) {
      show.imagePath = relPath;
      skipped++;
      continue;
    }

    const url = imdb.imageUrl;
    if (!url || !url.startsWith('http')) {
      failed++;
      continue;
    }

    try {
      await downloadImage(url, outPath);
      show.imagePath = relPath;
      success++;
      if ((i + 1) % 25 === 0) {
        await fs.writeFile(
          SHOWS_DATA_FILE,
          `module.exports = ${JSON.stringify(shows, null, 2)};\n`,
          'utf-8'
        );
        console.log(`💾 Saved progress at ${i + 1}/${n}`);
      }
    } catch (err) {
      failed++;
    }
  }

  await fs.writeFile(
    SHOWS_DATA_FILE,
    `module.exports = ${JSON.stringify(shows, null, 2)};\n`,
    'utf-8'
  );

  console.log('\n✅ Done!');
  console.log(`Total matched: ${n}`);
  console.log(`Downloaded: ${success}`);
  console.log(`Skipped existing: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Wrote: ${SHOWS_DATA_FILE}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

