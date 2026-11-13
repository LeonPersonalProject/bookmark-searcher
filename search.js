(function initializeSearchCore(globalScope, factory) {
  const pinyin = typeof module !== 'undefined' && module.exports
    ? require('./pinyin.js')
    : globalScope?.BookmarkPinyin;
  const searchCore = factory(pinyin);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = searchCore;
  }

  if (globalScope) {
    globalScope.BookmarkSearchCore = searchCore;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, pinyin => {
  'use strict';

  const domainPrefix = 'domain:';
  const titleCollator = new Intl.Collator('zh-CN', { sensitivity: 'base' });
  const pinyinIndexCache = new WeakMap();
  const graphemeSegmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
    : null;

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
      textCursor = matchIndex + character.length;
    }

    return score;
  }

  function fuzzyMatch(text, pattern) {
    return fuzzyMatchNormalized(
      normalizeSearchText(text),
      normalizeSearchText(pattern)
    );
  }

  function matchesDomain(hostname, domain) {
    const host = normalizeSearchText(hostname).replace(/\.$/, '');
    const requested = normalizeSearchText(domain).replace(/\.$/, '');
    return Boolean(host && requested && (host === requested || host.endsWith(`.${requested}`)));
  }

  function getPinyinIndex(item, field) {
    let indexes = pinyinIndexCache.get(item);
    if (!indexes) {
      indexes = {};
      pinyinIndexCache.set(item, indexes);
    }
    const source = String(item[field] || '');
    if (!indexes[field] || indexes[field].source !== source) {
      indexes[field] = { source, index: pinyin.createIndex(source) };
    }
    return indexes[field].index;
  }

  function getPinyinMatches(item, term) {
    if (!pinyin?.normalizeQuery(term)) return [];
    return ['title', 'path'].flatMap(field => {
      const normalized = field === 'title' ? item.searchTitle : item.searchPath;
      if (!pinyin.canMatch(normalized, term)) return [];
      return pinyin.findMatches(getPinyinIndex(item, field), term)
        .map(match => ({ ...match, field, score: field === 'path' ? match.score - 15 : match.score }));
    });
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

    let bestScore = -1;
    if (pinyin?.normalizeQuery(term)) {
      if (pinyin.canMatch(searchTitle, term)) bestScore = pinyin.getScore(getPinyinIndex(item, 'title'), term);
      if (pinyin.canMatch(searchPath, term)) bestScore = Math.max(bestScore, pinyin.getScore(getPinyinIndex(item, 'path'), term) - 15);
    }
    if (!fuzzySearch) return bestScore;

    const titleFuzzyScore = fuzzyMatchNormalized(searchTitle, term);
    if (titleFuzzyScore > 0) bestScore = Math.max(bestScore, 60 + Math.min(titleFuzzyScore, 70));

    const urlFuzzyScore = fuzzyMatchNormalized(searchUrl, term);
    if (urlFuzzyScore > 0) bestScore = Math.max(bestScore, 30 + Math.min(urlFuzzyScore, 45));

    return bestScore;
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
      const hasMatchingDomain = indexedItem.searchDomain
        && query.domains.some(domain => matchesDomain(indexedItem.searchDomain, domain));
      if (!hasMatchingDomain) return null;
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

  function mergeRanges(ranges) {
    const result = [];
    ranges.slice().sort((first, second) => first.start - second.start || first.end - second.end).forEach(range => {
      const previous = result[result.length - 1];
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push({ start: range.start, end: range.end });
      }
    });
    return result;
  }

  function normalizeWithRanges(value) {
    const text = String(value || '');
    const segments = graphemeSegmenter
      ? graphemeSegmenter.segment(text)
      : Array.from(text, character => ({ segment: character }));
    const positions = [];
    let normalized = '';
    let cursor = 0;
    for (const entry of segments) {
      const start = entry.index === undefined ? cursor : entry.index;
      const end = start + entry.segment.length;
      const part = entry.segment.normalize('NFKC').toLocaleLowerCase();
      normalized += part;
      for (let offset = 0; offset < part.length; offset++) positions.push({ start, end });
      cursor = end;
    }
    const leadingSpaceCount = normalized.length - normalized.trimStart().length;
    const normalizedText = normalizeSearchText(text);
    return { text: normalizedText, positions: positions.slice(leadingSpaceCount, leadingSpaceCount + normalizedText.length) };
  }

  function findLiteralMatch(value, term) {
    const normalized = normalizeWithRanges(value);
    const ranges = [];
    let cursor = normalized.text.indexOf(term);
    const firstOffset = cursor;
    while (cursor >= 0) {
      const first = normalized.positions[cursor];
      const last = normalized.positions[cursor + term.length - 1];
      if (first && last) ranges.push({ start: first.start, end: last.end });
      cursor = normalized.text.indexOf(term, cursor + 1);
    }
    if (!ranges.length) return null;
    return {
      kind: normalized.text === term ? 'exact' : firstOffset === 0 ? 'prefix' : 'substring',
      ranges: mergeRanges(ranges)
    };
  }

  function findFuzzyMatch(value, term) {
    const normalized = normalizeWithRanges(value);
    const ranges = [];
    let cursor = 0;
    for (const character of term) {
      const found = normalized.text.indexOf(character, cursor);
      if (found < 0) return null;
      const first = normalized.positions[found];
      const last = normalized.positions[found + character.length - 1];
      if (!first || !last) return null;
      ranges.push({ start: first.start, end: last.end });
      cursor = found + character.length;
    }
    return ranges.length ? { kind: 'fuzzy', ranges: mergeRanges(ranges) } : null;
  }

  function getDomainRange(url) {
    const match = String(url || '').match(/^[a-z][a-z\d+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]+\]|[^:/?#]+)/i);
    if (!match) return [];
    const start = match[0].lastIndexOf(match[1]);
    return [{ start, end: start + match[1].length }];
  }

  function getMatchDetails(item, queryValue, options = {}) {
    const query = typeof queryValue === 'string' ? parseSearchQuery(queryValue) : queryValue;
    const indexedItem = item.searchTitle === undefined ? prepareSearchItem(item) : item;
    const fields = { title: [], url: [], path: [] };
    const matches = [];
    const matched = Boolean(query) && (query.isEmpty || scoreSearchItem(indexedItem, query, options) !== null);
    if (!matched || query.isEmpty) return { matched, fields, matches, primaryField: null, primaryKind: null };

    const append = match => {
      matches.push(match);
      fields[match.field === 'domain' ? 'url' : match.field].push(...match.ranges);
    };
    query.terms.forEach(term => {
      ['title', 'url', 'path'].forEach(field => {
        const literal = findLiteralMatch(indexedItem[field], term);
        if (literal) {
          const score = field === 'title'
            ? literal.kind === 'exact' ? 320 : literal.kind === 'prefix' ? 280 : 230
            : field === 'url' ? 145 : 105;
          append({ term, field, ...literal, score });
        } else if (options.fuzzySearch && field !== 'path') {
          const fuzzy = findFuzzyMatch(indexedItem[field], term);
          if (fuzzy) append({ term, field, ...fuzzy, score: field === 'title' ? 60 : 30 });
        }
      });
      getPinyinMatches(indexedItem, term).forEach(match => append({ term, ...match }));
    });
    query.domains.filter(domain => matchesDomain(indexedItem.searchDomain, domain)).forEach(domain => {
      append({ term: `${domainPrefix}${domain}`, field: 'domain', kind: 'exact', ranges: getDomainRange(indexedItem.url), score: 190 });
    });
    Object.keys(fields).forEach(field => { fields[field] = mergeRanges(fields[field]); });
    matches.sort((first, second) => second.score - first.score);
    return { matched, fields, matches, primaryField: matches[0]?.field || null, primaryKind: matches[0]?.kind || null };
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
    getMatchDetails,
    matchesDomain,
    normalizeSearchText,
    parseSearchQuery,
    prepareSearchItem,
    scoreSearchItem,
    searchAndRank
  };
}));
