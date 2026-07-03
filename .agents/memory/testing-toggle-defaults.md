---
name: Testing subagent + toggle defaults
description: Avoid false-positive "dropdown won't open" bug reports from the e2e testing subagent when a feature toggle defaults to ON.
---

When a form has boolean toggles that default to `true` (enabled out of the box), a test-plan step like "click the X toggle to turn it on" will actually turn it OFF, silently removing any conditionally-rendered controls next to it (e.g. a style dropdown that only renders when the toggle is on).

**Why:** This happened while verifying a captions/title/watermark toggle row where all three defaulted to `true`. The testing subagent reported "clicking the dropdown trigger does not open a popover" across several retries with page-context JS diagnostics (checked `aria-expanded`, portal content, DOM overlap) — all of which came back clean. The actual cause was the test plan itself: it clicked the toggle assuming it started OFF, which flipped it OFF and made the dependent dropdown disappear from the DOM before the "open it" step ran.

**How to apply:** Before writing a test plan for a toggle-driven UI, check the toggle's default value in the form schema/defaultValues. If it defaults to ON, phrase steps as "verify already ON" rather than "click to turn on," and only click it when the plan needs to test the OFF path.
