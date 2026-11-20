# Gemini integration plan and limitations

## Current implementation

`server/src/services/geminiService.js` remains an optional server-side adapter for non-screening experiments. **The patient oral-photo screening route does not use Gemini and does not send photos to a third-party model.** Oral-photo processing uses the separate PyTorch/FastAPI service only when explicit AI-processing consent is active and a complete versioned model bundle is configured. See [oral AI screening](./oral-ai-screening.md) for its API, consent boundary, and validation gates. A forbidden-language filter rejects certain diagnosis-like phrases.

## Safety limitations

- Any output from this optional Gemini adapter is simulation-only, is not clinically validated, and must not be used to diagnose, rule out disease, triage emergencies, prescribe, or delay professional care.
- Prompt instructions and phrase filters do not guarantee safe model output. The filter is a narrow phrase list; translations, paraphrases, and novel outputs can bypass it. Rejection logging is not an independent clinical safety monitor.
- A fallback record is not a medical assessment. Low or uncertain photo quality must be interpreted as a request for a better image, not reassurance.
- Do not send identifiable images or patient data to a provider until the data-processing terms, retention, residency, consent, and lawful basis have been reviewed and approved for the intended deployment.
- Model name/version, prompt version, image quality, test corpus, false-positive/negative analysis, language performance, and change-control evidence must be part of a future model card and independent evaluation.

## Before enabling in a pilot

1. Confirm provider contracts, data handling, consent wording, retention, and regional requirements.
2. Freeze and document the model and prompt versions; evaluate representative synthetic and consented validation sets in Telugu and English.
3. Perform independent clinical safety and security reviews, including adversarial language and image-quality testing.
4. Ensure the product never makes urgent-care access dependent on an AI score; retain direct emergency instructions and clinician-led care.
5. Add monitoring that contains no clinical or identifying content, a disable/rollback switch, and an incident response process.

No clinical performance claim is made by this documentation.
