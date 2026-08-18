# Reasoning effort visual baseline

Approved on 2026-08-15 for the DeepSeek Harness integration.

## Interaction

- The slider adapts to whatever effort levels the current model advertises.
- The thumb follows the pointer continuously and snaps to a value on release.
- Radiation, waves, crests, particles, and the trailing flare are clipped to the left side of the thumb.
- Bright ticks sit inset on the track so the first stop never leaves the rounded rectangle.
- Ticks hide completely on the top purple stop.
- No rotating animation.
- The thumb is a compact white rounded rectangle. The chibi runner is not used.
- The track is a short rounded rectangle (square-ish body, small corner radius), not a pill.
- A caption above the track reads `思考强度` plus the English level. Only the English word turns purple on the last stop.

## Codex palette

- The first stop is grey-white with no fill color or radiation.
- Intermediate levels stay amber through ripe orange. The warmest non-top stop is more orange than lemon.
- Only the last advertised level turns magenta-purple. Purple is keyed off `[data-top]` / `--re-purple`, never a hardcoded `max` id.
- While dragging, color follows the thumb: amber → orange until about 82% of the last interval, then it crosses into purple.
- Radiation, flare, and knob bloom use the same `--re-glow` as the track.

## Dark theme

- Warm track: `#4a2a08 → #e8b03a → #f6c85a`, ripening toward `#ff8a12`.
- Top level: `#1c0624 → #8a14e8 → #d24cff` with magenta bloom.
- White ticks stay white on both warm and purple tracks.

## Light theme

- Same hue family at lower saturation.
- The filled region still ends at the thumb.
- Top-level fill is lilac into magenta-purple.

## DSH adaptation

- Replace the compact `conversation.input.model` seat with one model + effort trigger.
- The popover shows the effort slider directly above the current-model row, without a separate heading or decorative icon; the row drills into the provider-grouped model list.
- Follow DSH's actual theme marker: `body[data-ds-dark-theme]`.
- Prefer DSH `--dsw-*` design tokens for surrounding labels, borders, and focus treatment.
- Read and write `reasoningEffort` through the current session's model selection (`sessions.models` / `sessions.selectModel`), never through the global provider settings namespace.

## Experimental chibi thumb

- Disabled by default and controlled by a separate switch below the main plugin switch.
- Replace only the white thumb; keep the approved track, radiation, snapping, and model-selection behavior.
- Play eight frames in reading order: top row left-to-right, then bottom row left-to-right.
- Use a 720 ms loop at rest and a 420 ms loop while dragging.
- Keep the full character visible at both track endpoints and preserve reduced-motion behavior by freezing the animation.
