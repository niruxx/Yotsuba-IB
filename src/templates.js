// Curated starter sets inspired by familiar imageboards, not a live-site import.
export const BOARD_TEMPLATES = {
  '4chan': { title: '4chan-style starter', layout: 'legacy', boards: [
    ['a', 'Anime & Manga', 'Japanese Culture'], ['jp', 'Otaku Culture', 'Japanese Culture'],
    ['g', 'Technology', 'Interests'], ['v', 'Video Games', 'Interests'], ['vg', 'Video Game Generals', 'Interests'],
    ['tv', 'Television & Film', 'Interests'], ['mu', 'Music', 'Interests'], ['lit', 'Literature', 'Interests'],
    ['sci', 'Science & Math', 'Interests'], ['his', 'History & Humanities', 'Interests'],
    ['fit', 'Fitness', 'Lifestyle'], ['ck', 'Food & Cooking', 'Lifestyle'], ['wg', 'Wallpapers / General', 'Creative'],
  ] },
  '8kun': { title: '8kun-style starter', layout: 'standard', boards: [
    ['general', 'General Discussion', 'Community'], ['meta', 'Site Discussion', 'Community'],
    ['tech', 'Technology', 'Interests'], ['games', 'Video Games', 'Interests'],
    ['anime', 'Anime & Manga', 'Interests'], ['art', 'Artwork', 'Creative'],
    ['music', 'Music', 'Creative'], ['news', 'News', 'Discussion'],
  ] },
};
