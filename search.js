(function initializeSearchCore(globalScope, factory) {
  const searchCore = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = searchCore;
  }

  if (globalScope) {
    globalScope.BookmarkSearchCore = searchCore;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const domainPrefix = 'domain:';
  const titleCollator = new Intl.Collator('zh-CN', { sensitivity: 'base' });

  function normalizeSearchText(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .toLocaleLowerCase();
  }

  function parseSearchQuery(value) {
    const text = String(value || '').trim();
    const rawTokens = text.match(/"[^"]+"|\S+/g) || [];
    const terms = [];
    const domains = [];

    rawTokens.forEach(rawToken => {
      const token = normalizeSearchText(rawToken.replace(/^"|"$/g, ''));
      if (!token) return;

      if (token.startsWith(domainPrefix) && token.length > domainPrefix.length) {
        domains.push(token.slice(domainPrefix.length).replace(/^www\./, ''));
      } else {
        terms.push(token);
      }
    });

    return {
      text,
      terms: [...new Set(terms)],
      domains: [...new Set(domains)],
      isEmpty: terms.length === 0 && domains.length === 0
    };
  }

  function getSearchDomain(url) {
    try {
      return normalizeSearchText(new URL(url).hostname).replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function prepareSearchItem(item) {
    return {
      ...item,
      searchTitle: normalizeSearchText(item.title),
      searchUrl: normalizeSearchText(item.url),
      searchPath: normalizeSearchText(item.path),
      searchDomain: getSearchDomain(item.url)
    };
  }

  function fuzzyMatchNormalized(normalizedText, normalizedPattern) {
    if (!normalizedText || !normalizedPattern) return 0;

    let score = 0;
    let textCursor = 0;
    let previousMatch = -2;

    for (const character of normalizedPattern) {
      const matchIndex = normalizedText.indexOf(character, textCursor);
      if (matchIndex === -1) return 0;

      const gap = matchIndex - textCursor;
      score += Math.max(1, 7 - gap);
      if (matchIndex === previousMatch + 1) score += 6;
      if (matchIndex === 0) score += 5;

      previousMatch = matchIndex;
      textCursor = matchIndex + 1;
    }

    return score;
  }

  function fuzzyMatch(text, pattern) {
    return fuzzyMatchNormalized(
      normalizeSearchText(text),
      normalizeSearchText(pattern)
    );
  }

  function scoreTerm(item, term, fuzzySearch) {
    const { searchTitle, searchUrl, searchPath, searchDomain } = item;

    if (searchTitle === term) return 320;
    if (searchTitle.startsWith(term)) return 280;
    if (searchTitle.includes(term)) return 230;
    if (searchDomain.startsWith(term)) return 190;
    if (searchDomain.includes(term)) return 170;
    if (searchUrl.includes(term)) return 145;
    if (searchPath.includes(term)) return 105;

    if (!fuzzySearch) return -1;

    const titleFuzzyScore = fuzzyMatchNormalized(searchTitle, term);
    if (titleFuzzyScore > 0) return 60 + Math.min(titleFuzzyScore, 70);

    const urlFuzzyScore = fuzzyMatchNormalized(searchUrl, term);
    if (urlFuzzyScore > 0) return 30 + Math.min(urlFuzzyScore, 45);

    return -1;
  }

  function getUsageScore(usage = {}, now = Date.now()) {
    const safeUsage = usage && typeof usage === 'object' ? usage : {};
    const count = Number.isFinite(safeUsage.count) ? safeUsage.count : 0;
    const lastUsed = Number.isFinite(safeUsage.lastUsed) ? safeUsage.lastUsed : 0;
    const countScore = Math.min(32, Math.log2(count + 1) * 8);
    if (!lastUsed) return countScore;

    const ageInDays = Math.max(0, now - lastUsed) / 86400000;
    const recencyScore = ageInDays < 1
      ? 24
      : ageInDays < 7
        ? 16
        : ageInDays < 30
          ? 8
          : 0;

    return countScore + recencyScore;
  }

  function scoreSearchItem(item, query, options = {}) {
    const indexedItem = item.searchTitle === undefined ? prepareSearchItem(item) : item;
    const { fuzzySearch = false, usageStats = {}, now = Date.now() } = options;

    if (query.domains.length > 0) {
      const matchesDomain = indexedItem.searchDomain
        && query.domains.some(domain => indexedItem.searchDomain.includes(domain));
      if (!matchesDomain) return null;
    }

    let score = query.domains.length > 0 ? 120 : 0;
    for (const term of query.terms) {
      const termScore = scoreTerm(indexedItem, term, fuzzySearch);
      if (termScore < 0) return null;
      score += termScore;
    }

    if (indexedItem.type === 'bookmark') {
      score += getUsageScore(usageStats[indexedItem.id], now);
    }

    return score;
  }

  function searchAndRank(items, queryValue, options = {}) {
    const query = typeof queryValue === 'string' ? parseSearchQuery(queryValue) : queryValue;
    if (!query || query.isEmpty) return [...items];
    const rankOptions = {
      ...options,
      now: Number.isFinite(options.now) ? options.now : Date.now()
    };

    return items
      .map(item => {
        const indexedItem = item.searchTitle === undefined ? prepareSearchItem(item) : item;
        return {
          item: indexedItem,
          score: scoreSearchItem(indexedItem, query, rankOptions)
        };
      })
      .filter(result => result.score !== null)
      .sort((first, second) => {
        const scoreDifference = second.score - first.score;
        if (scoreDifference !== 0) return scoreDifference;
        return titleCollator.compare(first.item.title, second.item.title);
      })
      .map(result => result.item);
  }

  return {
    fuzzyMatch,
    getSearchDomain,
    getUsageScore,
    normalizeSearchText,
    parseSearchQuery,
    prepareSearchItem,
    scoreSearchItem,
    searchAndRank
  };
}));
