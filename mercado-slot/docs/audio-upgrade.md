# Mercado de Oro — street-party audio

The old 94 BPM oscillator/mallet loop has been replaced by a 120 BPM merengue arrangement with horns, guitar, piano, bass and Latin percussion. A 64-second passage gives the background room to develop rather than repeating a tiny melody. The opening uses the same musical theme, mixed with cooking texture. Its video frames are unchanged.

## Music credit and permission

**“Notanico Merengue” — Kevin MacLeod (incompetech.com)**  
ISRC: USUAN1100130  
Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

- [Artist catalog and track](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100130)
- [Artist's licensing page](https://incompetech.com/music/royalty-free/licenses/)
- [Artist's FAQ: attribution, games and permitted edits](https://incompetech.com/music/royalty-free/faq.html)
- [Official catalog metadata](https://incompetech.com/music/royalty-free/pieces.json)
- [Original MP3](https://incompetech.com/music/royalty-free/mp3-royaltyfree/Notanico%20Merengue.mp3)

Verified 2026-10-12. The artist's current FAQ offers CC BY 4.0 music with visible attribution and specifically describes credits in game settings. Credits, source links, license and edit notice are visible under **Settings → Music credits** in both English and Spanish. This is licensed music, not public-domain music. No paid generation or new subscription was used.

Original MP3 SHA-256: `b88a89782ddba8a2e97ed2cd759586f28cdf943688d7a1cdc5e611249c517bbf`.

Changes: 32-bar / 64-second loop starting at 8.305 seconds, short waveform crossfade at the circular join, gain adjustment and AAC compression. The original composer remains credited for the music. The game adds its own cooking ambience and cue mix separately.

## Cooking texture and playback

The grill layer uses the first 1.15 seconds of the game's already approved Seedance opening. Overlapping grains, filtering and slow gain variation turn that sound into a 12-second cooking texture, removing the conspicuous one-second repeat. It is a processed game asset, not a newly recorded market or intelligible crowd dialogue.

The music streams through one native audio element into Web Audio. Its full minute is not decoded into a retained PCM buffer, and there is no recurring music-note timer. The short grill buffer and existing game cues use separate gain buses. Music starts after the player's entrance gesture, remains on by default, respects saved preferences, pauses during the CG, and pauses when sound is muted or the page is hidden. Audio fetch/play failures do not prevent entering or spinning.

The same licensed theme replaces the opening's original music, with the game's cooking texture underneath. Replaying the opening pauses the game score and resumes it at the same position when the CG ends. No result, wager or RNG code depends on any audio operation.

## Rebuild

Run `python mercado-slot/tools/import-audio.py` from the repository root. It requires `numpy`, `imageio-ffmpeg`, the original approved CG in `.asset-work/mercado-v2-originals/`, and the pinned source MP3 (downloaded from the artist if absent). Only the AAC assets, opening audio track and corresponding media manifest metadata are rewritten. Run the ordinary Mercado production build and asset verification afterward.
