# QCalc design documents (v1.12.0)

**English** | [日本語](#日本語)

The design document set of QCalc 1.12.0 (versionCode 27, package name `io.github.hiroshitsu.qcalc`): requirements, design, usage, maintenance and tests. Every document is in English and in Japanese, with the same content. The documents match the 1.12.0 source code in this repository (commit `8ea90f3`).

- Author: Hiroshi Tsukayama (津嘉山 弘)
- Date: 2026-11-20 (18th edition, for 1.12.0)
- Format: PDF (A4), with UML class, sequence and state diagrams and other figures

| Document | English | Pages | Japanese | Pages | Contents |
| --- | --- | ---: | --- | ---: | --- |
| Overview | [00-overview-en.pdf](00-overview-en.pdf) | 65 | [00-overview.pdf](00-overview.pdf) (概要) | 36 | What QCalc is, what changed in 1.12.0, 1.11.0, 1.10.1, 1.10.0, 1.9.5, 1.9.4, 1.9.3, 1.9.2, 1.9.1, 1.9.0, 1.8.4, 1.8.3, 1.8.2, 1.8.1, 1.8.0, 1.7.1, 1.7.0, 1.6.0, 1.5.0, 1.4.0, 1.3.0, 1.2.0 and 1.1.0, the design in brief, components and versions, list of the documents, glossary, revision history |
| 1. Requirements definition | [01-requirements-en.pdf](01-requirements-en.pdf) | 53 | [01-requirements.pdf](01-requirements.pdf) (要件定義書) | 46 | Purpose, scope, 28 use cases, 83 functional requirements, non-functional requirements, constraints, 61 acceptance criteria, QCalc Pro (and what is free and what is Pro from 1.12.0) |
| 2. Basic design | [02-basic-design-en.pdf](02-basic-design-en.pdf) | 46 | [02-basic-design.pdf](02-basic-design.pdf) (基本設計書) | 38 | System structure, deployment, modules, screens and screen transitions (with the forms), keys, main processing flows, stored data, external interfaces, error handling, security |
| 3. Detailed design | [03-detailed-design-en.pdf](03-detailed-design-en.pdf) | 137 | [03-detailed-design.pdf](03-detailed-design.pdf) (詳細設計書) | 125 | Class diagram, JavaScript bridge, protocol between the app and the engine, calculation, process supervision, user interface, data formats, time limits, error codes and messages, QCalc Pro, language, color themes, CSV export, suggestions, the Light or dark setting, special functions with Arb, the time limit setting, forms, the math view, □ boxes, actions on results, analysis and measuring in 2D and 3D graphs, graphs from forms, the Shapes panel, the area shown at once with edges that can be dragged, and for 1.8.0: forms that check, keep and undo, samples for the graphs, the volume of the drawn surface, notes on input, and for 1.8.2: the shorter search for exact values and the values kept, and for 1.8.3: the edge in the pictures of the samples and the scale kept for round samples, for 1.8.4: the measured solid shown filled with a pale liquid and graphs from expressions, equations, functions and matrices made anywhere in the app, for 1.9.0: Spanish as the third language of the screens, for 1.9.1: the measured solid drawn as a real pale liquid in a clear, glossy film, traced for every pixel, and for 1.9.2: smooth surfaces with a depth buffer and light at every pixel, and the measured solid as a pale gelatin in a clear skin of a deeper shade, for 1.9.3: a sphere drawn as one round, smooth ball, and for 1.9.4: measuring only where the functions have real values, with only the digits that can be trusted, and for 1.9.5: a solid drawn with other surfaces as one object in one color, and surfaces cut along the top and the bottom of the box, and for 1.10.0: German, French, Korean and Traditional Chinese, with one file of texts per language, and for 1.10.1: the shadow of the measured solid in the shape of the solid, and for 1.11.0: shadows in the 3D graph, the enclosed region, shapes, tanks and the weight, solids of revolution, regions given by formulas and the sign, volume from measured values, the language at start (Lang.java) and the faults of the inspection |
| 4. User manual | [04-user-manual-en.pdf](04-user-manual-en.pdf) | 47 | [04-user-manual.pdf](04-user-manual.pdf) (取扱説明書) | 45 | From 1.12.0 the PDF of the user manual of docs/manual (made from manual/src; also inside the app and on the web, in seven languages): introduction, the screen, basic calculations, history and memory, keys and typing help, tools, graphs, forms, settings, language and widget, QCalc Pro, troubleshooting, glossary; with photos, numbered steps, examples, tips and common mistakes |
| 5. Build and maintenance manual | [05-build-and-maintenance-en.pdf](05-build-and-maintenance-en.pdf) | 22 | [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) (ビルド・保守マニュアル) | 21 | Development environment, build steps (test APK and App Bundle for Google Play), FLINT and the patch to libqalculate, signing, the build with billing (Gradle), checks, updating libqalculate, Android Studio |
| 6. Test specification and results | [06-test-specification-en.pdf](06-test-specification-en.pdf) | 110 | [06-test-specification.pdf](06-test-specification.pdf) (テスト仕様書・結果) | 101 | Test policy, test items and their results for 1.12.0 (all 1,540 items passed, each test counted once; the engine tests are results of 1.6.0, as the engine is unchanged; the tests of the page and the Java tests were run again with 1.12.0), tests not yet done |

### What changed in 1.12.0

- Clarity first, at the user's request: anyone opening the app should find a tool and get a result without help. The menu has eight items; the tools are on one Tools screen with a search in the seven languages; every tool has examples filled in with one tap, a result at once and the same three actions on a result; touch targets are 48 dp.
- Everyday tools: price with discounts and tax, percentages, unit price, splitting a bill, loans with a repayment table, savings, dates, times, a conversion screen, statistics with regression and calculation notes. Numbers follow the region's format (1,234.5, 1.234,5 or 1 234,5) or a chosen one. The history can be searched, pinned, noted and added up; memory keys can be shown; the language can follow the phone again.
- From 2D to 3D by touch: "⟳ 3D" turns a region of the 2D graph into a solid of revolution at once and, with QCalc Pro, shows it turning in 3D (without Pro, its shape and volume in 2D); solids with known cross sections, the lines of the method and Pappus's theorem. A widget, a quick settings tile and shortcuts open QCalc quickly; pictures and GIFs of graphs can be shared.
- QCalc Pro, as the author decided (free for learning and everyday use, Pro for work): the CSV of tables, tank heads with quick-reference tables, solids from a profile, STL files for 3D printers, full-size pictures and GIFs, and more calculation notes.
- A user manual in the seven languages: a version read inside the app without the internet, opened at its section from the "?" of every tool and panel, and a web version with photos and a PDF (docs/manual, published with GitHub Pages). 04-user-manual(-en).pdf is now its Japanese and English PDF; the German, Spanish, French, Korean and Traditional Chinese manuals were translated by machine and are not yet checked by native speakers.
- About this app has "Tell someone about QCalc" (one line with the Google Play address for the share sheet) and "Send a bug report or an idea" (a mail draft to hiroshitsu.apps@gmail.com with only the version, Android, the phone and the language; the page may open only web pages and mailto links, decided by the new Java class Links).
- A review of the whole app fixed BG05 to BG21, among them the shadows while the 3D graph turns (BG08, BG19), the rims of solids of revolution, "⟳ 3D" that did not go to 3D (BG20) and "Volume and surface" in the 3D view of a solid of revolution, which now shows the values found in 2D (BG21), all reported by the user, and numbers with a decimal comma. The engine did not change; the page, the five files of texts and the Java code changed, with seven new Java classes (Widget, QuickTile, Quick, QuickText, ShareFiles, ShareProvider, Links).

### What changed in 1.11.0

- At the user's request, the volume tools grew in six stages. "Volume and surface" in the 3D graph finds the part enclosed by two surfaces by itself (z = x² + y² and z = 4: the disk x² + y² ≤ 4 and 8π), outlines it on the floor and gives each part with the sum. Its "Custom" region takes a rectangle, a disk with a centre, a ring, a sector, the region between two curves or inequalities joined by "and", and "Integral" gives the value with its sign.
- "Area and length" in the 2D graph turns its region around the x axis, the y axis, y = k or x = k: the volume, the curved surfaces and the whole surface of the solid of revolution, exact when possible, with the formula used (washers or shells) and a 3D view.
- The Shapes panel has 22 shapes (with a frustum, a hemisphere, a spherical cap, an ellipsoid, prisms and a pipe), sizes as a radius or a diameter, tanks (the liquid from its height, and the height for an amount), the weight from a density, and "Volume from measured values": cross sections by the average end area method and Simpson's rule, or a grid of point heights.
- The surfaces of the 3D graph cast shadows from the lamp of their highlight, on themselves, on each other and on the floor of the box.
- The app starts in the first language in the phone's list that it has, so a phone set to Japanese starts in Japanese; earlier users keep their language, and on Android 13 and later QCalc's language can also be chosen in the system settings (the new Lang.java and res/xml/locales_config.xml).
- A full inspection fixed four older faults: an approximate decimal shown with "=", saw teeth at the edge of a long 3D surface, sizes such as 0.5 or 1/2 not read as numbers, and a row of the German settings wider than the screen. The engine did not change; the page, the five files of texts, MainActivity, Engine and StateStore changed. 129 tests were added (102 of the page, 27 of Lang.java), and D20, Z03, W18, V03, I15, L36 and Q27 were adapted.

### What changed in 1.10.1

- On the user's phone, the app opened again showed the sphere it had drawn last, and "Volume and surface" opened on Rectangle, as it always does. The volume was right (32π/3), but the soft shadow under the sphere was the whole square floor of the box: until 1.10.0 the shadow was the region itself (the rectangle, or the circle of a disk).
- From 1.10.1 the shadow has the shape of the measured solid seen from above: the faces of its top laid flat on the floor of the box, so a sphere has a round shadow on Rectangle as on the disk, and the doughnut a ring with an empty hole. Only the outline of the faces is drawn, so drawing takes as long as before. Only app.js changed; the tests SH01 to SH09 check the shadow on both screens.

### What changed in 1.10.0

- At the user's request, the screens are also in German, French, Korean and Traditional Chinese (Taiwan): seven languages in all, with English, Japanese and Spanish.
- Each language other than English and Japanese has a file of its own (app/assets/i18n-es.js, i18n-de.js, i18n-fr.js, i18n-ko.js and i18n-zh-TW.js, loaded before app.js) with the texts of the page, the common messages of the calculation engine and the Java code, the names of the keys read out, the categories of the lists, how a date is written and the currencies listed first. The Spanish texts moved into the same form.
- A phone set to one of these languages starts in it (Traditional Chinese also for Hong Kong and Macau); a phone set to Simplified Chinese or to Japanese still starts in English. (From 1.11.0 the app starts in the first language in the phone's list that it has, so a phone set to Japanese starts in Japanese; see the README.) "Language" in the menu and in the settings is shown in the language of the screen with the English word beside it, such as "Sprache / Language". Korean and Chinese text use the fonts of their own language.
- The German, French, Korean and Traditional Chinese texts were translated by machine (Claude) and have not yet been checked by native speakers. The calculation engine did not change. The tests L01 to L38 check the four new languages on the screens.

### What changed in 1.9.5

- On the user's phone, drawing the partial derivative ∂f/∂x of the sample "Sphere" (Partial derivatives → Draw ∂f/∂x) turned the sphere blue and red again, and the derivative −x/√(4 − x² − y²), which grows without bound at the rim of the sphere, ended in jagged spikes along the top and the bottom of the box.
- The solids are now found as groups of surfaces (until 1.9.4 every surface drawn had to close up with the others). One surface, or surfaces that all make one solid, are colored by height as before; the surfaces of a solid drawn with other surfaces share the color of its first surface, with its functions together in the legend, and the other surfaces keep their colors.
- Where a surface leaves the box at its top or bottom, the place is found with the engine on each grid line by halving the step 12 times, and the cells are cut there (until 1.9.4 a cell with a corner beyond the box was left out), so the surface ends along a smooth line, also around a pole such as 1/(x² + y²). Only app.js changed; 1.9.5 was made in a separate session.

### What changed in 1.9.4

- On the user's phone, "Area and length" with the sample "Circle" (the range −2.6 to 2.6) gave the area 12.83 and "Could not calculate the length". The two halves of the circle meet at ±2 without crossing, so no crossing point was found, and beyond ±2 the functions have no real value: the engine integrated complex numbers there, and abs() turned them into a wrong size. The same kind of fault was in the sample "eˣ and ln x", the length of the "Heart", the volume of the "Doughnut" (76.85 for 4π²) and a sphere on a disk larger than it.
- Area, length, volume and surface area now count only where the functions have real values: the range is cut where the real values end (found exactly when they end at a simple number), a note under the result says which part was measured, a point where two curves meet without crossing is a crossing point, round parts in 3D are measured in polar coordinates, and an infinite length is said to be infinite. The circle gives 4π for its area and its perimeter, the doughnut 4π² and 8π².
- Every value shows only the digits that can be trusted: lengths of very wavy curves are found with the 15-point Gauss–Kronrod rule on many parts (right to 10 digits; seven samples had wrong digits), and a volume found only approximately shows fewer digits (the sample "Egg carton": 39.9, not 39.939589). The engine and the Java code do not change (only app.js and seven texts of i18n-es.js changed).
- 1.9.4 also has the changes of 1.9.3, which was made at the same time in a separate session with the same version number and was not released on its own.
- The test specification now counts each test once (D21 to D45 and S01 to S13, run on both screens, had been counted twice: the 983 items of 1.9.2 were 945 tests).

### What changed in 1.9.3

- On the user's phone, the sample "Sphere" of 1.9.2 showed streaks across the band next to its rim and its two halves in blue and red, as if they were two objects; and once 1:1 had been turned off for one graph, every later sphere came out flattened.
- Surfaces that close up into one solid (the two halves of a sphere or of a doughnut) are now colored by height as one object, with one color bar in the legend. Near the rim of a surface that ends as a square root, the light comes from the square of the height above the rim, which changes smoothly there, and the cells next to the rim are cut into smaller triangles lifted onto the rounded surface: no streaks.
- 1:1 holds only for the functions it was set for (a value saved by an earlier version counts as no choice), and half a sphere alone is drawn down to its rim. Only app.js changed.

### What changed in 1.9.2

- On the user's phone (a SHARP AQUOS sense8), the 3D graph showed rings of flat cells on the sphere and the doughnut, and saw teeth where the two halves of the sphere meet; the pictures of the samples too. The surfaces are now laid over the pixels with a depth buffer, so that the one in front is shown at every point, and lit at every pixel with normals found at the grid points: smooth, glossy surfaces with a highlight and the surroundings mirrored. The lines of a coarse grid are drawn in the same pass.
- At the user's request, while "Volume and surface" is open, the solid that is measured looks like a pale gelatin held by a clear, glossy skin of a deeper shade of the same color: the skin is clear where it is looked at straight and shows its deep color toward the outline. The legend and its color box say so. The values, the engine and the Java code do not change (only app.js, one line of style.css and two texts of i18n-es.js changed).

### What changed in 1.9.1

- At the user's request, while "Volume and surface" is open in the 3D graph, the solid whose volume is measured looks like a real pale liquid held by a clear, glossy film. It is traced for every pixel: the color deepens where the liquid is thicker, the film mirrors the lamps of a bright room (more at a slant), what lies behind is seen through it, bent, and the shadow on the floor of the box takes the color of the liquid. The dashed edges and the grid lines on the solid are gone.
- While the graph is turned with a finger, the liquid is drawn with fewer pixels, and in full again when the finger is lifted. The values, the engine and the Java code do not change (only app.js and one text of i18n-es.js changed).

### What changed in 1.9.0

- At the user's request, Spanish (Latin America) is the third language of the screens, next to English and Japanese. The texts of the page (in the new file app/assets/i18n-es.js), the common messages of the calculation engine and the Java code, the names of the keys read out, the categories of the lists and the dates are in Spanish.
- "Language / 言語 / Idioma" in the menu and in the settings offers English, 日本語 and Español. With no language chosen, a phone set to Spanish starts in Spanish; a phone set to Japanese still starts in English. (From 1.11.0 the app starts in the first language in the phone's list that it has, so a phone set to Japanese starts in Japanese; see the README.)
- The calculations, the way expressions are written and the names in the engine's lists do not change. The engine is the same as in 1.8.4; the Java code changed only in the four texts that MainActivity shows itself.

### What changed in 1.8.4

- In the 3D graph, while "Volume and surface" is open, the solid whose volume is measured looks as if it were filled with a pale liquid: its surface, side walls and floor are see-through and lit like a real surface (brighter toward the light, with a highlight, a reflection that grows toward the edges, a little deeper color lower down and a soft shadow on the floor of the box). Its hidden edges are dashed, the parts not measured fade, and its color is chosen for each graph (the hue farthest from the colors of the surfaces).
- Expressions, equations, functions and matrices made elsewhere in the app go to the graph that fits them: 📈 above the input field draws an expression in x (2D) or in x and y (3D), equations such as y = 2x + 1, x² + y² = 4 (solved for y) or x + y + z = 1 (solved for z), and matrices of numbers with 2 or 3 columns as points; the menu of a history line offers "Draw a graph" or "Draw a 3D graph", and a saved function of x (and y) has a "Graph" button. Nothing else changed.

### What changed in 1.8.3

- Two faults found on a phone with 1.8.2 were fixed. The pictures of the 3D samples "Sphere" and "Doughnut" looked torn along their middle; they are now whole. A round sample (the sphere, the doughnut, the double cone; in 2D the circle and the heart) drawn again with another grid or range lost its 1:1:1 (or 1:1) scale when the saved 1:1 choice was off; the scale and the mark of the sample now stay while the same functions are drawn again.
- With results shown in hexadecimal, the edge of the sphere could not be calculated; it is now always calculated in decimal. Nothing else changed.

### What changed in 1.8.2

- In the 3D graph, "Volume and surface" gives its final values sooner: an exact value is looked for for 3 s (the volume) or 2 s (each surface) instead of 8 s, and the values found are kept, so drawing the same surface again shows them at once. The values themselves are the same.
- Two small faults of the page were fixed: the card of a sample stayed marked after an example shape was drawn, and in "Area and length" an older calculation could put back the range when answers arrived out of order.

### What changed in 1.8.1

- In the 3D graph, the "Volume" and "Surface area" buttons were taken out of "Volume and surface": both values are shown by themselves, and the buttons only replaced them with one of them. Nothing else changed.

### What changed in 1.8.0

- In the 3D graph, "Volume and surface" measures the surface that is drawn, as soon as it is opened.
- The 2D and the 3D graph have rows of samples (17 and 14) that are drawn with one tap.
- The forms check every box, keep what they hold, undo and redo, and take tables pasted from a spreadsheet.
- Input that is read in another way than it was probably meant gets a note, a definition such as "x = 5" can be undone, and the sizes of shapes are checked.

Only the page changed (app.js and style.css); the engine and the Java code are the same as in 1.6.0. The tests were run on a PC (Chromium and the engine built from the same source); the app has not been tested on a phone yet (test specification 6.6).

### Reading order

- Users: 4. User manual (also inside the app: "?" on every tool, and at https://hiroshitsu.github.io/qcalc/manual/)
- Developers and maintainers: Overview → 2. Basic design → 3. Detailed design → 5. Build and maintenance manual
- Acceptance: 1. Requirements definition → 6. Test specification and results

### Notes

- The overview mentions a separate guide for publishing QCalc on Google Play. It is a working document for the developer's own Play Console tasks and is not included here.
- The signing keys (the upload key and the test key) and their passwords are not in the documents or in this repository; the documents give only the file names and locations.
- The photos in the user manual (from 1.12.0 the manual of docs/manual) were taken of 1.12.0 on a PC: the app was shown in Chromium at the size of a smartphone screen (360 × 720), in each language with the number format of a typical region of it (ja-JP, en-US, de-DE, es-MX, fr-FR, ko-KR, zh-TW), with manual/shots.js. The examples in the manual give the numbers the app gives in that language.

## 日本語

QCalc 1.12.0（versionCode 27、パッケージ名 `io.github.hiroshitsu.qcalc`）の要件、設計、使い方、保守、テストをまとめた設計書です。どの文書も日本語と英語の 2 通りがあり、内容は同じです。内容はこのリポジトリの 1.12.0 のソースコード（コミット `8ea90f3`）に合わせています。

- 作成：津嘉山 弘
- 作成日：2026-11-20（第 18 版。1.12.0 に合わせて改訂）
- 形式：PDF（A4）。UML のクラス図・シーケンス図・状態遷移図などの図を含みます。

| 文書 | 日本語 | ページ | 英語 | ページ | 内容 |
| --- | --- | ---: | --- | ---: | --- |
| 概要 | [00-overview.pdf](00-overview.pdf) | 36 | [00-overview-en.pdf](00-overview-en.pdf) | 65 | 1.12.0・1.11.0・1.10.1・1.10.0・1.9.5・1.9.4・1.9.3・1.9.2・1.9.1・1.9.0・1.8.4・1.8.3・1.8.2・1.8.1・1.8.0・1.7.1・1.7.0・1.6.0・1.5.0・1.4.0・1.3.0・1.2.0・1.1.0 で変えたところ、文書の一覧、全体像の図、構成要素と版、用語集、改訂履歴（英語版は設計の要点のまとめも含む） |
| 1. 要件定義書 | [01-requirements.pdf](01-requirements.pdf) | 46 | [01-requirements-en.pdf](01-requirements-en.pdf) | 53 | 目的、対象範囲、ユースケース 28、機能要件 83、非機能要件、制約、受け入れ基準 61、QCalc Pro（版 1.12.0 からの無料と Pro の分け方を含む） |
| 2. 基本設計書 | [02-basic-design.pdf](02-basic-design.pdf) | 38 | [02-basic-design-en.pdf](02-basic-design-en.pdf) | 46 | システム構成、配置、モジュール、画面と画面遷移（フォームを含む）、キー、主要な処理の流れ、保存データ、外部インターフェース、エラー処理、セキュリティ |
| 3. 詳細設計書 | [03-detailed-design.pdf](03-detailed-design.pdf) | 125 | [03-detailed-design-en.pdf](03-detailed-design-en.pdf) | 137 | クラス図、JavaScript ブリッジ、計算エンジンとの通信プロトコル、計算処理、プロセス監視、画面処理、データ形式、時間制限、エラーコードとメッセージ、QCalc Pro、表示の言語、配色テーマ、履歴の書き出し、入力の候補、ライト／ダークの設定、Arb による特殊関数、計算の制限時間、入力フォーム、数式の形、□ の欄、結果からの操作、2D・3D グラフの解析と計測、フォームからのグラフ、図形の画面、すぐに出て端を指で動かせる面積。版 1.8.0 の、確かめる・残す・元に戻すフォーム、グラフのサンプル、描いている曲面の体積、入力への注意。版 1.8.2 の、厳密な値を探す時間の短縮と求めた値の記憶。版 1.8.3 の、サンプルの絵の縁と、丸いサンプルの比を保つこと。版 1.8.4 の、計測している立体を薄い液体で満たしたように示すことと、どこで作った式・方程式・関数・行列もグラフにすること。版 1.9.0 の、3 つ目の言語としてのスペイン語。版 1.9.1 の、計測している立体を、つやのある透明な膜に満たした本物の薄い液体として画素ごとに描くこと。版 1.9.2 の、深度バッファーと画素ごとの光によるなめらかな曲面と、計測している立体を濃い色の透明な皮に包まれた薄いゼラチンとして示すこと。版 1.9.3 の、球を 1 つのなめらかな球として描くこと。版 1.9.4 の、関数に実数の値がある部分だけで測り、信頼できる桁だけを示すこと。版 1.9.5 の、ほかの曲面と一緒に描く立体を 1 色の 1 つの物とし、箱の上端と下端で曲面を切ること。版 1.10.0 の、ドイツ語・フランス語・韓国語・繁体字中国語と、言語ごとに 1 つにした文のファイル。版 1.10.1 の、計測している立体の形の影。版 1.11.0 の、3D グラフの影、囲まれた部分、図形・容器・重さ、回転体、式で指定する範囲と符号、測った値から体積、起動時の言語（Lang.java）、点検で見つかった不具合 |
| 4. 取扱説明書 | [04-user-manual.pdf](04-user-manual.pdf) | 45 | [04-user-manual-en.pdf](04-user-manual-en.pdf) | 47 | 版 1.12.0 からは docs/manual の取扱説明書（manual/src から作る。アプリの中と Web にもあり、7 言語）の PDF：はじめに、画面の見方、基本の計算、履歴とメモリー、キーと入力の助け、道具、グラフ、式の画面、設定・言語・ウィジェット、QCalc Pro、困ったとき、用語集。写真、番号つきの手順、例、ヒント、よくある間違いつき |
| 5. ビルド・保守マニュアル | [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) | 21 | [05-build-and-maintenance-en.pdf](05-build-and-maintenance-en.pdf) | 22 | 開発環境、ビルド手順（テスト用 APK と Google Play 用 App Bundle）、FLINT と libqalculate へのパッチ、署名、課金のある版（Gradle）、動作確認、libqalculate の更新手順、Android Studio |
| 6. テスト仕様書・結果 | [06-test-specification.pdf](06-test-specification.pdf) | 101 | [06-test-specification-en.pdf](06-test-specification-en.pdf) | 110 | テストの方針、テスト項目と 1.12.0 での結果（1,540 項目すべて合格。各試験を 1 回数える。計算エンジンは変えていないので、その試験は 1.6.0 の結果。画面と Java の試験は 1.12.0 でやり直し）、未実施のテスト |

### 1.12.0 で変えたところ

- 利用者の依頼で「分かりやすさを最優先」にしました。初めての人が、説明を読まずに道具を見つけて結果を出せることが目標です。メニューは 8 項目、道具は 7 言語で検索できる 1 つの「道具」の画面にまとめ、どの道具にもタップで入る例、すぐ出る結果、結果の 3 つの操作があります。押せる範囲は 48 dp です。
- 日常の道具：値段（割引と税）、割合、単価、割り勘、ローン（返済表）、積立、日付、時間、換算の画面、統計（回帰）、計算メモ。数は地域の書き方（1,234.5・1.234,5・1 234,5）か、選んだ書き方。履歴は検索・固定・メモ・合計ができ、メモリーキーも出せ、言語を端末の設定に戻せます。
- 2D から 3D へ触って：2D グラフの「⟳ 3D」で部分をすぐ回転体にし、QCalc Pro では 3D で回して見せる（Pro がないときは 2D で形と体積）。断面の立体、方法の線、パップスの定理。ウィジェット・クイック設定のタイル・ショートカットからすぐ開け、グラフの画像と GIF を共有できます。
- QCalc Pro は作者の決定どおり（学習と日常は無料、仕事向けを Pro）：表の CSV、タンクの鏡板と早見表、輪郭から回転体、3D プリンター用の STL ファイル、最大の大きさの画像と GIF、2 つ目以降の計算メモ。
- 7 言語の取扱説明書：アプリの中でネットなしで読める版（各道具・パネルの「？」からその節を開く）と、写真つきの Web の版・PDF（docs/manual。GitHub Pages で公開）。04-user-manual(-en).pdf は、その日本語・英語の PDF に置き換えました。ドイツ語・スペイン語・フランス語・韓国語・繁體中文の説明書は機械翻訳で、母語の人の確認はまだです。
- 「このアプリについて」に「QCalc を人に教える」（Google Play のアドレスの 1 行を共有シートへ）と「不具合・要望を送る」（版・Android・端末・言語だけを入れたメールの下書き。宛先 hiroshitsu.apps@gmail.com。ページが開ける外のリンクは Web のページと mailto だけで、新しい Java のクラス Links が決める）。
- アプリ全体の見直しで BG05〜BG21 を直しました（利用者が報告した 3D グラフを回している間の影（BG08・BG19）と回転体の縁、3D にならなかった「⟳ 3D」（BG20）、回転体の 3D の「体積・表面積」（2D で出した値を出すように。BG21）、小数点が「,」の数など）。計算エンジンは変えていません。変えたのは画面、5 つの文のファイル、Java で、Java のクラスを 7 つ加えました（Widget・QuickTile・Quick・QuickText・ShareFiles・ShareProvider・Links）。

### 1.11.0 で変えたところ

- 利用者の要望で、体積の道具を 6 段階で広げました。3D グラフの「体積・表面積」は、2 つの曲面で囲まれた部分を自動で見つけ（z = x² + y² と z = 4 なら円 x² + y² ≤ 4 と 8π）、箱の底に輪郭を描き、部分ごとの値と合計を出します。「指定」では、長方形、中心のある円、環、扇形、2 本の曲線ではさむ範囲、「かつ」でつないだ不等式で範囲を指定でき、「積分の値」は符号つきの値を出します。
- 2D グラフの「面積・長さ」は、その範囲を x 軸・y 軸・y = k・x = k のまわりに回した回転体の体積、曲面の面積、表面積全体を、できるときは厳密な値で、使った式（ワッシャー法・殻の方法）と 3D の姿とともに出します。
- 「図形」は 22 の図形（円錐台・半球・球欠・楕円体・角柱・パイプを追加）、半径と直径、容器の液量（液面の高さから液量、液量から高さ）、密度からの重さと、「測った値から体積」（断面積の表から平均断面法とシンプソンの公式、格子の高さから点高法）を持ちます。
- 3D グラフの曲面は、ハイライトの照明から、自分自身・ほかの曲面・箱の底に影を落とします。
- アプリは、端末の言語のリストで最初に当てはまった言語で始まるので、日本語の端末は日本語で始まります。以前からの利用者は今までの言語のままで、Android 13 以降は端末の設定でも QCalc の言語を選べます（新しい Lang.java と res/xml/locales_config.xml）。
- アプリ全体の点検で、以前からの不具合を 4 件直しました（近似の小数が「=」で表示される、長い式の 3D の曲面の端がのこぎり状になる、0.5 や 1/2 と入れた大きさが数として読まれない、ドイツ語の設定の行が画面からはみ出す）。計算エンジンは変えていません。変えたのは画面、5 つの言語の文のファイル、MainActivity・Engine・StateStore です。試験を 129 件（画面 102 件、Lang.java 27 件）加え、D20・Z03・W18・V03・I15・L36・Q27 を見直しました。

### 1.10.1 で変えたところ

- 利用者のスマートフォンで、アプリを開き直すと、3D グラフは前回描いた球のまま表示され、「体積・表面積」はいつもどおり「長方形」で開きました。体積は正しく出ていましたが（32π/3）、球の下のやわらかな影は箱の底いっぱいの四角になっていました。版 1.10.0 までは、影は範囲そのもの（長方形か、円の範囲の円）だったためです。
- 版 1.10.1 からは、影を、計測している立体を真上から見た形（立体の上面の面を箱の底に平らに置いたもの）にしました。「長方形」でも球の影は円のときと同じ丸い形になり、ドーナツの影は穴の空いた輪になります。面の輪郭だけを描くので、描く時間は前と同じです。変えたのは app.js だけで、試験 SH01〜SH09 で両方の画面の影を確かめています。

### 1.10.0 で変えたところ

- 利用者の要望で、画面をドイツ語・フランス語・韓国語・繁体字中国語（台湾）にも対応させました。英語・日本語・スペイン語と合わせて 7 つの言語です。
- 英語と日本語のほかの言語は、それぞれ 1 つのファイル（app/assets/i18n-es.js・i18n-de.js・i18n-fr.js・i18n-ko.js・i18n-zh-TW.js。app.js の前に読み込む）に、ページの文、計算エンジンと Java の主なメッセージ、読み上げるキーの名前、一覧の分類名、日付の書き方、最初に並べる通貨を持ちます。スペイン語の文もこの形に移しました。
- これらの言語に設定した端末ではその言語で始まります（繁体字中国語は香港・マカオの設定でも）。簡体字中国語や日本語に設定した端末は、これまでどおり英語で始まります（1.11.0 からは、端末の言語のリストで最初に当てはまった言語で始まるので、日本語の端末は日本語で始まります。README を参照）。メニューと設定の「言語」は、画面の言語の言葉の横に英語の「Language」を添えた名前（「Sprache / Language」など）です。韓国語と中国語の文は、それぞれの言語のフォントで表示します。
- ドイツ語・フランス語・韓国語・繁体字中国語の文は機械（Claude）で訳したもので、それぞれの言語を母語とする人の確認はまだ受けていません。計算エンジンは変えていません。試験 L01〜L38 で、4 つの新しい言語の画面を確かめています。

### 1.9.5 で変えたところ

- 利用者のスマートフォンで、サンプル「球」の偏微分 ∂f/∂x を描く（「偏微分」→「∂f/∂x を描く」）と、球がまた青と赤に分かれ、球のふちで限りなく大きくなる偏微分 −x/√(4 − x² − y²) は箱の上と下でぎざぎざのとげになりました。
- 立体を曲面のまとまりとして求めます（版 1.9.4 までは、描くすべての曲面がほかの曲面と閉じる必要がありました）。曲面が 1 つだけか、すべての曲面で 1 つの立体になるときはこれまでどおり高さで色分けし、ほかの曲面と一緒に描く立体の曲面は、その最初の曲面の色にそろえて凡例でも関数をまとめて示します。ほかの曲面はそれぞれの色のままです。
- 曲面が箱の上か下から出る所を、格子の線ごとに計算エンジンで間隔を 12 回半分にして求め、そこでマスを切るので（版 1.9.4 までは、箱の外に角があるマスを描きませんでした）、1/(x² + y²) のような極のまわりでも、曲面はなめらかな線で終わります。変えたのは app.js だけで、1.9.5 は別の作業で作られました。

### 1.9.4 で変えたところ

- 利用者のスマートフォンで、サンプル「円」の「面積・長さ」（範囲 −2.6〜2.6）が、面積 12.83、長さは「長さを計算できませんでした」となりました。円の 2 つの半分は ±2 で接するだけで交わらないので交点が見つからず、±2 の外では関数に実数の値がありません。計算エンジンはそこで複素数を積分し、abs() のため違う大きさになっていました。同じ種類の不具合は、サンプル「指数と対数」、「ハート」の長さ、「ドーナツ」の体積（4π² ではなく 76.85）、球より大きい円の上の球にもありました。
- 面積・長さ・体積・表面積を、関数に実数の値がある部分だけで求めます。実数の値がなくなる所で範囲を切り（簡単な数で終わるなら厳密に求める）、結果の下に測った部分を書き添えます。2 つの曲線が交わらずに接する点も交点とし、3D の丸い部分は極座標で測り、限りのない長さは無限大と示します。円の面積と周の長さは 4π、ドーナツは 4π² と 8π² になります。
- どの値も信頼できる桁だけを示します。波の多い曲線の長さは、多くの部分に分けた 15 点のガウス・クロンロッド則で求め（10 桁まで正しい。7 つのサンプルで正しくない桁がありました）、おおよそにしか求まらない体積は桁を減らして示します（サンプル「波（卵パック）」は 39.939589 ではなく 39.9）。計算エンジンと Java のコードは変わりません（変えたのは app.js と i18n-es.js の 7 つの文だけ）。
- 1.9.4 には 1.9.3 の変更も入っています。1.9.3 は同じ時期に別の作業で同じ版の番号で作られ、単独では公開していません。
- テスト仕様書では、各試験を 1 回数えるようにしました（両方の画面で行った D21〜D45 と S01〜S13 を 2 回数えていて、版 1.9.2 の 983 項目は 945 件でした）。

### 1.9.3 で変えたところ

- 利用者のスマートフォンで、版 1.9.2 のサンプル「球」のふちに沿った帯にすじが出て、上下の半分が青と赤で 2 つの物のように見えました。また、あるグラフで 1:1 を切ると、そのあとの球がすべてつぶれて描かれていました。
- 閉じて 1 つの立体になる曲面（球やドーナツの上下の半分）を、高さで色分けした 1 つの物として描き、凡例には 1 本の色の帯を示します。平方根の形で終わる曲面のふちの近くでは、そこでもなめらかに変わる「ふちからの高さの 2 乗」から光を求め、ふちのとなりのマスを丸い曲面の上に持ち上げた小さな三角形に分けるので、すじが出ません。
- 1:1 は選んだ関数だけに保ち（以前の版が保存した値は選んでいないものとする）、半球だけを描くときはふちまで描きます。変えたのは app.js だけです。

### 1.9.2 で変えたところ

- 利用者のスマートフォン（SHARP AQUOS sense8）で見た 3D グラフでは、球とドーナツに平らなマスの輪が出て、球の 2 つの半分が接する所がのこぎりの歯のようになっていました（サンプルの絵も同じ）。曲面を深度バッファーで画素に重ねて、どの点でも手前の面が見えるようにし、格子点で求めた法線で画素ごとに光を当てるようにしました。なめらかでつやのある曲面に、ハイライトとまわりの映り込みが付きます。粗い格子の線も同じ処理の中で描きます。
- 利用者の要望で、「体積・表面積」を開いている間、計測している立体を、同じ色の濃い色合いのつやのある透明な皮に包まれた、薄い色のゼラチンのように示します。皮はまっすぐ見る所では透明で、輪郭に近いほど濃い色を見せます。凡例の文と色の見本もそれに合わせました。値、計算エンジン、Java のコードは変わりません（変えたのは app.js、style.css の 1 行、i18n-es.js の 2 つの文だけ）。

### 1.9.1 で変えたところ

- 利用者の要望で、3D グラフの「体積・表面積」を開いている間、体積を計測している立体を、つやのある透明な膜に満たした本物の薄い色の液体のように示します。画素ごとにたどって描き、液体が厚いところほど色が濃く、膜には明るい部屋の照明が映り込み（斜めほど強く）、後ろにあるものが曲がって透けて見え、箱の底の影も液体の色になります。立体の破線の辺と格子の線はなくしました。
- 指でグラフを回している間は液体を少し粗く描き、指を離すとくっきり描き直します。値、計算エンジン、Java のコードは変わりません（変えたのは app.js と、i18n-es.js の 1 つの文だけ）。

### 1.9.0 で変えたところ

- 利用者の要望で、スペイン語（中南米）を、英語と日本語に続く 3 つ目の画面の言語にしました。画面の文（新しいファイル app/assets/i18n-es.js）、計算エンジンと Java の主なメッセージ、読み上げるキーの名前、一覧の分類名、日付がスペイン語になります。
- メニューと設定の「Language / 言語 / Idioma」で English・日本語・Español を選べます。言語を選んでいないときは、スペイン語に設定した端末ではスペイン語で始まります（日本語に設定した端末は、これまでどおり英語で始まります。1.11.0 からは、端末の言語のリストで最初に当てはまった言語で始まるので、日本語の端末は日本語で始まります。README を参照）。
- 計算、式の書き方、エンジンの一覧の名前は変わりません。計算エンジンは 1.8.4 と同じで、Java は MainActivity が自分で出す 4 つの文だけを変えました。

### 1.8.4 で変えたところ

- 3D グラフで「体積・表面積」を開いている間、体積を計測している立体を、薄い色の液体で満たしたように示します。曲面・側面・底は透けて見え、現実の面のように光が当たります（光の向きほど明るく、つやと、縁ほど強くなる映り込みがあり、低い所ほど少し濃く、箱の底にやわらかな影を落とします）。隠れた辺は破線、計測していない部分は薄くし、色はグラフごとに選びます（曲面の色からいちばん離れた色相）。
- ほかの機能で作った式・方程式・関数・行列を、合うグラフに送れます。入力欄の上の 📈 は、x の式（2D）や x と y の式（3D）、y = 2x + 1・x² + y² = 4（y について解く）・x + y + z = 1（z について解く）のような方程式、2 列か 3 列の数の行列（点）を描きます。履歴の行のメニューには「グラフにする」「3D グラフにする」があり、保存した x（と y）の関数には「グラフ」ボタンがあります。ほかは変えていません。

### 1.8.3 で変えたところ

- 1.8.2 をスマートフォンで試して見つかった 2 つの不具合を直しました。3D のサンプル「球」と「ドーナツ」の絵が真ん中で裂けて見えていたのを、欠けずに描くようにしました。丸いサンプル（球・ドーナツ・二重円すい、2D の円・ハート）を細かさや範囲を変えて描き直すと、保存した 1:1 の設定がオフのときに 1:1:1（2D は 1:1）が外れていたのを、同じ式を描き直す間は比とサンプルの印を保つようにしました。
- 結果を 16 進数で表示する設定では球の縁が求まらなかったので、縁はいつも 10 進数で計算するようにしました。ほかは変えていません。

### 1.8.2 で変えたところ

- 3D グラフの「体積・表面積」の値が早く確定します。厳密な値を探すのを 8 秒から体積 3 秒・曲面ごとに 2 秒に短くし、求めた値を覚えておくので、同じ曲面を描き直すとすぐに出ます。値そのものは変わりません。
- 画面の小さな不具合を 2 つ直しました。図形の例を描いたあともサンプルの印が残っていたことと、「面積・長さ」で、答えが順不同で届くと古い計算が範囲を戻すことがあったことです。

### 1.8.1 で変えたところ

- 3D グラフの「体積・表面積」から「体積」「表面積」のボタンを取り除きました。2 つの値はひとりでに出て、ボタンはそれを片方だけに置き換えるものでした。ほかは変えていません。

### 1.8.0 で変えたところ

- 3D グラフの「体積・表面積」が、開くとすぐに、いま描いている曲面を計算します。
- 2D グラフと 3D グラフに、タップするだけで描けるサンプルの列（17 個と 14 個）があります。
- フォームは、欄を 1 つずつ確かめ、内容を残し、「元に戻す」「やり直す」ができ、表計算ソフトの表を貼り付けられます。
- 意図と違って読まれる入力に注意を出し、「x = 5」のような定義は取り消せ、図形の大きさも確かめます。

変えたのは画面だけです（app.js と style.css）。計算エンジンと Java のコードは 1.6.0 と同じです。試験は PC（Chromium と、同じソースからビルドした計算エンジン）で行いました。スマートフォンの実機ではまだ試験していません（テスト仕様書 6.6）。

### 読む順の目安

- アプリを使う人：4. 取扱説明書（アプリの中の各道具の「？」と、https://hiroshitsu.github.io/qcalc/manual/ にもあります）
- 開発・保守をする人：概要 → 2. 基本設計書 → 3. 詳細設計書 → 5. ビルド・保守マニュアル
- 受け入れの確認をする人：1. 要件定義書 → 6. テスト仕様書・結果

### 補足

- 概要に出てくる「QCalc を Google Play で公開する手順」は、開発者が Play Console で作業するための手順書で、ここには含めていません。
- 署名の鍵（アップロード鍵とテスト用の鍵）とそのパスワードは、設計書にもこのリポジトリにも含まれていません（ファイル名と置き場所だけを記載しています）。
- 取扱説明書（版 1.12.0 からは docs/manual の説明書）の写真は、PC の Chromium で版 1.12.0 の画面をスマートフォン相当の大きさ（360 × 720）で表示し、言語ごとにその言語の代表的な地域の数の書き方（ja-JP、en-US、de-DE、es-MX、fr-FR、ko-KR、zh-TW）で manual/shots.js により撮影したものです。説明書の例の数は、その言語のアプリが出す数と同じです。
