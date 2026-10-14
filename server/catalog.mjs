/** Curated, licensed sample films. No client-supplied media URLs are accepted. */
export const catalog = [
  {
    id: 'bunny',
    title: 'Big Buck Bunny',
    subtitle: 'A little laughter, a lovely afternoon',
    description: 'A colorful animated short about a gentle rabbit and three mischievous woodland neighbors. Contains cartoon slapstick.',
    duration: '10 min',
    category: 'Lighthearted',
    thumbnail: '/images/bunny.jpg',
    videoUrl: 'https://media.w3.org/2010/05/bunny/movie.mp4',
    attribution: {
      creator: 'Blender Foundation',
      title: 'Big Buck Bunny (2008)',
      sourceUrl: 'https://peach.blender.org/',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    },
  },
  {
    id: 'sintel',
    title: 'Sintel trailer',
    subtitle: 'A beautiful, moving adventure',
    description: 'A short preview of a young traveler’s search for a dragon she befriended. This fantasy trailer includes scenes of peril.',
    duration: '52 sec',
    category: 'Adventure',
    thumbnail: '/images/sintel.jpg',
    videoUrl: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    attribution: {
      creator: 'Blender Foundation',
      title: 'Sintel (2010)',
      sourceUrl: 'https://durian.blender.org/',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    },
  },
  {
    id: 'dream',
    title: 'Elephants Dream excerpt',
    subtitle: 'A journey into an imagined world',
    description: 'A brief sample from the story of two companions in a strange mechanical world. Includes surreal imagery and a tense atmosphere.',
    duration: '37 sec',
    category: 'Imagination',
    thumbnail: '/images/dream.jpg',
    videoUrl: 'https://thepaciellogroup.github.io/AT-browser-tests/video/ElephantsDream.mp4',
    attribution: {
      creator: 'Blender Foundation / Netherlands Media Art Institute',
      title: 'Elephants Dream (2006)',
      sourceUrl: 'https://orange.blender.org/',
      license: 'CC BY 2.5',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
    },
  },
];

export const presets = [
  { id: 'found-video', text: 'I found the video for you ❤️' },
  { id: 'enjoy', text: 'Sit back and enjoy. Love you!' },
  { id: 'call-me', text: 'Give me a call when you’re ready.' },
];
