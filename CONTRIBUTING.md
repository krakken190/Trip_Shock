# Contributing to TripShock

Thanks for taking the time to contribute. Bug reports, fixes, docs and new features are all welcome.

## Before you start

- **Small fixes** (typos, docs, obvious bugs): open a pull request directly.
- **New features or larger changes**: open an issue first and describe what you want to change and why. This avoids work that doesn't fit the project.
- Check the [Known limits / next steps](README.md#known-limits--next-steps) section of the README for ideas. Good first areas are flexible-date suggestions, a "cheapest shift within ±N days" optimizer, and multi-scenario comparison.

## Local setup

You need **Node.js 22.13 or newer**.

```bash
git clone https://github.com/krakken190/Trip_Shock.git
cd Trip_Shock
npm install
npm run dev
```

The app runs at http://localhost:3000. **You don't need an API key to develop.** Without `SERPAPI_API_KEY` the app uses a deterministic mock provider, and all tests run on it. Only add a real key to `.env.local` if you are working on the SerpApi integration itself; live searches spend credits.

## Making a change

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/hotel-name-matching
   ```
   Use a short prefix: `feat/`, `fix/`, `docs/`, `test/` or `refactor/`.
2. Make your change. Keep each pull request focused on one thing.
3. Add or update tests:
   - logic in `src/domain` or `src/server` → a unit test in `tests/unit`,
   - a user-facing flow → a Playwright test in `tests/e2e`.
4. Run the checks. All of them must pass:
   ```bash
   npm run typecheck
   npm test
   npm run e2e
   ```
5. Commit with a clear message that says what changed and why, for example `Fix stay nights when a flight lands after midnight`.
6. Push your branch and open a pull request against `main`. Describe the problem, your fix, and how you tested it. Add a screenshot for UI changes.

## How the code is organised

- `src/domain` is pure logic with no framework or I/O. Keep it that way so it stays easy to test.
- `src/providers` is the only place that knows SerpApi's JSON shapes. Everything else uses the normalized types in `src/domain/types.ts`.
- `src/server` handles storage and orchestration; `src/app/api` route handlers stay thin.
- UI components reuse the primitives in `src/components/ui.tsx` and the colour tokens in `src/app/globals.css`. Check new screens at phone width too.

## Rules that matter for this project

TripShock shows prices people may act on, so honesty is part of correctness:

- Never show a simulated, failed or old price as if it were current. Failed searches stay *Unavailable* and are left out of totals.
- Never silently swap a hotel the user named for a different one.
- Don't invent data the user didn't give (dates, places, prices). Place suggestions must come from real search results.
- Use "observed" or "estimated" wording, never promises like "you will save".

## Reporting bugs

Open an issue with:
- what you did (steps to reproduce),
- what you expected and what happened instead,
- whether you were on the mock provider or live SerpApi data,
- screenshots or console errors if you have them.

Please **never paste API keys** in issues, pull requests or commits.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
