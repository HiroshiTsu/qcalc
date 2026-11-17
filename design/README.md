# QCalc design documents (v1.8.1)

**English** | [日本語](#日本語)

The design document set of QCalc 1.8.1 (versionCode 12, package name `io.github.hiroshitsu.qcalc`): requirements, design, usage, maintenance and tests. Every document is in English and in Japanese, with the same content. The documents match the 1.8.1 source code in this repository (commit `c9d4f75`).

- Author: Hiroshi Tsukayama (津嘉山 弘)
- Date: 2026-11-17 (9th edition, revised for 1.8.1)
- Format: PDF (A4), with UML class, sequence and state diagrams and other figures

| Document | English | Pages | Japanese | Pages | Contents |
| --- | --- | ---: | --- | ---: | --- |
| Overview | [00-overview-en.pdf](00-overview-en.pdf) | 47 | [00-overview.pdf](00-overview.pdf) (概要) | 25 | What QCalc is, what changed in 1.8.1, 1.8.0, 1.7.1, 1.7.0, 1.6.0, 1.5.0, 1.4.0, 1.3.0, 1.2.0 and 1.1.0, the design in brief, components and versions, list of the documents, glossary, revision history |
| 1. Requirements definition | [01-requirements-en.pdf](01-requirements-en.pdf) | 32 | [01-requirements.pdf](01-requirements.pdf) (要件定義書) | 27 | Purpose, scope, 28 use cases, 54 functional requirements, non-functional requirements, constraints, 32 acceptance criteria, QCalc Pro |
| 2. Basic design | [02-basic-design-en.pdf](02-basic-design-en.pdf) | 37 | [02-basic-design.pdf](02-basic-design.pdf) (基本設計書) | 33 | System structure, deployment, modules, screens and screen transitions (with the forms), keys, main processing flows, stored data, external interfaces, error handling, security |
| 3. Detailed design | [03-detailed-design-en.pdf](03-detailed-design-en.pdf) | 97 | [03-detailed-design.pdf](03-detailed-design.pdf) (詳細設計書) | 90 | Class diagram, JavaScript bridge, protocol between the app and the engine, calculation, process supervision, user interface, data formats, time limits, error codes and messages, QCalc Pro, language, color themes, CSV export, suggestions, the Light or dark setting, special functions with Arb, the time limit setting, forms, the math view, □ boxes, actions on results, analysis and measuring in 2D and 3D graphs, graphs from forms, the Shapes panel, the area shown at once with edges that can be dragged, and for 1.8.0: forms that check, keep and undo, samples for the graphs, the volume of the drawn surface, notes on input |
| 4. User manual | [04-user-manual-en.pdf](04-user-manual-en.pdf) | 46 | [04-user-manual.pdf](04-user-manual.pdf) (操作マニュアル) | 45 | Installation and the language, the screen, calculating (□ boxes, fractions, the suggestions and very long results), the forms for calculus and matrices (up to 30 × 30; checking, Undo and Redo, pasting a table), keyboard input, examples, the menu (graphs with samples, analysis and measuring; shapes: area, volume, length), settings, troubleshooting; with screenshots |
| 5. Build and maintenance manual | [05-build-and-maintenance-en.pdf](05-build-and-maintenance-en.pdf) | 22 | [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) (ビルド・保守マニュアル) | 20 | Development environment, build steps (test APK and App Bundle for Google Play), FLINT and the patch to libqalculate, signing, the build with billing (Gradle), checks, updating libqalculate, Android Studio |
| 6. Test specification and results | [06-test-specification-en.pdf](06-test-specification-en.pdf) | 62 | [06-test-specification.pdf](06-test-specification.pdf) (テスト仕様書・結果) | 60 | Test policy, test items and their results for 1.8.1 (all 881 items passed; the engine and Java tests are results of 1.6.0, as those parts are unchanged), tests not yet done |

### What changed in 1.8.1

- In the 3D graph, the "Volume" and "Surface area" buttons were taken out of "Volume and surface": both values are shown by themselves, and the buttons only replaced them with one of them. Nothing else changed.

### What changed in 1.8.0

- In the 3D graph, "Volume and surface" measures the surface that is drawn, as soon as it is opened.
- The 2D and the 3D graph have rows of samples (17 and 14) that are drawn with one tap.
- The forms check every box, keep what they hold, undo and redo, and take tables pasted from a spreadsheet.
- Input that is read in another way than it was probably meant gets a note, a definition such as "x = 5" can be undone, and the sizes of shapes are checked.

Only the page changed (app.js and style.css); the engine and the Java code are the same as in 1.6.0. The tests were run on a PC (Chromium and the engine built from the same source); the app has not been tested on a phone yet (test specification 6.6).

### Reading order

- Users: 4. User manual
- Developers and maintainers: Overview → 2. Basic design → 3. Detailed design → 5. Build and maintenance manual
- Acceptance: 1. Requirements definition → 6. Test specification and results

### Notes

- The overview mentions a separate guide for publishing QCalc on Google Play. It is a working document for the developer's own Play Console tasks and is not included here.
- The signing keys (the upload key and the test key) and their passwords are not in the documents or in this repository; the documents give only the file names and locations.
- The screenshots in the user manuals were taken on a PC: the app's user interface was shown in Chromium at the size of a smartphone screen (details at the beginning of each manual). The English manual shows the English screens and the Japanese manual the Japanese screens. Three screen examples show 1.8.0 and two (the volume in the 3D graph) show 1.8.1; the others are from earlier versions, as the manuals say.

## 日本語

QCalc 1.8.1（versionCode 12、パッケージ名 `io.github.hiroshitsu.qcalc`）の要件、設計、使い方、保守、テストをまとめた設計書です。どの文書も日本語と英語の 2 通りがあり、内容は同じです。内容はこのリポジトリの 1.8.1 のソースコード（コミット `c9d4f75`）に合わせています。

- 作成：津嘉山 弘
- 作成日：2026-11-17（第 9 版。1.8.1 に合わせて改訂）
- 形式：PDF（A4）。UML のクラス図・シーケンス図・状態遷移図などの図を含みます。

| 文書 | 日本語 | ページ | 英語 | ページ | 内容 |
| --- | --- | ---: | --- | ---: | --- |
| 概要 | [00-overview.pdf](00-overview.pdf) | 25 | [00-overview-en.pdf](00-overview-en.pdf) | 47 | 1.8.1・1.8.0・1.7.1・1.7.0・1.6.0・1.5.0・1.4.0・1.3.0・1.2.0・1.1.0 で変えたところ、文書の一覧、全体像の図、構成要素と版、用語集、改訂履歴（英語版は設計の要点のまとめも含む） |
| 1. 要件定義書 | [01-requirements.pdf](01-requirements.pdf) | 27 | [01-requirements-en.pdf](01-requirements-en.pdf) | 32 | 目的、対象範囲、ユースケース 28、機能要件 54、非機能要件、制約、受け入れ基準 32、QCalc Pro |
| 2. 基本設計書 | [02-basic-design.pdf](02-basic-design.pdf) | 33 | [02-basic-design-en.pdf](02-basic-design-en.pdf) | 37 | システム構成、配置、モジュール、画面と画面遷移（フォームを含む）、キー、主要な処理の流れ、保存データ、外部インターフェース、エラー処理、セキュリティ |
| 3. 詳細設計書 | [03-detailed-design.pdf](03-detailed-design.pdf) | 90 | [03-detailed-design-en.pdf](03-detailed-design-en.pdf) | 97 | クラス図、JavaScript ブリッジ、計算エンジンとの通信プロトコル、計算処理、プロセス監視、画面処理、データ形式、時間制限、エラーコードとメッセージ、QCalc Pro、表示の言語、配色テーマ、履歴の書き出し、入力の候補、ライト／ダークの設定、Arb による特殊関数、計算の制限時間、入力フォーム、数式の形、□ の欄、結果からの操作、2D・3D グラフの解析と計測、フォームからのグラフ、図形の画面、すぐに出て端を指で動かせる面積。版 1.8.0 の、確かめる・残す・元に戻すフォーム、グラフのサンプル、描いている曲面の体積、入力への注意 |
| 4. 操作マニュアル | [04-user-manual.pdf](04-user-manual.pdf) | 45 | [04-user-manual-en.pdf](04-user-manual-en.pdf) | 46 | インストールと表示の言語、画面の見方、計算のしかた（□ の欄、分数、入力の候補、とても長い結果を含む）、解析と行列のフォーム（行列は 30 × 30 まで。欄の確認、「元に戻す」「やり直す」、表の貼り付け）、キーボード入力、式の例、メニュー（グラフのサンプル・解析・計測、図形の面積・体積・長さ）、設定、困ったとき。各画面の画像つき |
| 5. ビルド・保守マニュアル | [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) | 20 | [05-build-and-maintenance-en.pdf](05-build-and-maintenance-en.pdf) | 22 | 開発環境、ビルド手順（テスト用 APK と Google Play 用 App Bundle）、FLINT と libqalculate へのパッチ、署名、課金のある版（Gradle）、動作確認、libqalculate の更新手順、Android Studio |
| 6. テスト仕様書・結果 | [06-test-specification.pdf](06-test-specification.pdf) | 60 | [06-test-specification-en.pdf](06-test-specification-en.pdf) | 62 | テストの方針、テスト項目と 1.8.1 での結果（881 項目すべて合格。計算エンジンと Java は変えていないので、その試験は 1.6.0 の結果）、未実施のテスト |

### 1.8.1 で変えたところ

- 3D グラフの「体積・表面積」から「体積」「表面積」のボタンを取り除きました。2 つの値はひとりでに出て、ボタンはそれを片方だけに置き換えるものでした。ほかは変えていません。

### 1.8.0 で変えたところ

- 3D グラフの「体積・表面積」が、開くとすぐに、いま描いている曲面を計算します。
- 2D グラフと 3D グラフに、タップするだけで描けるサンプルの列（17 個と 14 個）があります。
- フォームは、欄を 1 つずつ確かめ、内容を残し、「元に戻す」「やり直す」ができ、表計算ソフトの表を貼り付けられます。
- 意図と違って読まれる入力に注意を出し、「x = 5」のような定義は取り消せ、図形の大きさも確かめます。

変えたのは画面だけです（app.js と style.css）。計算エンジンと Java のコードは 1.6.0 と同じです。試験は PC（Chromium と、同じソースからビルドした計算エンジン）で行いました。スマートフォンの実機ではまだ試験していません（テスト仕様書 6.6）。

### 読む順の目安

- アプリを使う人：4. 操作マニュアル
- 開発・保守をする人：概要 → 2. 基本設計書 → 3. 詳細設計書 → 5. ビルド・保守マニュアル
- 受け入れの確認をする人：1. 要件定義書 → 6. テスト仕様書・結果

### 補足

- 概要に出てくる「QCalc を Google Play で公開する手順」は、開発者が Play Console で作業するための手順書で、ここには含めていません。
- 署名の鍵（アップロード鍵とテスト用の鍵）とそのパスワードは、設計書にもこのリポジトリにも含まれていません（ファイル名と置き場所だけを記載しています）。
- 操作マニュアルの画面の画像は、PC の Chromium でアプリと同じ画面をスマートフォン相当の大きさで表示して撮影したものです（詳しくは各マニュアルの冒頭）。日本語版は日本語の画面、英語版は英語の画面を載せています。3 つの画面例は版 1.8.0、2 つ（3D グラフの体積）は版 1.8.1 のもので、ほかは、マニュアルに書いたとおり、それより前の版のものです。
