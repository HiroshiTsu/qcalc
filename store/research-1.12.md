# QCalc 1.12.0 ストアの調べ（段階 M0）

2026-11-19 に調べた記録です。ストアの掲載情報（M1）、スクリーンショット（M2）、動画（M3）の言葉と並びは、ここから決めました。

## 調べ方と限り

- 7 つの言語の市場ごとに、電卓・関数電卓・単位変換のアプリの紹介記事、おすすめのランキング、アプリストアの掲載情報、レビューのまとめを読みました（下の「出典」）。
- Google Play の検索結果と順位は、作業環境から直接は見られませんでした（Play の画面は国・端末・時刻で変わり、ブラウザでの操作もしていません）。そのため、「上位」は紹介記事とランキングによく出るアプリです。順位そのものではありません。
- 本番の前に、本人の端末で各国の Play の検索（下の言葉）を一度見て、上に出るアプリの題名と短い説明の書き方を確かめるとよいです（store/launch-plan-ja.md の手順 3）。

## 市場ごとによく出るアプリ

アプリの名前はこの調べの中だけで使います。QCalc の掲載情報・画像・動画には、ほかのアプリやメーカーの名前を出しません（Google Play の方針と景品表示法）。

| 市場 | よく出るアプリ | 説明の書き方の傾向 |
|---|---|---|
| 日本語 | 万能電卓（ローン・税・通貨など 19 種類）、関数電卓 Panecal（式が見える・有料版あり）、計算機プラス、式と履歴が見れる電卓、らくな計算機（単価比較・無料版は広告）、外貨通貨換算、図形電卓、Photomath、Desmos、HiPER | 「式が見える」「履歴」「税込」「割引」「ローン」「単位換算」「為替」。題名に機能を 2〜3 個並べる形が多い |
| 英語 | RealCalc、HiPER（分数・履歴、グラフは買い切りの Pro）、TechCalc（機能が多い・画面が混む）、NCalc、One Calculator、ClevCalc（換算・ローン・割引）、Desmos・GeoGebra（グラフ）、Photomath・Symbolab・Mathway（解き方は定期購入） | scientific calculator、graphing、unit converter、fractions、history。1 行目で「何ができるか」を言い切る |
| ドイツ語 | RealCalc（ドイツ語なし、Pro 2,99 €）、MyScript Calculator、Desmos（ドイツ語の画面なし）、ウィジェットの電卓、単位の換算アプリ | Taschenrechner、wissenschaftlicher Taschenrechner、Funktionsplotter、Einheitenumrechner、Bruchrechnung、Prozentrechnung。ドイツ語の画面がないアプリが多い |
| スペイン語 | Google の電卓、ClevCalc（単位と通貨、割引、ローン、日付）、Desmos、HiPER、Uno Calculator、Photomath | calculadora científica、conversor de unidades、gráficas、porcentajes、préstamos、IVA。「多くの電卓は広告だらけ」という記事の言い方がある |
| フランス語 | NCalc、HiPER、RealCalc、Desmos、Photomath、学校の電卓（NumWorks・TI・Casio）に似せたもの | calculatrice scientifique、calculatrice graphique、convertisseur d'unités、fractions、mode examen の話題 |
| 韓国語 | 매스렙 Mathlab（無料版はネットが要り広告あり、機能を制限）、까미 계산기（無料版は下に広告、有料 1,000 ウォン）、NCalc、Calculator ∞、계산기 Pro+ | 공학용 계산기、그래프 계산기、단위 변환、분수 계산、행렬、방정식。「광고 없는」で探す人がいる |
| 繁體中文 | 萬能計算器、多功能計算機（房貸・匯率・單位・進制換算）、計算機（單位換算・房貸・匯率・分數）、CalcPro（匯率換算） | 計算機、科學計算機、工程計算機、單位換算、匯率換算、房貸。題名に機能をたくさん並べる |

## 低い評価のレビューによく出る不満と、QCalc の答え

| 不満（よく出る順） | QCalc の事実（掲載情報では事実だけを書く） |
|---|---|
| 計算の途中に全画面の広告が出る。広告がだんだん増える | 広告を入れていない（詳しい説明の中に事実として書く。題名・短い説明・画像には書かない） |
| 定期購入が高い。買い切りがほしい。お金を払っても広告が消えない | QCalc Pro は買い切り（アプリ内での 1 回の購入）。定期購入はない。無料の部分に機能の期限はない |
| 宿題・学校の機能が有料の壁の向こう | 学習と日常に使う機能は無料（作者の決定）。Pro は仕事向けの機能 |
| 解き方（途中の式）が定期購入 | QCalc は解き方の手順は出さないが、厳密な答え（分数・根号・π）を無料で出す。誇張しない |
| ラジアン・度などの切り替えが分かりにくい | 上の帯の「度」「厳密」のチップで今の設定が見え、1 回で変えられる |
| ボタンが多すぎて画面が混む | キーは 4 つのタブに分け、道具は 1 つの「道具」の画面と検索にまとめた（1.12.0） |
| 無料版はインターネットが要る | 計算はすべて端末の中。インターネットは為替レートの取得だけ |
| 端数の誤差（細かい桁が丸まる） | 分数・根号の厳密な計算と、最大 20 万桁（1000 桁を超えるのは Pro） |
| 自分の言語がない（ドイツ語の画面がないなど） | 7 言語の画面と、7 言語の取扱説明書 |

## 検索されやすい言葉（言語ごと）

Google Play には検索語の欄がないので、題名・短い説明・詳しい説明に自然な文で入れます。同じ言葉を何度も並べたり、言葉の一覧だけの段落を作ったりはしません（方針で禁止）。

- ◎＝題名か短い説明に入れる、○＝詳しい説明の最初の段落に、△＝詳しい説明のどこかに 1 回

| 言語 | ◎ | ○ | △ |
|---|---|---|---|
| 日本語 | 関数電卓、単位換算（単位変換） | 電卓、計算機、グラフ、為替、通貨 | 税込、割引、割り勘、ローン、日付計算、分数、方程式、微分、積分、行列、統計、回転体、体積、坪、3D プリンター |
| 英語（米） | scientific calculator、unit converter | graphing、fractions、equations、currency | percent、tip / split the bill、loan、date calculator、matrix、statistics、volume of revolution、3D printing |
| 英語（英・豪） | scientific calculator、unit converter | graphing、fractions、currency | VAT（英）、GST（豪）、metres、percentage、mortgage |
| ドイツ語 | Taschenrechner、wissenschaftlicher Taschenrechner、Einheitenumrechner | Funktionsplotter、Brüche、Währungsrechner | Prozentrechnung、Mehrwertsteuer、Kredit、Datumsrechner、Gleichungen、Matrizen、Statistik、Rotationskörper |
| スペイン語（スペイン） | calculadora científica、conversor de unidades | gráficas、fracciones、divisas | porcentajes、IVA、préstamo、hipoteca、fechas、ecuaciones、matrices、estadística |
| スペイン語（中南米、es-419） | calculadora científica、convertidor de unidades | gráficas、fracciones、monedas | porcentajes、IVA、préstamo、propina、fechas、ecuaciones |
| フランス語（フランス） | calculatrice scientifique、convertisseur d'unités | calculatrice graphique、fractions、devises | pourcentages、TVA、prêt immobilier、dates、équations、matrices、statistiques |
| フランス語（カナダ） | calculatrice scientifique、convertisseur d'unités | graphiques、fractions、devises | pourcentages、TPS / TVQ、pourboire、prêt hypothécaire |
| 韓国語 | 공학용 계산기、단위 변환 | 계산기、그래프、환율 | 분수、방정식、미적분、행렬、통계、퍼센트、대출 이자、날짜 계산、더치페이 |
| 繁體中文 | 工程計算機、單位換算 | 科學計算機、計算機、函數圖形、匯率換算 | 分數、方程式、微積分、矩陣、統計、百分比、房貸、日期計算、分帳 |

## Google Play の方針（掲載情報）

- 文字数：アプリ名 30 文字、簡単な説明 80 文字、詳しい説明 4,000 文字。
- アプリ名・開発者名に「無料」「広告なし」などの値段・宣伝の言葉を入れない。
- アイコン・フィーチャー グラフィック・スクリーンショット・簡単な説明に、順位・成績（No.1、ベスト、人気、今年のアプリ）や値段・お得さ（セール、割引、無料）を入れない。行動を急がせる言葉（今すぐダウンロード）も入れない。
- フィーチャー グラフィックの文字はできるだけ少なく。詳しい説明の最初の数行がいちばん読まれる。簡単な説明をそのまま繰り返さない。言葉の羅列・繰り返しをしない。
- QCalc 側の決まり（20:45 の指示）：根拠のない最上級を書かない。ほかのアプリ・メーカーの名前を出して比べない。「広告なし・定期購入なし・買い切り」は詳しい説明の中で事実として書く。価格を書かない。Qalculate! は「オープンソースの計算エンジン libqalculate を使っている」と事実だけを書き、推薦しているように見せない。

## Play Console の「ファイルをインポート」

- ヘルプ（掲載情報の翻訳、answer 9844778）には、掲載情報の文をファイルから取り込む形式は書かれていませんでした。2026 年 5 月の記事には「CSV か Google スプレッドシートの決まった形のファイルを上げると、Play Console が各言語の掲載情報を埋める」とありますが、列の名前などは確かめられませんでした。
- そのため、取り込み用には広く使われている fastlane の形（store/play-import/<言語>/title.txt・short_description.txt・full_description.txt）を作りました。Play Console の画面で「インポート」の形式が分かったら、この 3 つのファイルから作り直せます（store/tools/listing_check.py が読み書きします）。
- 確かめられなかったことは要判断 63 に書きました。

## M1〜M3 への結論

1. 1 枚目・最初の 2 行で「式をそのまま打って計算できる」と「グラフの面を回すと 3D の立体と体積が出る」を見せる。ほかの電卓との違いがいちばん出る所。
2. 2 番目は日常の道具（値段・割り勘・ローン・日付）。日本語・繁體中文・スペイン語・韓国語の上位アプリはこれを前に出している。
3. 単位と通貨の換算は、どの言語でも検索の言葉の上位なので、題名か短い説明に入れる。
4. 広告・定期購入への不満が強いので、詳しい説明の中に「広告はありません。定期購入もありません。QCalc Pro は 1 回の購入です」と事実で書く（題名・短い説明・画像には書かない）。
5. ドイツ語・フランス語・韓国語・繁體中文では、その言語の画面と説明書があること自体が強みなので、詳しい説明の中で 1 回言う。
6. 例は国のもの：日本の消費税 10 %・坪、ドイツの MwSt. 19 %、フランスの TVA 20 %、スペインの IVA 21 %・メキシコの IVA 16 %、韓国の 부가세 10 %・평、台湾の 營業稅 5 %・坪、英国の VAT 20 %、カナダのケベックの TPS + TVQ。

## 出典

- [Best Scientific Calculator Apps for Android（bestforandroid）](https://www.bestforandroid.com/scientific-calculator-apps/)
- [電卓アプリのおすすめ（マイベスト 6094）](https://my-best.com/6094)
- [電卓アプリ ランキング（m-s-y.com）](https://m-s-y.com/app/ranking/calculator/)
- [Die besten Mathe-Apps für Ihr Smartphone（PC-WELT）](https://www.pcwelt.de/article/1157670/die-besten-mathe-apps-fuer-ihr-smartphone.html)
- [Nueve mejores apps calculadora gratis para Android（Xataka Android）](https://www.xatakandroid.com/aplicaciones-android/nueve-mejores-apps-calculadora-gratis-para-android)
- [Las 5 mejores calculadoras para Android（Androidphoria）](https://androidphoria.com/aplicaciones/mejores-calculadoras-android)
- [매스렙 그래핑 계산기 Mathlab 유료/무료（allcalc.org）](https://allcalc.org/7363)
- [多功能計算機PRO（App Store、香港）](https://apps.apple.com/hk/app/%E5%A4%9A%E5%8A%9F%E8%83%BD%E8%A8%88%E7%AE%97%E6%A9%9Fpro-%E7%A7%91%E5%AD%B8%E5%88%86%E6%95%B0%E6%88%BF%E8%B2%B8%E6%B1%87%E7%8E%87%E5%96%AE%E4%BD%8D%E9%80%B2%E5%88%B6%E6%8F%9B%E7%AE%97/id6469614398)、[萬能計算器（App Store、台湾）](https://apps.apple.com/tw/app/%E8%90%AC%E8%83%BD%E8%A8%88%E7%AE%97%E5%99%A8-%E5%A4%9A%E5%90%88%E4%B8%80%E8%A8%88%E7%AE%97%E5%99%A8/id1221235593)
- [ClevCalc の分析（marlvel.ai）](https://marlvel.ai/intel-report/productivity/clevcalc-calculator)、[Calculator のレビュー（justuseapp）](https://justuseapp.com/en/app/458535080/calculator/reviews)
- [The Best Scientific, Graphing, and CAS Calculator Apps for Android（Medium）](https://medium.com/@skyica/the-best-scientific-graphing-and-cas-calculator-apps-for-android-8698fd896c4d)
- [Google Play の掲載情報の決まり（Play Console ヘルプ 13393723）](https://support.google.com/googleplay/android-developer/answer/13393723)
- [掲載情報の翻訳（Play Console ヘルプ 9844778）](https://support.google.com/googleplay/android-developer/answer/9844778)
- [Google Play の Gemini による掲載情報の翻訳（stora.sh、2026-05-21）](https://stora.sh/blog/2026-05-21-google-play-gemini-listing-localization-screenshots-still-on-you)
