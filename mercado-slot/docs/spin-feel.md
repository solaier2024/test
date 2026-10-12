# Mercado de Oro — reel speed and stop rhythm

The presentation uses distinct ordinary and quick profiles, with a short acceleration, a constant-speed middle, ordered stops and a small landing settle. This follows the ordinary/quick distinction shown in [Pragmatic Play's game overview](https://clienthub.pragmaticplay.com/wp-content/uploads/2022/01/Game-overview-Queenie.pdf). The [official TaDa Fortune Gems presentation](https://www.youtube.com/watch?v=gfueSWUd4Oc), linked from its product page, supplies the three-reel / independent-multiplier reference. These are presentation references; the numbers below are the chosen and tested timing for this game, rather than a measured market-wide average.

| Timing                 |       Ordinary |          Quick |
| ---------------------- | -------------: | -------------: |
| Acceleration           |         160 ms |          90 ms |
| Cruise speed           |   22 symbols/s |   32 symbols/s |
| Reel 1 stops           |       1,503 ms |         813 ms |
| Reel 2 stops           |       1,711 ms |         887 ms |
| Reel 3 stops           |       1,918 ms |         962 ms |
| Landing settle         |          90 ms |          55 ms |
| Multiplier reveal      |       2,228 ms |       1,167 ms |
| No-line round finishes | about 2,508 ms | about 1,335 ms |

Previously each column crossed 64–127 cells to reach its accepted strip offset, with different actual velocities for different outcomes. The last reel stopped at 1,360 ms in ordinary mode and 544 ms in quick mode. Multiplying the whole timeline by 0.4 also compressed payout text and the landing too aggressively.

The new presentation strip starts with the existing five-cell window. Cells recycle offscreen into a prepared tail containing the accepted five-cell strip window. Each cell retains its texture while visible; there is no visible offset jump or result substitution. This bounds the displayed travel to 28/32/36 symbols in ordinary mode and 22/24/26 in quick mode, independently of the mathematical strip offset. No presentation randomness or new RNG draws are involved.

Acceleration and braking use quadratic curves. Each segment travels half of `velocity × duration`, so the derivatives at both joins equal the cruise velocity. The strip is restored to its authoritative offset after presentation, with exactly the same three visible result symbols. Settling and the independent multiplier share one GSAP timeline. Actual stop times are exposed on the reel host as `data-reel-stop-ms`; background pause is excluded from those measurements.

Quick mode has its own scroll and landing parameters. Payout count-up uses a separate scale so it remains legible. Reduced motion reveals the accepted windows directly, without accelerating through a full strip. Skip, replay, confirmed payouts, saved ledger and RNG rules keep their existing behavior.

Verification covers every combination of old and accepted offset on all three strips in both profiles, derivative continuity, ordered stop times, reduced motion, and the existing ledger/replay checks. Development-only fixture controls support timing checks without spending demo credits and stay out of the production export.

Desktop browser measurements: ordinary stops at 1,518 / 1,726 / 1,935 ms, with the no-line round finishing at 2,519 ms; quick stops at 819 / 902 / 965 ms and finishes at 1,341 ms. The five-Wild-line fixture still lands on all nine golden tacos and pays its exact $3,750.00 example return. Measurements include browser frame scheduling, so they differ slightly from the planned timeline.
