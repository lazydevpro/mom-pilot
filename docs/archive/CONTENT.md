# Demo content credits

The catalog contains one full Blender open movie, a trailer, and an excerpt. They are sample content for demonstrating remote selection and playback, not a claim of a personalized or age-rated entertainment library. Review each preview’s content note before choosing it.

The MIT license for MomPilot source does not cover these movies or stills. They retain their original Creative Commons terms. Media comes from the fixed server catalog; caregivers cannot submit arbitrary streaming URLs.

## Big Buck Bunny (2008)

**Credit:** © 2008 Blender Foundation / [Big Buck Bunny](https://peach.blender.org/). Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

- **Playback:** [Full movie MP4 hosted by W3C](https://media.w3.org/2010/05/bunny/movie.mp4), approximately ten minutes. W3C’s [HTML5 video demonstration](https://www.w3.org/2010/05/video/mediaevents) lists the movie among its test sources.
- **Bundled still:** `public/images/bunny.jpg` comes from [bunny-bow.png in the official gallery](https://peach.blender.org/wp-content/uploads/bunny-bow.png). It retains its source PNG encoding despite the local `.jpg` filename.
- **Original sources:** [Media gallery](https://peach.blender.org/media-gallery/) and [copyright/sharing terms](https://peach.blender.org/about/).

The official terms specify preserving the complete end credits when showing the entire movie and the creator attribution for extracts. The linked full movie is not intentionally edited by MomPilot. The displayed still is scaled/cropped by the interface; no Blender or project logo is used as MomPilot branding.

## Sintel (2010) — trailer

**Credit:** © Blender Foundation / [Sintel](https://durian.blender.org/). Licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).

- **Playback:** [Official 480p trailer MP4](https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4), 52.209 seconds. This is the trailer, not the full film.
- **Bundled still:** `public/images/sintel.jpg` comes from [03.2a_comp_000017.jpg in the official gallery](https://durian.blender.org/wp-content/uploads/2010/06/03.2a_comp_000017.jpg).
- **Original sources:** [Gallery](https://durian.blender.org/gallery/), [downloads](https://durian.blender.org/download/), and [sharing terms](https://durian.blender.org/sharing/).

The trailer is streamed as supplied. The still is displayed with interface scaling/cropping. The official sharing page excludes logos and unrelated third-party material from its grant.

## Elephants Dream (2006) — excerpt

**Credit:** © 2006 Blender Foundation / Netherlands Media Art Institute / [Elephants Dream](https://orange.blender.org/). Licensed under [Creative Commons Attribution 2.5](https://creativecommons.org/licenses/by/2.5/).

- **Playback:** [MP4 excerpt hosted by The Paciello Group’s browser accessibility tests](https://thepaciellogroup.github.io/AT-browser-tests/video/ElephantsDream.mp4), 37.012 seconds. It is an excerpt and re-encode of the film, not the full movie; MomPilot did not create that edit.
- **Bundled still:** `public/images/dream.jpg` comes from [s3_both.jpg in the official gallery](https://orange.blender.org/wp-content/themes/orange/images/media/gallery/s3_both.jpg).
- **Original sources:** [Media gallery](https://orange.blender.org/media-gallery/) and [copyright/sharing terms](https://orange.blender.org/blog/creative-commons-license-2/).

The excerpt credit includes the Netherlands Media Art Institute as requested by the official source. The still is displayed with interface scaling/cropping. Separate downloadable soundtrack files have different terms; those files are not included in MomPilot.

## Availability and verification

On 29 September 2026, the three selected video URLs and the three official still URLs returned HTTP 200 for header requests. The Sintel and Elephants Dream durations were checked from bounded MP4 metadata range reads. HTTP availability is not a device playback test; codec support, startup, sound, and failure states still need browser and physical Fire TV verification.

The formerly common Google sample-bucket URLs returned HTTP 403 in this environment, so they are not used. Some current Blender full-film download listings contain ZIP archives or MKV files, which are not interchangeable with direct browser MP4 playback URLs.

The stills are bundled for a dependable local layout. Video stays on its public host and requires internet access; availability is outside MomPilot’s control. For a controlled future deployment, prepare an authorized hosting copy with the required credits and correct media metadata. Do not use footage from YouTube by extracting or restreaming it.

## Submission attribution

When a recorded demonstration includes these clips or stills, include their creator, source link, and license link in the video description or accompanying credits, and identify any changes made for the recording. Preserve full end credits for any full-film screening. The catalog already separates the full film from the trailer and excerpt. None of these creators or hosts endorse MomPilot.
