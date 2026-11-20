# ナレーションの音声を Gemini で作る手順（Cloud Shell）

QCalc の動画のナレーションを、Gemini API の音声合成（gemini-3.8-flash-tts）で作ります。必要なのはブラウザーと Gemini API のキーだけです。Cloud Shell には Python があるので、何も入れずに動きます。動画と ffmpeg は使いません。

作った音声は zip にまとめて Claude に渡してください。Claude が動画に入れます。このときリクエストは 0 回で、キーもいりません。

## 回数の目安

- **1 日の回数：** モデルごとに 10 回です。予備の gemini-3.8-flash-lite-tts は別に 10 回あります。
- **戻る時刻：** 日本時間の 17 時です（太平洋時間の午前 0 時。夏時間の間は 16 時）。上限に当たると、戻る時刻が表示されます。
- **1 分の制限：** 1 分に 3 回、入力は 1 分に 1 万トークンまでです。ツールが自動で待つので、そのままにしておいてください。
- **聞き比べ：** 声の数 × 言語の数だけ使います。たとえば 3 つの声を日本語だけで比べると 3 回です。
- **本番：** 1 言語 1 回で、7 言語で 7 回です。

聞き比べ 3 回と本番 7 回なら、合わせて 10 回で 1 日に収まります。聞き比べを増やす日は、本番を 17 時以降か次の日にしてください。一度作った音声は保存してあるので、同じコマンドをもう一度実行しても回数は増えません。

## 1. Cloud Shell を開いて、ツールを取ってくる

https://shell.cloud.google.com/ を開き、下の 2 行を貼って Enter を押します。

```sh
git clone --depth 1 -b feature/gemini-tts https://github.com/HiroshiTsu/qcalc.git
cd qcalc
```

## 2. キーを入れる（画面にも履歴にも残らない）

1 行目を実行したら、キーを貼って Enter を押します。貼っても何も表示されませんが、それで正しく入っています。

```sh
read -s GEMINI_API_KEY
export GEMINI_API_KEY
echo "キーの長さ: ${#GEMINI_API_KEY}"
```

最後の行は、キーの文字数だけを表示します。0 なら入っていないので、1 行目からやり直してください。

## 3. 声を聞き比べる

各言語の最初の 3 段落を、声ごとに 1 回で作ります。下の例は日本語で 3 つの声を比べるので、3 回使います。

```sh
python3 store/tools/video_voice.py ~/qcalc-voice ja --sample 3 --voice Kore,Achird,Sulafat
```

できたファイルを手元にダウンロードします。

```sh
ls ~/qcalc-voice/voice-gemini/sample/
cloudshell download ~/qcalc-voice/voice-gemini/sample/*.wav
```

画面右上の「︙（その他）」→「ダウンロード」でも取り出せます。そのときは `qcalc-voice/voice-gemini/sample/ja-gemini-3.8-flash-tts-Kore.wav` のようにファイルの場所を入れます。

ほかの言語も比べるときは、`ja` を `ja,en` のように変えます（声の数 × 言語の数だけ回数を使います）。

## 4. 本番：7 言語の音声を作る

選んだ声を `--voice` に 1 つだけ書きます。下の例は Achird を選んだ場合です。

```sh
python3 store/tools/video_voice.py ~/qcalc-voice --synth-only --voice Achird
```

言語ごとに「段落の数と秒数」が出ます。最後に `voice-gemini-（日付）.zip` ができます。

- **1 日の上限に当たったとき：** 戻る時刻が表示され、そこまでにできた言語だけの zip ができます。戻る時刻を過ぎてから同じコマンドをもう一度実行してください。できている言語は保存した音声を使うので、残りの言語の分だけ回数を使います。
- **「The cut at the pauses looks wrong」と出たとき：** 段落の切れ目が正しく見つからなかったので、その言語の音声は使いません。同じコマンドをもう一度実行すると、その言語だけ作り直します（1 回使います）。

## 5. zip をダウンロードして渡す

```sh
cloudshell download ~/qcalc-voice/voice-gemini-*.zip
```

zip を Claude に渡してください。zip には、作った音声、聞き比べの音声、使ったモデル・声・話し方の記録（manifest.json）が入っています。キーは入っていません。

最後に、キーを消しておきます。

```sh
unset GEMINI_API_KEY
```

## 補足

- **予備のモデルを使うとき：** `--model gemini-3.8-flash-lite-tts` を付けます。聞き比べと本番で同じモデルにしてください。
- **話し方を変えるとき：** `--style "..."` で変えられます。英語で短く書いてください（長くすると声がぶれやすいと、公式のガイドにあります）。話し方の指示は文章とは別に送るので、読み上げられることはありません。声・話し方・モデルを変えると、別の音声として作り直します（回数を使います）。
- **自宅のパソコン（Mac・Linux）で使うとき：** Python 3 があれば、同じコマンドで動きます。
- **Windows の PowerShell で使うとき：** 次の行でキーを入れ、`python3` の代わりに `py` を使います。作業フォルダーは `~/qcalc-voice` の代わりに `$HOME\qcalc-voice` を指定してください。

  ```powershell
  $k = Read-Host -AsSecureString; $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k)); Remove-Variable k
  ```
