// =========================
// GENERIC TITLE DETECTION
// =========================
function isGenericTitle(title) {
  const genericTitles = [
    'happy birthday',
    'twinkle twinkle little star',
    'twinkle twinkle',
    'old macdonald',
    'mary had a little lamb',
    'abc song',
    'row row row your boat',
    'the wheels on the bus',
    'itsy bitsy spider',
    'baa baa black sheep',
    'london bridge',
    'ring around the rosie',
    'humpty dumpty',
    'head shoulders knees and toes',
    'if you\'re happy and you know it',
  ];

  const cleanTitle = title.toLowerCase().trim();
  return genericTitles.some(generic => cleanTitle.includes(generic));
}

// =========================
// TITLE SIMILARITY HELPERS
// =========================

// 🔧 FIX: NEW function to clean titles before comparison
function cleanTitleForComparison(title) {
  if (!title || typeof title !== 'string') {
    return '';
  }

  let cleaned = title
    // Remove everything in parentheses and brackets
    .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
    // Remove common variation indicators at the end
    .replace(/\s*-\s*(remix|mix|edit|acoustic|live|remaster|demo|version|made popular by|backing|karaoke|instrumental|tribute|cover).*$/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Safety: If cleaning removed everything, return original (lowercased)
  if (cleaned.length === 0) {
    return title.toLowerCase().trim();
  }

  return cleaned;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  // Exact match
  if (s1 === s2) return 1.0;

  // One contains the other completely
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = Math.max(s1.length, s2.length);
    const shorter = Math.min(s1.length, s2.length);
    return shorter / longer;
  }

  // Calculate Levenshtein-based similarity
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshtein(s1, s2);
  return (longer.length - editDistance) / longer.length;
}


// =========================
// SMART RANKING LOGIC
// =========================
function rankACRResults(acrMatches) {
  return acrMatches.map(match => {
    let score = match.score || 0;

    const title = (match.title || '').toLowerCase();
    const artist = (match.artists?.[0]?.name || '').toLowerCase();
    const label = (match.label || '').toLowerCase();
    const combined = title + ' ' + artist + ' ' + label;

    const hasAsianChars = /[　-〿぀-ゟ゠-ヿ＀-ﾟ一-龯㐀-䶿가-힣]/.test(combined);
    const hasArabicChars = /[؀-ۿ]/.test(combined);
    const hasCyrillicChars = /[Ѐ-ӿ]/.test(combined);

    const nonEnglishIndicators = [
      'feat.', 'feat', 'с участием', 'con', 'avec', 'mit',
      'version', 'versión', 'versione'
    ];

    if (hasAsianChars || hasArabicChars || hasCyrillicChars) {
      score -= 0.55; // Slightly stronger penalty for clearly non-English matches
    } else {
      // Small positive bias for titles that look purely English
      score += 0.05;
    }

    const hasNonEnglishIndicator = nonEnglishIndicators.some(indicator =>
      combined.includes(indicator.toLowerCase())
    );

    if (hasNonEnglishIndicator) {
      score -= 0.15;
    }

    if (title.includes('cover') || title.includes('tribute') ||
        artist.includes('cover') || artist.includes('tribute')) {
      score -= 0.25;
    }

    if (title.includes('instrumental') || title.includes('karaoke') ||
        artist.includes('instrumental') || artist.includes('karaoke')) {
      score -= 0.30;
    }

    if (title.includes('live') || title.includes('live at')) {
      score -= 0.20;
    }

    if (title.includes('acoustic') || title.includes('remix')) {
      score -= 0.15;
    }

    const majorLabels = [
      'universal', 'sony', 'warner', 'columbia', 'atlantic',
      'capitol', 'republic', 'interscope', 'rca', 'epic'
    ];

    if (majorLabels.some(major => label.includes(major))) {
      score += 0.10;
    }

    if (label.includes('karaoke') || label.includes('tribute') ||
        label.includes('sound alike') || label.includes('backing')) {
      score -= 0.30;
    }

    return {
      ...match,
      adjustedScore: Math.max(0, Math.min(1, score)),
      hasNonEnglishChars: hasAsianChars || hasArabicChars || hasCyrillicChars
    };
  });
}

function combineWithSpotify(rankedMatches) {
  // Calculate title clusters (consensus boost)
  // If multiple results have similar titles, it's a strong signal
  const titleClusters = new Map();

  rankedMatches.forEach((match, index) => {
    const cleanedTitle = cleanTitleForComparison(match.title);
    let foundCluster = false;

    // Check if this title belongs to an existing cluster
    for (const [clusterKey, clusterData] of titleClusters.entries()) {
      const similarity = calculateSimilarity(cleanedTitle, clusterKey);
      if (similarity >= 0.75) { // 75% similarity threshold
        clusterData.count++;
        clusterData.matches.push(index);
        foundCluster = true;
        break;
      }
    }

    // Create new cluster if no match found
    if (!foundCluster) {
      titleClusters.set(cleanedTitle, {
        count: 1,
        matches: [index],
        key: cleanedTitle
      });
    }
  });

  // Log clusters
  console.log('\n🔗 Title clusters (consensus detection):');
  for (const [key, cluster] of titleClusters.entries()) {
    if (cluster.count > 1) {
      console.log(`   "${key}": ${cluster.count} similar matches`);
    }
  }

  return rankedMatches.map((match, index) => {
    let finalScore = match.adjustedScore;

    // Language penalty (apply again in final scoring for extra weight)
    const title = (match.title || '').toLowerCase();
    const artist = (match.artists?.[0]?.name || '').toLowerCase();
    const combined = title + ' ' + artist;

    const hasCyrillicChars = /[Ѐ-ӿ]/.test(combined);
    const hasAsianChars = /[　-〿぀-ゟ゠-ヿ＀-ﾟ一-龯㐀-䶿가-힣]/.test(combined);
    const hasArabicChars = /[؀-ۿ]/.test(combined);

    // Additional language weighting in final scoring
    if (hasCyrillicChars || hasAsianChars || hasArabicChars) {
      const languagePenalty = -0.30; // Slightly stronger final penalty for non-English
      finalScore += languagePenalty;
      console.log(`   🌍 Language penalty for "${match.title}": ${languagePenalty.toFixed(2)} (non-English)`);
    } else if (combined.trim().length > 0) {
      // Small bonus for clearly English-looking titles/artists
      const languageBonus = 0.05;
      finalScore += languageBonus;
      console.log(`   🇬🇧 Language bonus for "${match.title}": +${languageBonus.toFixed(2)} (English bias)`);
    }

    // Spotify popularity boost
    if (match.spotify && match.spotify.popularity) {
      // Non-linear boost: higher popularity gets exponentially more weight
      // Formula: (popularity/100)^1.5 * 0.80
      // This gives 84/100 → +0.61, 37/100 → +0.18 (bigger gap)
      const normalizedPop = match.spotify.popularity / 100;
      const popularityBoost = Math.pow(normalizedPop, 1.5) * 0.80;
      finalScore += popularityBoost;

      console.log(`   📈 Spotify boost for "${match.title}": +${popularityBoost.toFixed(2)} (popularity: ${match.spotify.popularity}/100)`);
    }

    // Consensus boost: if multiple results have similar titles, boost them
    const cleanedTitle = cleanTitleForComparison(match.title);
    for (const [clusterKey, clusterData] of titleClusters.entries()) {
      if (clusterData.matches.includes(index) && clusterData.count > 1) {
        // More matches = stronger signal
        // Formula: (clusterSize - 1) * 0.10, capped at 0.30
        const consensusBoost = Math.min((clusterData.count - 1) * 0.10, 0.30);
        finalScore += consensusBoost;
        console.log(`   🎯 Consensus boost for "${match.title}": +${consensusBoost.toFixed(2)} (${clusterData.count} similar matches)`);
        break;
      }
    }

    return {
      ...match,
      finalScore: Math.max(0, Math.min(1, finalScore)) // Ensure score stays in valid range
    };
  });
}

module.exports = {
  isGenericTitle,
  cleanTitleForComparison,
  levenshtein,
  calculateSimilarity,
  rankACRResults,
  combineWithSpotify,
};
