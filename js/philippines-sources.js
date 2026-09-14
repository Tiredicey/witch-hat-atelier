export const PHILIPPINES_SOURCES = Object.freeze([
  { id: 'trends', label: 'Trending now', publisher: 'Google Trends', url: 'https://trends.google.com/trending?geo=PH', upstream: 'https://trends.google.com/trending/rss?geo=PH', kind: 'rss' },
  { id: '8list', label: 'Latest stories', path: '' },
  { id: 'weird', label: 'Weird news', path: 'news/weird/' },
  { id: 'health', label: 'Health', path: 'adulting/health/' },
  { id: 'learning', label: 'School & learning', path: 'adulting/school-and-learning/' },
  { id: 'movies', label: 'Movies & TV', path: 'pop/movies-and-tv/' },
  { id: 'music', label: 'Music', path: 'pop/music/' },
  { id: 'style', label: 'Style', path: 'lifestyle/style/' },
  { id: 'beauty', label: 'Beauty', path: 'lifestyle/beauty/' },
  { id: 'tech', label: 'Tech', path: 'lifestyle/tech/' },
].map(source => Object.freeze(source.id === 'trends' ? source : {
  ...source, publisher: '8List.ph', kind: 'listing',
  url: `https://8list.ph/${source.path ? `topic/${source.path}` : ''}`,
  upstream: `https://8list.ph/${source.path ? `topic/${source.path}` : ''}`,
})));

export const SEARCH_TYPES = Object.freeze([
  { value: '', label: 'Web Search' },
  { value: 'images', label: 'Image Search' },
  { value: 'news', label: 'News Search' },
  { value: 'froogle', label: 'Google Shopping' },
  { value: 'youtube', label: 'YouTube Search' },
]);

export function exploreUrl({ term = '', type = '', date = 'today 12-m' } = {}) {
  const url = new URL('https://trends.google.com/trends/explore');
  url.searchParams.set('geo', 'PH');
  url.searchParams.set('date', date);
  if (term.trim()) url.searchParams.set('q', term.trim());
  if (SEARCH_TYPES.some(item => item.value === type) && type) url.searchParams.set('gprop', type);
  return url.href;
}

export function safeSourceUrl(value, origin) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (origin && url.origin !== origin)) return '';
    return url.href;
  } catch { return ''; }
}
