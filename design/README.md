# QCalc design documents (v1.1.0)

**English** | [日本語](#日本語)

The design document set of QCalc 1.1.0 (versionCode 2, package name `io.github.hiroshitsu.qcalc`): requirements, design, usage, maintenance and tests. The documents match the 1.1.0 source code in this repository (commit `409eb6c`).

- Author: Hiroshi Tsukayama (津嘉山 弘)
- Date: 2026-11-12
- Format: PDF (A4), with UML class, sequence and state diagrams and other figures

Start with the English overview: it summarizes all seven documents and shows the main diagrams. The seven documents themselves are written in Japanese.

| File | Document | Contents | Pages |
| --- | --- | --- | ---: |
| [00-overview-en.pdf](00-overview-en.pdf) | **Design overview (English)** | What QCalc is, architecture, main flows, engine protocol, data, build and release, tests, and a guide to the Japanese documents | 16 |
| [00-overview.pdf](00-overview.pdf) | Overview (概要) | Changes in 1.1.0, list of the documents, the big picture, components and versions, glossary, revision history | 9 |
| [01-requirements.pdf](01-requirements.pdf) | 1. Requirements definition (要件定義書) | Purpose, scope, use cases, functional and non-functional requirements, constraints, acceptance criteria | 13 |
| [02-basic-design.pdf](02-basic-design.pdf) | 2. Basic design (基本設計書) | System structure, deployment, modules, screens and screen transitions, main processing flows, stored data, external interfaces, error handling, security | 19 |
| [03-detailed-design.pdf](03-detailed-design.pdf) | 3. Detailed design (詳細設計書) | Class diagram, JavaScript bridge, protocol between the app and the engine, calculation, process supervision, user interface, data formats, time limits, error codes | 53 |
| [04-user-manual.pdf](04-user-manual.pdf) | 4. User manual (操作マニュアル) | Installation, the screen, calculating, calculus (derivatives, integrals, limits), matrices, menu, settings, troubleshooting; with screenshots | 27 |
| [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) | 5. Build and maintenance manual (ビルド・保守マニュアル) | Development environment, build steps (test APK and App Bundle for Google Play), signing, checks, updating libqalculate, opening the project in Android Studio | 15 |
| [06-test-specification.pdf](06-test-specification.pdf) | 6. Test specification and results (テスト仕様書・結果) | Test policy, test items and their results for 1.1.0 (all 583 items passed), tests not yet done | 29 |

Notes:

- The overview mentions a separate guide for publishing QCalc on Google Play. It is a working document for the developer's own Play Console tasks and is not included here.
- The signing keys (the upload key and the test key) and their passwords are not in the documents or in this repository; the documents give only the file names and locations.
- The screenshots in the user manual were taken on a PC: the app's user interface was shown in Chromium at the size of a smartphone screen (details at the beginning of the manual).

## 日本語

QCalc 1.1.0（versionCode 2、パッケージ名 `io.github.hiroshitsu.qcalc`）の要件、設計、使い方、保守、テストをまとめた設計書です。内容はこのリポジトリの 1.1.0 のソースコード（コミット `409eb6c`）に合わせています。

- 作成：津嘉山 弘
- 作成日：2026-11-12
- 形式：PDF（A4）。UML のクラス図・シーケンス図・状態遷移図などの図を含みます。

| ファイル | 文書 | 内容 | ページ |
| --- | --- | --- | ---: |
| [00-overview.pdf](00-overview.pdf) | 概要 | 1.1.0 で変えたところ、文書の一覧、全体像の図、構成要素と版、用語集、改訂履歴 | 9 |
| [01-requirements.pdf](01-requirements.pdf) | 1. 要件定義書 | 目的、対象範囲、ユースケース、機能要件・非機能要件、制約、受け入れ基準 | 13 |
| [02-basic-design.pdf](02-basic-design.pdf) | 2. 基本設計書 | システム構成、配置、モジュール、画面と画面遷移、主要な処理の流れ、保存データ、外部インターフェース、エラー処理、セキュリティ | 19 |
| [03-detailed-design.pdf](03-detailed-design.pdf) | 3. 詳細設計書 | クラス図、JavaScript ブリッジ、計算エンジンとの通信プロトコル、計算処理、プロセス監視、画面処理、データ形式、時間制限、エラーコード | 53 |
| [04-user-manual.pdf](04-user-manual.pdf) | 4. 操作マニュアル | インストール、画面の見方、計算のしかた、解析（微分・積分・極限）、行列、メニュー、設定、困ったとき。各画面の画像つき | 27 |
| [05-build-and-maintenance.pdf](05-build-and-maintenance.pdf) | 5. ビルド・保守マニュアル | 開発環境、ビルド手順（テスト用 APK と Google Play 用 App Bundle）、署名、動作確認、libqalculate の更新手順、Android Studio で開く方法 | 15 |
| [06-test-specification.pdf](06-test-specification.pdf) | 6. テスト仕様書・結果 | テストの方針、テスト項目と 1.1.0 での結果（583 項目すべて合格）、未実施のテスト | 29 |
| [00-overview-en.pdf](00-overview-en.pdf) | Design overview（英語の概要） | 上の 7 つの文書の要点と主な図を、英語でまとめたもの | 16 |

### 読む順の目安

- アプリを使う人：4. 操作マニュアル
- 開発・保守をする人：概要 → 2. 基本設計書 → 3. 詳細設計書 → 5. ビルド・保守マニュアル
- 受け入れの確認をする人：1. 要件定義書 → 6. テスト仕様書・結果

### 補足

- 概要に出てくる「QCalc を Google Play で公開する手順」は、開発者が Play Console で作業するための手順書で、ここには含めていません。
- 署名の鍵（アップロード鍵とテスト用の鍵）とそのパスワードは、設計書にもこのリポジトリにも含まれていません（ファイル名と置き場所だけを記載しています）。
- 操作マニュアルの画面の画像は、PC の Chromium でアプリと同じ画面をスマートフォン相当の大きさで表示して撮影したものです（詳しくは操作マニュアルの冒頭）。
