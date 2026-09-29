# The dealer clips, and why they are generated rather than warped

Everything in `public/clips` except the opening used to be built here by tweening
between two stills with optical flow. That pipeline could hold the costume to
within a few units and it could not make her look alive, because a bilinear
displacement field applied to one JPEG has no way to rotate a head, move an eye
behind a lid, or let a shoulder come forward. Two independent reviewers watching
the idle loop said she looked "completely frozen", which was accurate.

The six dealer clips are now generated video. The opening still uses optical flow,
and should: it is six different camera set-ups, which is the one thing a
single-plate generator cannot give us.

## The one constraint that makes this work

Every clip is submitted with `public/art/dealer_cool.jpg` as **both** `startFrame`
and `endFrame`.

That single choice buys three separate things:

- **The costume is locked** without any of the region budgets the warp pipeline
  needed. The generator is not inventing a dress, it is continuing a photograph of
  one.
- **The idle loop closes.** Last frame returns to the first, so the bed loops with
  no crossfade and no visible jump. Measured at 1.81 on a 0-255 scale.
- **Every clip is a round trip from the resting pose**, which is exactly the star
  topology `Clip.tsx` already assumes: any clip can cut to any other because both
  ends of all of them are the same frame.

## Choosing the model

Three were run on the same idle prompt, same reference, same duration, and
measured with `scripts/verify-generated.mjs`. "moves" is against the clip's own
first frame, which is the only way to separate real movement from the generator
simply rendering a static object a little differently than our JPEG does.

| | Wan 2.7 | Kling 3 Omni | Veo 3.1 |
| --- | --- | --- | --- |
| starts on the master plate | 4.16 | 2.27 | 3.79 |
| loop closes | 1.73 | 0.74 | 2.59 |
| her face moves | 10.16 | 4.12 | 33.76 |
| room moves, worst | 3.34 | 1.31 | 14.29 |
| cost at 6s 1080p | 210 | 210 | 420 |

Kling is the most faithful of the three and it is unusable: 4.12 of facial change
over six seconds is a photograph with a blink in it, which is the exact defect
being fixed. Veo moves plenty and spends it badly - between 1.5s and 4.0s her jaw
widens into a different woman's face and the left shoulder strap climbs back onto
her shoulder, which is what the 14.29 in the bottles is really measuring.

**Wan 2.7** is the only one that is alive and still itself.

## What the clips are

| clip | seconds | the beat |
| --- | --- | --- |
| `idle` | 7 | the bed: two breaths, two blinks, eyes lowered |
| `deal` | 3 | her eyes follow the card out across the felt and come back |
| `warm` | 3 | eyes up, a courteous closed-lip smile, back down |
| `sharp` | 3 | eyes up, cool and level, no smile, back down |
| `shuffle` | 3 | a patient "just a moment" between shoes |
| `natural` | 3 | impressed, and conceding: a real smile and a small nod |

`natural` replaces a `caught` clip that played when the player caught her cheating.
The cheating mechanic is gone and the table plays straight, so the biggest reaction
she has is now for the player's blackjack rather than for being rumbled.

## Her hands never leave the felt, and that took four takes to accept

The model will move her hands on request - 23.77 and 41.88 on the hand box against
a noise floor of about 2.4 - and it cannot do it without breaking something else:

- Asked to riffle a deck, it conjured one out of empty air, melted her fingers into
  a solid red block, and vanished the deck again when her hands came down. There is
  nothing in the source photograph for a hand to hold, which is the root of it.
- Asked instead to square the cards inside the wooden shoe that really is in the
  plate, it fused her fingers into the wood.
- On two of the three takes her shoulder came up as she reached and carried the
  slipped strap up with it, which fails the strap check and breaks the loop.

So `deal` and `shuffle` are attention beats. The cards were always the game's own
elements animating over the top, and the riffle is a sound effect; what was missing
was only her noticing them, and that she can do.

## The prompt

Every clip shares three blocks and varies only in the beat:

- **Camera lock.** The game composites cards onto the baize at fixed coordinates,
  so any pan, zoom or drift desynchronises the table. All three models honoured
  this perfectly, in every take.
- **Likeness and sharpness.** `preserve the exact facial features`, `no facial
  smoothing`, `no beautification` - against Wan's tendency to soften her.
- **Costume, named piece by piece**, including that the left shoulder strap stays
  slipped down, because that is the detail every model reaches to tidy up.
- **Room static, except the lamp smoke.** The drifting smoke is deliberately left
  in. It reads as life rather than as error, and unlike the old displacement field
  it does not make the shelf of bottles breathe in time with her chest.

`enablePromptExpansion` is **off**. Left on, the model rewrites the prompt and the
costume clauses stop being load-bearing.

Durations are generated at final length rather than trimmed, because trimming
would throw away the returned-to-plate last frame and with it the loop.

### One clip was refused by a content filter

The first `warm` take came back `DataInspectionFailed` - Wan's own check on its
*output*, not on the prompt. The costume sits near that boundary, so the retry
describes the shot as a portrait of her face, states that nothing below her
collarbone changes, and adds the obvious negatives. That passed, and the same
framing is worth reaching for first if another expression clip is ever added.

## Reproducing

Through the OpenArt MCP: `openart_generate_video`, model `wan2-7`, mode
`image2video`, 1080p, `videoCount` 1, reference uploaded once and reused by id.
Output arrives as 1920x1080 h264 with a silent AAC track attached whether or not
it was asked for; `build-clips.mjs` downsamples to the 1280x720 the table serves,
which supersamples rather than upscales, and strips the audio.

The whole set cost about 2,600 credits including the bake-off and the retries.

Verify before shipping - and read it, because the numbers alone cannot see a
melted finger:

```
node scripts/verify-generated.mjs clipsrc/openart/*.mp4
```
