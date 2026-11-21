# ナレーションの音声を Chatterbox で作る手順（自分のパソコン、無料）

QCalc の動画のナレーションを、Chatterbox Multilingual V3（Resemble AI、MIT ライセンス）で作ります。自分のパソコンで動くので、無料で、1 日の回数の制限もありません。1 段落ずつ作るので、長い音声を切り分ける必要もありません。

本人が日本語・英語・スペイン語で Gemini の Achird と聞き比べ、「同じくらい」「日本語の読み間違いはなかった」として、こちらに決めました（2026-11-20）。

**2026-11-21 追記：** 日本語は不自然で発音もおかしいので、日本語には Chatterbox を使わないことにしました。ほかの声と聞き比べる手順は `TTS-ENGINES-ja.md` です（Chatterbox も、比べる相手として並べられます）。

作った音声は、言語ごとの zip にまとめて Claude に渡してください。Claude が動画に入れます。

## 1. 準備（最初の 1 回だけ）

Chatterbox は Python 3.11 で開発・試験されているので、uv で Python 3.11 の専用の環境を作ります。Ubuntu 本体の Python には触りません。

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
uv venv --python 3.11 ~/chatterbox-env
source ~/chatterbox-env/bin/activate
uv pip install "git+https://github.com/resemble-ai/chatterbox.git"
```

pip の chatterbox-tts は古い版で V3 のモデルを選べないので、GitHub の最新版を入れます。

ツールを取ってきます。

```sh
git clone --depth 1 -b feature/chatterbox-tts https://github.com/HiroshiTsu/qcalc.git ~/qcalc-tts
```

すでに `~/qcalc-tts` があるときは、代わりに次を実行します。

```sh
cd ~/qcalc-tts
git fetch --depth 1 origin feature/chatterbox-tts
git checkout -B feature/chatterbox-tts FETCH_HEAD
```

## 2. 端末を開くたびに

```sh
source ~/chatterbox-env/bin/activate
cd ~/qcalc-tts
```

行の先頭に `(chatterbox-env)` と出ていれば、準備ができています。

## 3. 読み間違えやすい段落を先に聞く

数字や記号（√、π、=、km/h など）のある段落だけを、言語ごとに最大 6 つ作ります。

```sh
python store/tools/chatterbox_tts.py ~/qcalc-voice --sample tricky
vlc ~/qcalc-voice/voice-chatterbox/sample/*.wav
```

読み方がおかしい言葉があれば、`store/tools/tts-readings.json` に読み方を書きます（字幕は変わりません）。例：

```json
{"ja": [["√", "ルート"], ["π", "パイ"]]}
```

## 4. 本番：7 言語の全段落を作る

```sh
python store/tools/chatterbox_tts.py ~/qcalc-voice
```

- **時間：** CPU で 1 段落 1 分くらい、7 言語で 3 時間くらいです。寝ている間に動かしても大丈夫です。
- **途中で止めたとき（Ctrl + C）：** 同じコマンドをもう一度実行すると、続きから作ります。できた段落は作り直しません。
- **言語を選ぶとき：** `python store/tools/chatterbox_tts.py ~/qcalc-voice ja,en` のように書きます。
- **終わると：** 言語ごとに `~/qcalc-voice/voice-chatterbox-ja.zip` のような zip ができます。

## 5. 聞いて確かめる

言語が終わるたびに、ほかより極端に長い・短い段落があれば「check ja:7 …」のように表示されます。モデルがまれに言葉を足したり落としたりするためです。聞いておかしければ、その段落だけ作り直します（別の種で作ります）。

```sh
python store/tools/chatterbox_tts.py ~/qcalc-voice --redo ja:7
```

「long ja:7 …」は、速く読んでも動画のその場面に収まらない段落です。そのまま Claude に伝えてください。

## 6. zip を渡す

`~/qcalc-voice/` にできた `voice-chatterbox-<言語>.zip` を、Claude のチャットに添付します。zip には音声と、どの音声がどの動画のどの場面かの記録（manifest.json）が入っています。

## 補足

- **GPU：** GTX 1650（4 GB）ではメモリが足りないので、既定は CPU です。8 GB 以上の GPU があれば `--device cuda` で速くなります。
- **声を変えるとき：** `--voice 録音.wav`（10 秒くらいの声）で、その声に似せます。他人の声は、本人の許可がないと使えません。
- **透かし：** Chatterbox は、聞こえない電子透かし（PerTh）を音声に入れます。音質には影響しません。
