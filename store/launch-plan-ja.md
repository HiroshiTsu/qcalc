# QCalc 1.12.0 公開の計画（本人が読む）

段階 M（ストアと宣伝の素材）で作ったものを、本人が Google Play と YouTube に出すための手順です。外部のサービスへの登録・投稿は、すべて本人が行います（作業環境からは何も出していません）。

作ったもの：

| もの | 場所 |
|---|---|
| 調べた結果（よく出るアプリ、不満、検索の言葉、方針） | store/research-1.12.md |
| 掲載情報（12 の地域） | store/listing-<言語>.md、貼り付け用は store/play-import/<地域>/ |
| スクリーンショット | store/screenshots-1.12/<セット>/（スマホ 8 枚、横長 1 枚、7 インチ 5 枚、10 インチ 5 枚。alt/ はスマホ 5 枚目の差し替え候補で、上げない） |
| フィーチャー グラフィック | store/feature-graphic-1.12-<言語>.png（ja・en・de・es・fr・ko・zh-TW） |
| 動画の台本・絵コンテ・字幕・YouTube の文 | store/video/<言語>/（script.md、storyboard.md、*.srt、youtube.md、thumbnail.png） |
| 動画（mp4） | リポジトリには入れていない。ファイルで送ったもの（言語ごとに promo・youtube・short-1〜3） |
| 作る道具 | store/tools/（README.md に使い方） |
| プレスキット | docs/press/（main に入れると https://hiroshitsu.github.io/qcalc/press/ ） |

## 1. 本人がすることと順番

1.12.0 を main に入れる手順（WORK-IN-PROGRESS.md の「main へのマージの手順」）が終わってから行います。

1. **docs/store-1.12 を main に入れる**。release/1.12.0 を main に入れたあと、このブランチも入れると、プレスキットが GitHub Pages に出ます（store/ はサイトには出ません）。
2. **Play の検索を一度見る**（10 分）。本人の端末の Play で「関数電卓」「電卓」「単位変換」を検索し、上に出るアプリの題名と短い説明の書き方を見ます。store/research-1.12.md の言葉と大きく違えば、作業で直します。
3. **アプリ内アイテムの価格**：Play Console →「収益化」→「アプリ内アイテム」→ qcalc_pro の価格を ¥600 にします。ほかの国は自動の換算でよいか確かめます（換算の値は国ごとに直せます）。
4. **掲載情報（文）**：Play Console →「ユーザーの獲得」→「ストアでの表示」→「メインのストアの掲載情報」。
   1. デフォルトの言語（英語・米国 en-US）に store/play-import/en-US/ の 3 つ（title.txt＝アプリ名、short_description.txt＝簡単な説明、full_description.txt＝詳しい説明）を貼ります。
   2. 「翻訳を管理」→「翻訳を追加」で、次の 11 の言語を足し、それぞれのフォルダの文を貼ります：ja-JP、en-GB、en-AU、de-DE、es-ES、es-419、fr-FR、fr-CA、ko-KR、zh-TW、zh-HK。
   3. 機械翻訳を自動で付ける設定は使いません（ここで作った文を使うため）。
   4. 「ウェブサイト」欄は説明書のアドレス https://hiroshitsu.github.io/qcalc/manual/ 、「メールアドレス」は hiroshitsu.apps@gmail.com。
5. **画像**：同じ画面の「グラフィック」で、言語ごとに次を上げます（言語を切り替えて上げる。上げない言語はデフォルトの英語の画像が出ます）。

   | 掲載情報の言語 | スマホ（8 枚、順番どおり） | 7 インチ・10 インチ | フィーチャー グラフィック |
   |---|---|---|---|
   | en-US | screenshots-1.12/en/（下の注意） | en/tablet7-*、en/tablet10-* | feature-graphic-1.12-en.png |
   | en-GB・en-AU | screenshots-1.12/en-GB/ | en-GB/ | feature-graphic-1.12-en.png |
   | ja-JP | screenshots-1.12/ja/ | ja/ | feature-graphic-1.12-ja.png |
   | de-DE | screenshots-1.12/de/ | de/ | feature-graphic-1.12-de.png |
   | es-ES | screenshots-1.12/es/ | es/ | feature-graphic-1.12-es.png |
   | es-419 | screenshots-1.12/es-419/ | es-419/ | feature-graphic-1.12-es.png |
   | fr-FR | screenshots-1.12/fr/ | fr/ | feature-graphic-1.12-fr.png |
   | fr-CA | screenshots-1.12/fr-CA/ | fr-CA/ | feature-graphic-1.12-fr.png |
   | ko-KR | screenshots-1.12/ko/ | ko/ | feature-graphic-1.12-ko.png |
   | zh-TW・zh-HK | screenshots-1.12/zh-TW/ | zh-TW/ | feature-graphic-1.12-zh-TW.png |

   - スマホの画像は種類ごとに 8 枚までです。横長（landscape-1、1920 × 1080、16:9。「おすすめ」の枠の条件）を入れるときは、phone-1〜7 と landscape-1 の 8 枚にします（phone-8 のオフライン・プライバシーは詳しい説明にも書いてあるため）。横長を入れないときは phone-1〜8。
   - 大きさ：スマホ 1080 × 1920（9:16）、横長 1920 × 1080、7 インチ 1200 × 1920、10 インチ 1600 × 2560。どれも透明のない PNG です。
   - アイコンは今までと同じ store/icon-512.png です。
6. **YouTube**（下の 2 の設定で）：言語ごとに promo.mp4（Play の宣伝動画）、youtube.mp4（紹介動画）、short-1〜3.mp4（ショート）を上げます。
7. **Play の宣伝動画**：Play Console の掲載情報の「動画」欄（YouTube の URL）に、言語ごとの promo の URL を入れます。
8. **クローズドテスト**：テスト版を出し、テスターに案内文（下の 9）を送り、感想を集めます（アプリの「このアプリについて」→「不具合・要望を送る」から届くメール）。12 人以上が 14 日続けて参加してから、本番を申請します。
9. **本番の公開**のあと、24 時間以内にレビューへ返信します（下の 5）。
10. **A/B テスト**は、公開して 1 日に数百人以上がストアの画面を見るようになってから（下の 3）。

## 2. YouTube の設定

- チャンネル：本人の YouTube チャンネル（カスタムのサムネイルを使うには、チャンネルの電話番号の確認が要ります）。
- 公開の設定：Play の宣伝動画（promo）は「限定公開」でもよい（Play からは見られる）。紹介動画（youtube）とショートは「公開」。
- 「子ども向けではありません」を選びます。
- 埋め込みを許可：オン（Play のストアに出すため、また記事に埋め込んでもらうため）。
- 広告：収益化しない（広告を付けない）。宣伝動画に YouTube の広告が出ると、アプリの紹介の途中に別の宣伝が入るため。
- 終了画面・カード：宣伝動画には付けない（Play の宣伝動画の決まり）。紹介動画とショートにも付けなくてよい。
- カテゴリ：「科学と技術」。言語：動画の言語。
- 字幕：youtube.srt を「字幕」から上げます（画面には字幕を焼き込んであるので、上げなくても読めますが、上げると検索に使われます）。
- 題名・説明・タグ・サムネイル：store/video/<言語>/youtube.md と thumbnail.png。説明の中のチャプターの時刻は、動画の長さと合わせてあります（0:00 から始まる行が 3 つ以上あると、YouTube がチャプターにします）。
- 動画は音なしです。仮のナレーション（音声合成）は許可をもらってから作ります（WORK-IN-PROGRESS.md の「本人に許可をもらうこと」）。本人が録音する場合は script.md の時刻に合わせて読み、`ffmpeg -i youtube.mp4 -i voice.m4a -map 0:v -map 1:a -c:v copy -c:a aac -shortest youtube-voice.mp4` で合わせます（絵は作り直しません）。

## 3. 掲載情報のテスト（A/B テスト）と国別の掲載情報

Play Console →「ストアの掲載情報のテスト」。1 回に試すのは 1 つの違いだけにし、少なくとも 7 日、結果が「十分な信頼度」になるまで続けます。

| 順 | 試すこと | A（今） | B（試す案） |
|---|---|---|---|
| 1 | スクリーンショットの 1 枚目 | 式をそのまま計算 | 2D から 3D（今の 4 枚目を 1 枚目に） |
| 2 | 簡単な説明 | 機能を並べる文 | 学生向け（例：「グラフを描き、回して立体と体積まで。方程式・微積分・単位換算も。」） |
| 3 | フィーチャー グラフィック | 3D の立体 | 計算画面と立体を並べる |
| 4 | アプリ名（日本語） | QCalc - 関数電卓・単位変換・グラフ | QCalc - 関数電卓・単位換算・回転体 |

- 言語ごとのテスト（ローカライズされたテスト）は、英語のほか日本語など 5 言語まで同時にできます。人数の多い言語（英語・日本語）から始めます。
- **国別のカスタムの掲載情報**：同じ言語でも国で例を変えたいときに使います。今の文は言語ごとに国の例を入れてあるので（en-GB・en-AU・es-419・fr-CA・zh-HK を別に作った）、最初は要りません。要るとすれば、メキシコ以外の中南米（IVA の率が違う）や、スイス（ドイツ語・フランス語、通貨 CHF）。

## 4. 宣伝する場所と投稿文の案

どのサイトも、宣伝についての決まりを読んでから投稿します（自分のアプリの紹介を禁止・制限しているところが多い）。同じ文を何か所にも貼らず、その場に合わせて書き直します。価格は書きません（Play の購入画面に出る）。「最高」「No.1」なども使いません。

| 場所 | 言語 | 内容 | 注意 |
|---|---|---|---|
| X（本人のアカウント） | 7 言語 | 下の短い文＋ショート動画か画像 1 枚＋Play のリンク | ハッシュタグは 2 つまで |
| YouTube | 7 言語 | 紹介動画・ショート（上の 2） | — |
| Qiita・Zenn | 日本語 | 「libqalculate を Android に載せた話」など技術の記事（作り方が中心、最後にアプリの紹介） | Qiita はアプリの宣伝だけの記事を禁止。技術の内容を主にする |
| note | 日本語 | 「タンクの液量・輪郭から体積を電卓で」など使い方の記事 | — |
| Reddit（r/androidapps など） | 英語 | 新しいアプリの紹介の決まり（曜日・形式）に従う | 多くの板で自作の宣伝は月 1 回まで、または禁止 |
| 数学の先生・学生の集まり（勉強会、教育系のフォーラム） | 日本語・英語 | 回転体・パップスの定理を「⟳ 3D」で見せる例 | 授業での使い方の例として。宣伝の決まりを確かめる |
| 3D プリンターの集まり（Reddit r/3Dprinting、国内のコミュニティ） | 英語・日本語 | 輪郭から回転体 → STL（Pro）の例 | Pro の機能であることをはっきり書く |
| 現場で働く人の集まり（建設・設備のフォーラム） | 日本語 | タンクの液量・早見表、単位をつけた計算 | 結果は参考値であること（取引・証明・設計には使えない）を必ず添える |

投稿文の案（X など。Play のリンクは https://play.google.com/store/apps/details?id=io.github.hiroshitsu.qcalc ）：

- 日本語：「式を紙に書くとおりに打てる関数電卓 QCalc を作りました。単位換算、値段やローンの道具、グラフの面を回して回転体の体積まで。オフラインで動き、個人データは集めません。オープンソースです。」
- English: "I made QCalc, an Android scientific calculator you type into the way you write math. Units and currencies, everyday tools, and graphs you can turn into a 3D solid with its volume. Works offline, collects no personal data, open source."
- Deutsch: „Ich habe QCalc gebaut: einen Taschenrechner für Android, in den man Rechnungen tippt wie auf Papier. Einheiten, Währungen, Alltagswerkzeuge und Graphen, die zum 3D-Körper mit Volumen werden. Offline, ohne Datensammlung, Open Source.“
- Español: «He creado QCalc, una calculadora científica para Android en la que escribes las cuentas como en papel. Unidades, divisas, herramientas del día a día y gráficas que se convierten en sólidos 3D con su volumen. Sin conexión, sin recoger datos y de código abierto.»
- Français : « J’ai créé QCalc, une calculatrice scientifique Android où l’on tape les calculs comme sur papier. Unités, devises, outils du quotidien et courbes qui deviennent des solides 3D avec leur volume. Hors ligne, sans collecte de données, open source. »
- 한국어: "종이에 쓰듯 수식을 입력하는 Android 공학용 계산기 QCalc를 만들었습니다. 단위·환율 변환, 생활 도구, 그래프를 돌려 회전체의 부피까지. 인터넷 없이 작동하고 개인정보를 수집하지 않는 오픈 소스입니다."
- 繁體中文：「我做了 QCalc，一個像在紙上寫算式一樣輸入的 Android 工程計算機。單位與匯率換算、日常工具，還能把函數圖形轉成 3D 立體並算出體積。可離線使用、不收集個人資料、開放原始碼。」

## 5. レビューへの返信の文例（24 時間以内に返す）

返信は短く、レビューの言語で書きます。個人の情報（メールの中身など）は返信に書きません。直す約束は、直す見込みがあるときだけにします。

| 場面 | 日本語 | English |
|---|---|---|
| 良い評価 | レビューをありがとうございます。役に立っているとうかがい、うれしいです。これからも使いやすくしていきます。 | Thank you for the review. I'm glad QCalc is useful to you, and I'll keep making it easier to use. |
| 不具合 | お知らせありがとうございます。直すために、式と手順を、アプリの「このアプリについて」→「不具合・要望を送る」（版と端末は自動で入ります）か hiroshitsu.apps@gmail.com で教えていただけますか。 | Thank you for letting me know. To fix it, could you send the expression and the steps from "About this app" → "Send a bug report or an idea" (it adds the version and the phone) or to hiroshitsu.apps@gmail.com? |
| 要望 | ご提案ありがとうございます。次の版で検討します。 | Thank you for the idea. I'll consider it for a coming version. |
| 使い方が分からない | 各画面の「？」から、その画面の使い方が開きます。○○は「☰ → 道具 → ○○」にあります。 | Tap "?" on a screen to open its help. You'll find ... under ☰ → Tools → .... |
| Pro について | Pro の機能は仕事向けのもので、学習と日常に使う機能は購入しなくてもすべて使えます。Pro は 1 回の購入で、定期購入ではありません。 | The Pro features are meant for work; everything for learning and everyday use works without buying it. Pro is a one-time purchase, not a subscription. |
| 結果が違う | 確かめますので、式と出た結果、期待した結果を hiroshitsu.apps@gmail.com に送っていただけますか。設定（角度の単位・厳密と近似）で答えが変わることもあります。 | I'll check it. Could you send the expression, the result and the one you expected to hiroshitsu.apps@gmail.com? Settings such as the angle unit can change the answer. |

| 場面 | Deutsch | Español | Français |
|---|---|---|---|
| 良い評価 | Danke für die Bewertung! Schön, dass dir QCalc hilft. Ich mache es weiter einfacher. | ¡Gracias por la reseña! Me alegra que QCalc te sea útil; seguiré mejorándola. | Merci pour votre avis ! Ravi que QCalc vous soit utile ; je continue à l’améliorer. |
| 不具合 | Danke für den Hinweis. Schick mir bitte die Rechnung, die Schritte und dein Gerät an hiroshitsu.apps@gmail.com. | Gracias por avisar. ¿Puedes enviarme la operación, los pasos y tu modelo de móvil a hiroshitsu.apps@gmail.com? | Merci du signalement. Pouvez-vous envoyer le calcul, les étapes et votre modèle à hiroshitsu.apps@gmail.com ? |
| 要望 | Danke für die Idee, ich prüfe sie für eine der nächsten Versionen. | Gracias por la idea; la tendré en cuenta para una próxima versión. | Merci pour l’idée, je l’étudierai pour une prochaine version. |
| 使い方 | Das „?“ auf jedem Bildschirm öffnet die passende Hilfe. | El «?» de cada pantalla abre su ayuda. | Le « ? » de chaque écran ouvre son aide. |
| Pro | Die Pro-Funktionen sind für die Arbeit gedacht; alles für Lernen und Alltag geht ohne Kauf. Pro ist ein einmaliger Kauf, kein Abo. | Las funciones Pro son para el trabajo; todo lo de estudio y día a día funciona sin comprar. Pro es una compra única, no una suscripción. | Les fonctions Pro sont pour le travail ; tout ce qui sert aux études et au quotidien fonctionne sans achat. Pro est un achat unique, pas un abonnement. |
| 結果が違う | Ich prüfe das. Schick mir bitte Rechnung, Ergebnis und erwartetes Ergebnis an hiroshitsu.apps@gmail.com. | Lo reviso. ¿Me envías la operación, el resultado y el esperado a hiroshitsu.apps@gmail.com? | Je vérifie. Pouvez-vous envoyer le calcul, le résultat et celui attendu à hiroshitsu.apps@gmail.com ? |

| 場面 | 한국어 | 繁體中文 |
|---|---|---|
| 良い評価 | 리뷰 감사합니다. QCalc가 도움이 된다니 기쁩니다. 앞으로도 더 쓰기 쉽게 만들겠습니다. | 謝謝您的評論！很高興 QCalc 對您有幫助，我會繼續讓它更好用。 |
| 不具合 | 알려 주셔서 감사합니다. 수식, 순서, 휴대폰 기종을 hiroshitsu.apps@gmail.com으로 보내 주시겠어요? | 謝謝回報。可以把算式、操作步驟和手機型號寄到 hiroshitsu.apps@gmail.com 嗎？ |
| 要望 | 제안 감사합니다. 다음 버전에서 검토하겠습니다. | 謝謝建議，我會在之後的版本考慮。 |
| 使い方 | 각 화면의 "?"를 누르면 그 화면의 사용법이 열립니다. | 在每個畫面點「？」就能看到該畫面的說明。 |
| Pro | Pro 기능은 업무용이며, 공부와 일상에 쓰는 기능은 구매하지 않아도 모두 쓸 수 있습니다. Pro는 1회 구매이며 구독이 아닙니다. | Pro 功能是工作用的，學習和日常用到的功能不購買也都能用。Pro 是一次購買，不是訂閱。 |
| 結果が違う | 확인하겠습니다. 수식, 나온 결과, 기대한 결과를 hiroshitsu.apps@gmail.com으로 보내 주세요. | 我會確認。請把算式、得到的結果和預期的結果寄到 hiroshitsu.apps@gmail.com。 |

## 6. プレスキット（docs/press/）

docs/press/index.html に、記事を書く人のためのページを作りました（英語と日本語）。アプリの説明（短い・長い）、事実の一覧（対応 OS、言語、Pro の仕組み、プライバシー、ライセンス）、アイコン・フィーチャー グラフィック・スクリーンショット（ダウンロードできる）、リンク、問い合わせ先。価格は書かず、Qalculate! とは関係のない個人の開発であることを書いています。main に入れると https://hiroshitsu.github.io/qcalc/press/ に出ます。

## 7. 各国のテスターに見てもらうとよい所（M6）

掲載情報・画像の見出し・動画の字幕は、日本語と英語以外は Claude が書いたもので、母語の人の確認がまだです。日本語に訳し戻して意味は確かめました（store/qa-1.12.md）。次の所を、その国の人に見てもらうとよいです。

- **ドイツ語**：アプリ名「QCalc-Taschenrechner & Graphen」が自然か（30 文字の上限）。「Klöpperboden」「Peiltabellen」（タンクの言葉）、「Guldinsche Regel」、「Grundpreise vergleichen」の言い方。du で書いてよいか。
- **スペイン語（スペイン）**：「Cuentas como en papel」の言い方、「toriesférico」「cuadro de amortización」、«» の引用符。**（中南米）**：「renta」「celular」、メキシコの IVA 16 % の例でよいか、中南米のほかの国の人に違和感がないか。
- **フランス語（フランス）**：「Calculatrice graphique」をアプリ名にしたこと（「scientifique」が入らない）、「barèmes de jaugeage」「théorème de Guldin」。**（カナダ）**：「TPS et TVQ」「cellulaire」「courriel」、ケベックの人に自然か。
- **韓国語**：「공학용 계산기」でよいか、「더치페이」「조견표」「경판」（タンクの言葉）、존댓말の程度。
- **繁體中文（台灣）**：「工程計算機」「速查表」「封頭」「分帳」。**（香港）**：「計數機」「按揭」「夾錢」「地盤」が香港の言い方として自然か。
- **英語（英・豪）**：「maths」「surds」「turning points」「VAT」「GST」の例。
- どの言語も：スクリーンショットの見出しが 2 行に収まって読めるか（小さな表示で）、動画の字幕の速さ。

## 9. クローズドテストのテスターへの案内文

新しい個人の開発者アカウントは、本番に出す前に「12 人以上のテスターが 14 日以上続けて参加したクローズドテスト」が要ります。本番の申請では、テスターの集めやすさ、使われ方（すべての機能を使ったか）、感想の要約と集め方を聞かれます（Play Console ヘルプ answer 14151465）。1.12.0 には「このアプリについて」→「不具合・要望を送る」を入れたので（要判断 66）、感想はそこからのメールで集め、申請では「アプリの中のメールの下書き（版・端末・言語だけが入る）と、テスターへの直接の連絡で集めた」と書けます。

送る前に本人が入れるもの：［テストに参加するリンク］（Play Console →「テスト」→「クローズド テスト」→ テスターのタブにある参加用の URL）、［締め切りの日付］（参加してから 14 日以上あと）。

### 日本語

件名：Android の電卓アプリ QCalc のテストへのご協力のお願い

こんにちは。Android の関数電卓アプリ「QCalc」を作っています。Google Play で公開する前のテストに、ご協力いただけないでしょうか。

1. 次のリンクを Android のスマートフォンで開き、「テスターになる」を押してください：［テストに参加するリンク］
2. 同じページの「Google Play でダウンロード」から入れます（Android 7.0 以上、64 ビットの端末）。
3. **14 日間は入れたままにして、テストから抜けないでください**（Google の決まりで、14 日続けて参加した人が 12 人以上いないと公開できません）。
4. 時間のあるときに、次のうちいくつかを試してみてください（説明は見ずに、どこまでできるか）：
   - 1,500 円の品物が 1 割引、税 8 % でいくら？
   - 5 km は何マイル？
   - 3,000 万円を年 1 %・35 年で借りると、毎月の返済は？
   - 今日から 100 日後は何月何日？
   - グラフで y = x と y = x² を描き、「⟳ 3D」を押す
   - 困ったら、各画面の「？」から説明書を開く
5. 分かりにくかった所、動かなかった所、ほしい機能は、アプリの「☰ → このアプリについて → 不具合・要望を送る」から送ってください（メールの下書きには版・端末・言語だけが入ります）。メールで直接 hiroshitsu.apps@gmail.com に送っていただいてもかまいません。

QCalc は個人情報を集めず、広告もありません。テストで入れた QCalc は、公開後もそのまま使えます。［締め切りの日付］ごろまで、どうぞよろしくお願いします。

### English

Subject: Could you help test QCalc, a calculator app for Android?

Hi! I'm making QCalc, a scientific calculator for Android, and I'd like to test it before it goes on Google Play. Could you help?

1. Open this link on your Android phone and tap "Become a tester": [link to join the test]
2. Install QCalc from "Download it on Google Play" on the same page (Android 7.0 or later, 64-bit).
3. **Please keep it installed and stay in the test for 14 days** (Google lets an app be published only after at least 12 testers have stayed in for 14 days in a row).
4. When you have time, try a few of these, without reading any help first:
   - A price of 1,500 with 10 % off and 8 % tax: how much?
   - How many miles is 5 km?
   - Borrowing 300,000 at 5 % for 30 years: the monthly payment?
   - What date is 100 days from today?
   - In the graph, draw y = x and y = x² and tap "⟳ 3D"
   - If you get stuck, tap "?" on the screen to open the manual
5. Please tell me what was unclear, what didn't work and what you would like: in the app, ☰ → About this app → Send a bug report or an idea (the draft has only the version, the phone and the language), or by mail to hiroshitsu.apps@gmail.com.

QCalc collects no personal data and has no ads. The copy you install for the test keeps working after the release. Thank you very much — the test runs until about [end date].

### テスターの募集

- 家族・友人・知人のほか、テスターを集める場（「12 人のテスター」を互いに手伝うコミュニティなど）があります。使うときは、その場の決まりと、Google の決まり（お金やお返しで評価を集めない）を守ります。
- テスターには、評価やレビューを頼まないでください（クローズドテストの間はストアにレビューを書けません。公開後も、見返りのあるお願いは Google の方針に反します）。

## 8. 守っている決まり（確認用）

- 題名・簡単な説明・画像・動画の文字に、順位・価格・お得さの言葉（最高、No.1、ベスト、人気、無料、広告なし、セール、今すぐダウンロードなど）を使っていない。根拠のない最上級や、ほかのアプリ・メーカーの名前を出した比べ方もしていない（store/tools/listing_check.py で確かめる）。
- 「広告なし・定期購入なし・1 回の購入」は詳しい説明の中に事実として書いた。価格はどこにも書いていない。
- Qalculate! は「オープンソースの計算エンジン libqalculate を使っている」と事実だけを書き、Qalculate! の開発者とは関係のない個人の開発であることも書いた。
- QCalc Pro の機能を見せる画像・動画には「QCalc Pro」の印を付けた（3D の表示、輪郭から回転体、1,000 桁を超える計算、タンクの鏡板）。
