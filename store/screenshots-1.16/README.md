# Google Play の画像（1.16）

1.16.3（release/1.16.3 の 142c975。アプリはこの版のまま）の画面から store/tools/shots.js で撮り直したものです（2026-11-25）。数字や答えは、どれもこの版のアプリが実際に出したものです。スマホの 5 枚目は、1.16.3 で「容器の液量（3D）」から「全体を見る」に替えました（タブレットの 5 枚目は容器の液量のままです）。見出しは store/tools/captions.json（大きな見出し 1 行と小さな説明 1 行）、Pro の機能の画像には「QCalc Pro」の札があります。画像の文字に「無料」「Free」「新しい」などの言葉は使っていません。

お金の出る画像（計算メモの表、単位・通貨の換算）は、その地域の通貨にしたテストのサーバーで撮りました。換算は 100（ja は 1,000 円、ko は 1 万ウォン）です（en USD、en-GB GBP、ja JPY、de EUR、es EUR、es-419 MXN、fr EUR、fr-CA CAD、ko KRW、zh-TW TWD）。de・es-ES・fr・fr-CA は小数点がコンマ、ほかは点です。fr と fr-CA は見出しが同じなので、お金の出ない画像は同じものです。

## 掲載情報の言語ごとの画像

| 掲載情報の言語 | フォルダー | フィーチャー グラフィック |
|---|---|---|
| en-US | screenshots-1.16/en/ | feature-graphic-1.16-en.png |
| en-GB・en-AU | screenshots-1.16/en-GB/ | feature-graphic-1.16-en.png |
| ja-JP | screenshots-1.16/ja/ | feature-graphic-1.16-ja.png |
| de-DE | screenshots-1.16/de/ | feature-graphic-1.16-de.png |
| es-ES | screenshots-1.16/es/ | feature-graphic-1.16-es.png |
| es-419 | screenshots-1.16/es-419/ | feature-graphic-1.16-es.png |
| fr-FR | screenshots-1.16/fr/ | feature-graphic-1.16-fr.png |
| fr-CA | screenshots-1.16/fr-CA/ | feature-graphic-1.16-fr.png |
| ko-KR | screenshots-1.16/ko/ | feature-graphic-1.16-ko.png |
| zh-TW・zh-HK | screenshots-1.16/zh-TW/ | feature-graphic-1.16-zh-TW.png |

## 置く場所

「メインのストアの掲載情報」→ 言語を選ぶ →「グラフィック」の各欄に、上から順に入れます。スマホは 8 枚までです。横長（landscape-1）を入れるときは phone-1〜7 と landscape-1 の 8 枚、入れないときは phone-1〜8。日本（ja）とほかの国で 2〜4 枚目の並びが違います（日本は 2 枚目が信用取引、ほかの国は 2・3 枚目が 3D と計算メモの表で、4 枚目が損切りから株数）。

### 日本（ja）

| 欄 | 順番 | ファイル | 写っているもの |
|---|---|---|---|
| スマートフォン | 1 | phone-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| スマートフォン | 2 | phone-2-margin.png | 信用取引：維持率と追証の株価（QCalc Pro） |
| スマートフォン | 3 | phone-3-2d-to-3d.png | 2D グラフの面を回して立体と体積（上が 2D、下が GPU の 3D。QCalc Pro） |
| スマートフォン | 4 | phone-4-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| スマートフォン | 5 | phone-5-view-whole.png | 長い式の「全体を見る」（行の番号の下の ⤢ から。ローンの毎月の返済額の式を 2 本指で 1.5 倍に。小数点以下の最大桁数は 2。式を直す・式をコピー・結果をコピー・この行を直す） |
| スマートフォン | 6 | phone-6-money.png | 単位・通貨の換算（その地域の通貨） |
| スマートフォン | 7 | phone-7-stats-pair.png | 統計：ヒストグラムと回帰曲線（2 次、決定係数。直線以外の曲線は QCalc Pro） |
| スマートフォン | 8 | phone-8-languages.png | 7 言語・ダークモード・ネットなしで動く |
| スマートフォン（横長を入れるとき 8 枚目） | 8 | landscape-1-2d-to-3d.png | 2D グラフから 3D（横長 16:9） |
| 7 インチ タブレット | 1 | tablet7-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| 7 インチ タブレット | 2 | tablet7-2-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| 7 インチ タブレット | 3 | tablet7-3-3d.png | 立体を 3D で回して見る（回転体、GPU の 3D。QCalc Pro） |
| 7 インチ タブレット | 4 | tablet7-4-margin.png | 信用取引：維持率と追証の株価（QCalc Pro） |
| 7 インチ タブレット | 5 | tablet7-5-tank-3d.png | 容器の液量と重さ、3D（「透明」がオン。3D の表示は QCalc Pro） |
| 10 インチ タブレット | 1 | tablet10-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| 10 インチ タブレット | 2 | tablet10-2-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| 10 インチ タブレット | 3 | tablet10-3-3d.png | 立体を 3D で回して見る（回転体、GPU の 3D。QCalc Pro） |
| 10 インチ タブレット | 4 | tablet10-4-margin.png | 信用取引：維持率と追証の株価（QCalc Pro） |
| 10 インチ タブレット | 5 | tablet10-5-tank-3d.png | 容器の液量と重さ、3D（「透明」がオン。3D の表示は QCalc Pro） |

### ほかの国（en・en-GB・de・es・es-419・fr・fr-CA・ko・zh-TW）

| 欄 | 順番 | ファイル | 写っているもの |
|---|---|---|---|
| スマートフォン | 1 | phone-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| スマートフォン | 2 | phone-2-2d-to-3d.png | 2D グラフの面を回して立体と体積（上が 2D、下が GPU の 3D。QCalc Pro） |
| スマートフォン | 3 | phone-3-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| スマートフォン | 4 | phone-4-possize.png | 株・投資：損切りから株数（QCalc Pro） |
| スマートフォン | 5 | phone-5-view-whole.png | 長い式の「全体を見る」（行の番号の下の ⤢ から。ローンの毎月の返済額の式を 2 本指で 1.5 倍に。小数点以下の最大桁数は 2。式を直す・式をコピー・結果をコピー・この行を直す） |
| スマートフォン | 6 | phone-6-money.png | 単位・通貨の換算（その地域の通貨） |
| スマートフォン | 7 | phone-7-stats-pair.png | 統計：ヒストグラムと回帰曲線（2 次、決定係数。直線以外の曲線は QCalc Pro） |
| スマートフォン | 8 | phone-8-languages.png | 7 言語・ダークモード・ネットなしで動く |
| スマートフォン（横長を入れるとき 8 枚目） | 8 | landscape-1-2d-to-3d.png | 2D グラフから 3D（横長 16:9） |
| 7 インチ タブレット | 1 | tablet7-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| 7 インチ タブレット | 2 | tablet7-2-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| 7 インチ タブレット | 3 | tablet7-3-3d.png | 立体を 3D で回して見る（回転体、GPU の 3D。QCalc Pro） |
| 7 インチ タブレット | 4 | tablet7-4-possize.png | 株・投資：損切りから株数（QCalc Pro） |
| 7 インチ タブレット | 5 | tablet7-5-tank-3d.png | 容器の液量と重さ、3D（「透明」がオン。3D の表示は QCalc Pro） |
| 10 インチ タブレット | 1 | tablet10-1-hist.png | 履歴を表計算のように（番号の付いた行、#1 + #2、√8 = 2√2、選んだ 2 行の合計・平均、表でコピー） |
| 10 インチ タブレット | 2 | tablet10-2-notes-table.png | 計算メモの表のモード（列の式・合計・平均。QCalc Pro） |
| 10 インチ タブレット | 3 | tablet10-3-3d.png | 立体を 3D で回して見る（回転体、GPU の 3D。QCalc Pro） |
| 10 インチ タブレット | 4 | tablet10-4-possize.png | 株・投資：損切りから株数（QCalc Pro） |
| 10 インチ タブレット | 5 | tablet10-5-tank-3d.png | 容器の液量と重さ、3D（「透明」がオン。3D の表示は QCalc Pro） |

## ファイルの一覧（大きさ）

- en：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- en-GB：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- ja：phone-1-hist（1080 × 1920）、phone-2-margin（1080 × 1920）、phone-3-2d-to-3d（1080 × 1920）、phone-4-notes-table（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-margin（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-margin（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- de：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- es：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- es-419：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- fr：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- fr-CA：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- ko：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- zh-TW：phone-1-hist（1080 × 1920）、phone-2-2d-to-3d（1080 × 1920）、phone-3-notes-table（1080 × 1920）、phone-4-possize（1080 × 1920）、phone-5-view-whole（1080 × 1920）、phone-6-money（1080 × 1920）、phone-7-stats-pair（1080 × 1920）、phone-8-languages（1080 × 1920）、landscape-1-2d-to-3d（1920 × 1080）、tablet7-1-hist（1200 × 1920）、tablet7-2-notes-table（1200 × 1920）、tablet7-3-3d（1200 × 1920）、tablet7-4-possize（1200 × 1920）、tablet7-5-tank-3d（1200 × 1920）、tablet10-1-hist（1600 × 2560）、tablet10-2-notes-table（1600 × 2560）、tablet10-3-3d（1600 × 2560）、tablet10-4-possize（1600 × 2560）、tablet10-5-tank-3d（1600 × 2560）、phone-5-tank-3d（1080 × 1920。使いません：1.16.3 で 5 枚目を替えたため、前の画像として残してあります）
- feature-graphic-1.16-en.png（1024 × 500）
- feature-graphic-1.16-ja.png（1024 × 500）
- feature-graphic-1.16-de.png（1024 × 500）
- feature-graphic-1.16-es.png（1024 × 500）
- feature-graphic-1.16-fr.png（1024 × 500）
- feature-graphic-1.16-ko.png（1024 × 500）
- feature-graphic-1.16-zh-TW.png（1024 × 500）
