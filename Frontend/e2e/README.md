# Automated tests

Three kinds of automated tests check the website. All of them also run on GitHub on every push and pull request
(`.github/workflows/tests.yml`); each run's reports can be downloaded from its page in the **Actions** tab.

| | What it checks | Tool | Where |
|---|---|---|---|
| Backend tests | The recommender, rents, safety scores, commute times, Eircode lookup, accounts and saved chats, and that the AI assistant gets the same figures as the website | pytest | `Backend/tests/` |
| End-to-end tests | Real browsers clicking through the website like a student: every page, the questionnaire and results, the district map, Compare districts, Things to know, the AI assistant, log in, on desktop and phone sizes, in Chrome, Firefox and Safari (WebKit) | Playwright | `Frontend/e2e/*.spec.js` |
| Accessibility | Every main page scanned for WCAG 2.1 A/AA problems (labels, contrast, keyboard use...) | axe-core, inside Playwright | `Frontend/e2e/accessibility.spec.js` |
| Lighthouse | Performance, accessibility, best practices and SEO scores for every page, on mobile and desktop | Google Lighthouse | `Frontend/e2e/lighthouse.mjs` |

## Run them on your computer

Once: install the website's packages and the test browsers.

```bash
cd Frontend
npm install
npx playwright install chromium firefox webkit
```

**Backend tests** (from the repo root, in the backend's Python environment):

```bash
pip install -r Backend/requirements-dev.txt
cd Backend && python -m pytest -q
```

The accounts tests that need a database run only when `TEST_DATABASE_URL` points to an empty PostgreSQL database;
GitHub provides one.

**End-to-end tests** start the backend and the website by themselves (a production build on port 4173). Tell them
which Python runs the backend if it isn't `python3`:

```bash
cd Frontend
E2E_PYTHON=../Backend/.venv/bin/python npm run test:e2e        # every browser and size
E2E_PYTHON=../Backend/.venv/bin/python npm run test:e2e -- --project=desktop-chrome
npm run test:e2e:ui                                            # watch the tests click through, step by step
npx playwright show-report                                     # the HTML report of the last run
```

The AI assistant's replies are supplied by the tests (no API key or cost), and so is the exact Eircode lookup, which
needs a Google key on the server.

**Lighthouse** scores the running website:

```bash
cd Frontend
npm run build && npx vite preview --port 4173 &   # the website as deployed
npm run test:lighthouse                            # reports in lighthouse-report/, scores in lighthouse-report/summary.md
```

The Lighthouse run fails if a page's accessibility or best-practices score falls below 80 (`MIN_SCORE`).
