# Aarogya Drishti motion design

## Reference review

The supplied clip is a 10-second, portrait-format product showcase. It presents a healthcare site on a laptop with a slow camera push and slight reframing. On-screen, a pale aqua hero with soft medical illustrations leads into floating service tiles; the tiles become a care-services grid, then the hero shifts to a doctor appointment card. The overall motion is calm, airy and product-led, with soft shadows, rounded surfaces and a few small ambient particles. A social-media prompt is baked into the clip and is intentionally not reproduced.

The clip does not show a 3D or speaking AI avatar, page-to-page transitions, mouse-driven parallax or detailed scroll choreography. Those elements are not attributed to the reference.

## Implementation plan and status

| Phase | Implementation |
| --- | --- |
| 1. Review the reference | Reviewed the opening, hero, services grid and appointment-card frames across the full clip. |
| 2. Audit the application | Kept the existing React Router, Tailwind, i18next, role navigation and assistant behavior. |
| 3. Reusable motion system | Added an Intersection Observer reveal component and shared motion tokens/effects in `client/src/styles/index.css`; no animation package was added. |
| 4. Homepage | Rebuilt the home page as an original oral-health experience: staggered hero entrance, CSS/SVG care dashboard illustration, animated pulse line, floating consent/care cards, hoverable service tiles and reveal-on-scroll care pathways. Existing sign-in, synthetic-demo and role sign-in links remain active. |
| 5. Dashboards | Added a restrained entrance for existing dashboard content, sidebar elevation and navigation feedback through the shared role shell. Existing dashboard data and routes are untouched. |
| 6. AI assistant | Added an abstract animated assistant orb keyed to the existing ready/listening/thinking/speaking states and named the feature as an AI voice assistant in its supported languages. It is not presented as a human avatar; no facial animation or lip-sync is claimed. |
| 7. Interactions | Added navigation branding feedback, button press/hover feedback and card/link transitions. Existing React Router navigation remains in control. |
| 8. Responsive and accessible behavior | Added tablet/mobile layout rules and reduced-motion behavior; animation uses CSS transforms and opacity, and scroll reveal uses Intersection Observer with a fallback. |
| 9–10. Validation | Run client tests, lint, production build and browser checks at desktop/mobile sizes. Backend behavior is not changed. |

## Design and safety constraints

The visual system uses Aarogya Drishti's emerald, teal, mint and white palette, with original CSS/SVG artwork instead of copied reference assets. The animated monitor is decorative, not a live-data display. Motion does not convey a medical result, and the home page continues to state that photos do not replace clinical examination. The AI assistant remains explicitly identified as AI and retains its existing safety disclaimer.

## Run locally

From `client/`, run `npm run dev`. The usual client commands are `npm test`, `npm run lint` and `npm run build`.
