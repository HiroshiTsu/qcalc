# QCalc 1.16.5 のレビュー（ECC の手順による）

- 対象：`release/1.16.5`（09ae77d、versionCode 38）。コードは変えていません。直すのは 1.17 の予定です。
- 手順：ECC（github.com/affaan-m/ECC）のレビュー用エージェント `code-reviewer`、`security-reviewer`、`cpp-reviewer`、`java-reviewer`（Spring 向けの項目は除き、Java 一般の項目だけ）、`silent-failure-hunter` の確認項目に沿って見ました。
- ECC の決まりに従い、確信が 80% 以上あり、行番号と起きる場面を示せるものだけを書いています。HIGH 以上には、コードの箇所、起きる場面、今ある防ぎで止まらない理由を付けています。
- 読んだ範囲：Java はすべて（app/src、app/src-billing）、`bridge/qalc-engine.cc`、`app/assets/app.js` のうち HTML の差し込み（innerHTML の 8 か所）、保存（store、履歴の大きさ）、読み込み（import）の部分。app.js の全行と翻訳ファイル、組み立て用のスクリプトは読んでいません。

## まとめ

| 重要度 | 件数 | 状態 |
|---|---|---|
| CRITICAL | 0 | 問題なし |
| HIGH | 1 | 注意 |
| MEDIUM | 1 | 参考 |
| LOW | 1 | メモ |

判定：WARNING（HIGH が 1 件）。HIGH の件は 1.16.4 にもある前からの問題で、1.16.5 で入ったものではありません。起きる条件はかなり限られます（Pro の 2000 桁以上の精度で、とても大きな数を計算したとき）。1.16.5 の公開は止めずに、1.17 で早めに直すことを勧めます。

---

## [HIGH] 1. 保存された ans に「2000 桁以上で指数がとても大きい数」が入ると、エンジンが起動のたびに止まり、計算がずっとできなくなる

**場所**
- `bridge/qalc-engine.cc:1195`：指数は 9 桁まで（999,999,999 まで）受け付ける。
- `bridge/qalc-engine.cc:1206`：`mpz_ui_pow_ui(p, 10, |e|)` で 10^|e| をそのまま整数として作る（`read_long_numbers`）。
- `bridge/qalc-engine.cc:1854`：時間切れの見張り（watchdog）が動くのは calc、plot、plot3d だけで、`set_ans` は見張られない。
- `app/src/io/github/hiroshitsu/qcalc/Engine.java:319-329`：`set_ans` が失敗しても無視され（`catch (Exception ignored)`）、保存された ans は残る。

```cpp
if(k2 > k && k2 - k < 10) {exp10 = strtol(...); ...}          // 1195
mpz_ui_pow_ui(p, 10, (unsigned long) (e < 0 ? -e : e));         // 1206
```

**起きる場面**
1. 精度を 3000 桁（Pro）にして、`pi × 10^999999990` を計算する。答えは近似値なので、ans は全部の桁つきで `interval(3.14159…(約3000桁)E999999990, …)` として保存される（`Engine.onAnswerEvent`、500,000 文字以内なので保存される）。
2. 次にエンジンが起動するとき（アプリの再起動、時間切れ、停止ボタンのあと）、`set_ans` がこの値を読む。`read_long_numbers` が両端の数それぞれについて 10^約999,997,000 を作る。
3. パソコンで GMP のこの計算を測ると、数 1 つで **12.3 秒、最大 1.17 GB** でした（10^1億なら 0.9 秒・135 MB）。スマホでは Java の 20 秒の待ち時間を超えるか、メモリ不足でエンジンが止められます。
4. `Engine.java` はこの失敗を無視するので、次の計算の依頼は止まったエンジンの後ろで待たされ、時間切れになります。`stop()` のあと、次の依頼でまた `set_ans` から始まるので、**どの計算も時間切れか「エンジンが止まりました」になります**。ans はアプリを閉じても残るため、直すにはアプリのデータを消すしかなく、履歴も消えます。

**今ある防ぎで止まらない理由**
- `MAX_SAVED_ANSWER`（500,000 文字）は長さしか見ない。この値は約 6,000 文字。
- `too_deeply_nested` は括弧の深さしか見ない。
- watchdog は `set_ans` では動かない。
- `Engine.ensureRunning` は `set_ans` の答えを確かめない。

**確かめたこと・確かめていないこと**
- GMP の時間とメモリは、このレビューの作業環境（x86-64）で測りました。
- 実機では再現していません（エンジンの組み立てが要るため）。libqalculate が保存用の表示でこの値を `E` の形で書くことを前提にしています。`read_long_numbers` が `E` を読むように作られていることも、この前提に合っています。

**直し方（1.17）**
- a) `read_long_numbers`：|e| が大きいとき（たとえば 100,000 を超えるとき、または `ndigits + MAX_PRECISION` を超えるとき）は整数に展開せず、そのままの文字列を libqalculate に読ませる（libqalculate は指数を MPFR の中で別に持つので軽い）。
- b) main のループ：`set_ans` でも watchdog を動かす（15,000 + 3,000 ms）。
- c) `Engine.ensureRunning`：`set_ans` の答えが `"ok":true,"set":true` でないとき（null、EOF、`"set":false`）は、保存された ans を忘れる（`lastAnswer = null`、prefs の `"ans"` を消す）。悪い値が 1 つあっても、起動のたびに止まることがなくなる。

**テストの案**
- `read_long_numbers` に `"1.(2500桁)E999999990"` を渡し、すぐ返ること。
- Java：`set_ans` で終了するエンジンを使い、ans が消えて次の計算が通ること。
- 実機：精度 3000 で `pi × 10^999999990` を計算し、アプリを閉じて開き直したあとも `1+1` が計算できること。

---

## [MEDIUM] 2. 「ファイルを開く」でファイルを選んでいる間にアプリが閉じられると、選んだファイルが計算メモに入らず、何も表示されない

**場所**
- `app/src/io/github/hiroshitsu/qcalc/MainActivity.java:658-671`（REQUEST_OPEN）
- 同じ形：`MainActivity.java:673-684`（REQUEST_SAVE の「保存できませんでした」）

**起きる場面**
1. 計算メモで「ファイルを開く」を押すと、Android のファイル選択の画面になる。
2. メモリの少ないスマホでは、この間に QCalc のプロセスが止められることがある。開発者向けオプションの「アクティビティを保持しない」でも同じことが起きる。
3. ファイルを選ぶと、Android は MainActivity を作り直し、`onCreate` のすぐあとに `onActivityResult` を呼ぶ。このとき WebView はまだ `index.html` を読み込んでいる途中。
4. `sendEvent` は `window.QalcBridge && …` をまだ読み込まれていないページで実行するので、何も起きない。イベントは消え、メモにも入らず、エラーも出ない。

**今ある防ぎで止まらない理由**
ほかのアプリから共有されたとき（`takeShare`）は `giveImport` を使い、ページの準備ができるまで待つ（`pendingImport`）。ファイル選択から戻ったときは `sendEvent` を直接呼んでいる。

**直し方（1.17）**
- REQUEST_OPEN の 2 か所（キャンセルと読み込み結果）を `giveImport(...)` にする。
- REQUEST_SAVE も、ページの準備ができる前なら待たせる。`pageReady` で流すイベントの行列（`pendingEvents`）を 1 つ作り、`pendingImport` もそこにまとめるとよい。

**テストの案**
`adb shell settings put global always_finish_activities 1` にしてから「ファイルを開く」で .txt を選び、メモに入ること。終わったら 0 に戻す。

---

## [LOW] 3. 夏時間の切り替わりや、タイムゾーンの違う国への移動をまたぐと、エンジンの時刻が 1 時間以上ずれたままになる

**場所**
`app/src/io/github/hiroshitsu/qcalc/Engine.java:270`、`379-383`（`posixTimeZone`）

**起きる場面**
エンジンには、起動した時点の UTC からの差が固定の値（`LOC-1:00` など）で渡されます。アプリがメモリに残ったまま、次のどれかが起きると、`now`、`today`、時刻の変換が、エンジンが起動し直すまでずれます。
- 夏時間が切り替わる（ヨーロッパは 2027 年 3 月 28 日、アメリカは 2027 年 3 月 14 日）。
- 端末のタイムゾーンを変える（日本からペルーへ移動したときなど）。

日本にいる間は、夏時間がないので起きません。

**直し方（1.17）**
いちばん簡単なのは、`ensureRunning` で渡した差を覚えておき、`call()` で今の差と違えば `stop()` してから起動し直すことです。ans は Engine が渡し直すので、失うものはありません。

---

## 見て、問題がなかったところ（ECC の確認項目）

- **WebView**：ファイルとコンテンツへのアクセスは切ってある。読み込むのは `file:///android_asset/` だけで、外のリンクは `Links` が許すもの（http、https、mailto、QCalc のストアのページ）しか開かない。
- **JavaScript から呼べるメソッド（QalcNative）**：どれも例外を受け止めている。ファイル名（正規表現）、MIME、大きさ（保存 16 MB、画像 4 MB、共有テキスト 100,000 文字）、StateStore の名前（`[a-z0-9._-]{1,64}`）を確かめている。テスト用の Pro の切り替えは、テスト版（`.debug`）でしか効かない。
- **ShareProvider**：外に公開されておらず、読むだけ。決まった名前の画像しか出さない。
- **購入（PlayBilling）**：支払い済みの購入は承認（acknowledge）している。保留中の支払いも扱っている。返金されたあとは、次の問い合わせで Pro が外れる。
- **為替の更新**：接続と読み込みに時間の上限があり、1 MB を超えれば止める。中身を確かめ、一時ファイルに書いてから置き換えている。
- **innerHTML（app.js の 8 か所）**：決まった文字列か、`toFixed` した数だけを入れている。読み込んだ計算メモは文字として扱っている。
- **履歴の保存**：`HISTORY_BUDGET`（100 万文字）と 300 行で抑えていて、StateStore の上限（約 419 万文字）より十分小さい。
- **C++ エンジン**：答えは別の出力にまとめて書き、watchdog と `on_terminate` で、答えが必ず 1 行返るようにしている。JSON のあとに余計な文字があれば受け付けない。
