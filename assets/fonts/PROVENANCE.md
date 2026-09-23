# Self-hosted UI fonts

These files are unmodified WOFF2 responses from the official Google Fonts text-subset service, downloaded 2026-09-23T07:17:33.390Z. No runtime Google requests are needed: fonts.css references only local relative WOFF2 paths and every face uses font-display: swap. The parent application must load/copy this directory.

## Included faces

| Family | Weight | File | Bytes |
| --- | --- | --- | ---: |
| DM Serif Display | 400 | dm-serif-display-400-ui.woff2 | 17744 |
| Gowun Batang | 700 | gowun-batang-700-ui.woff2 | 49596 |
| IBM Plex Sans KR | 400 | ibm-plex-sans-kr-400-ui.woff2 | 51740 |
| IBM Plex Sans KR | 500 | ibm-plex-sans-kr-500-ui.woff2 | 57236 |
| IBM Plex Sans KR | 600 | ibm-plex-sans-kr-600-ui.woff2 | 57144 |

Total WOFF2 payload: 233460 bytes (228.0 KiB).

## Source and license

The starting Google Fonts CSS URL was observed in the user-supplied tmp/ui-reference/Main.dc.html. The request retains DM Serif Display 400, Gowun Batang 700, and IBM Plex Sans KR 400/500/600, and adds a text subset. Exact request and returned binary URLs are in sources.json. Fonts were downloaded directly from fonts.gstatic.com, not third-party repackagers. Binary responses were not locally edited or re-subsetted. CSS unicode-range declarations were narrowed to the actual cmap coverage.

All three families are distributed under SIL Open Font License 1.1. The original family-specific notices and complete licenses were downloaded from the official google/fonts repository and are included unchanged:

- gowunbatang-OFL.txt: https://raw.githubusercontent.com/google/fonts/main/ofl/gowunbatang/OFL.txt
- ibmplexsanskr-OFL.txt: https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsanskr/OFL.txt
- dmserifdisplay-OFL.txt: https://raw.githubusercontent.com/google/fonts/main/ofl/dmserifdisplay/OFL.txt

Retain the OFL license and copyright notices when redistributing these fonts. IBM's license reserves the name Plex; DM Serif Display's notice reserves Source. The application license does not replace these font licenses.

## Subset coverage

452 unique requested code points comprise all printable ASCII (U+0020 through U+007E), ×∞↑←↓→, and every non-ASCII character found in these inputs at extraction time:

- index.html
- app.js
- league.js
- privacy.html
- tmp/ui-reference/Friends.dc.html
- tmp/ui-reference/Main.dc.html
- tmp/ui-reference/Modes.dc.html
- tmp/ui-reference/NewGame.dc.html
- tmp/ui-reference/Share.dc.html

This deliberately includes Korean characters appearing in source comments as well as UI strings. subset-characters.txt preserves the requested set.

- Gowun Batang and all three IBM faces contain 450 requested characters, including every requested Korean character, printable ASCII, and ×∞↑←↓→.
- The two additional curved arrows ↶ and ↻ are absent in these source fonts and must fall back to a system font.
- DM Serif Display contains 101 requested characters, including printable ASCII and ×. It has no Korean or requested arrow/infinity glyphs; these fall back to the following font in the application's stack.
- Dynamic nicknames or future UI text outside this fixed subset fall back to system fonts. Keep an appropriate system fallback in the application's font-family stacks. Regenerate the subset when adding Korean UI characters.

## Validation

All five downloads returned HTTP 200 with WOFF2 signatures and matching header/file lengths. Node's Brotli decoder successfully decompressed each WOFF2 table stream; its decoded length matched the table directory. Unicode cmap formats 4/12 were inspected to obtain actual character coverage. validation.json records each binary's SHA-256 digest, byte count, covered code points, and missing requested characters. All local CSS destinations exist, all five weights match their official returned declarations, and no remote URL or import remains in fonts.css.

No application, build, configuration, backend, credentials, or git files were changed. Browser rendering and application build integration are left to the parent task.
