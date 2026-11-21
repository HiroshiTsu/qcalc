# ナレーションの声を選ぶ：Qwen3-TTS・Ming・Irodori のサンプルを自分のパソコンで作って聞き比べる

QCalc の動画のナレーションの声を選び直すための手順です。Chatterbox Multilingual の日本語は不自然で発音もおかしかったので（2026-11-21）、日本語には Chatterbox を使いません。ほかの言語も、もっと良い声があれば変えます。

候補のエンジンで、同じ段落（今の `--sample tricky` と同じ、数字・単位・記号のある段落）を、女性と男性の「落ち着いた大人のナレーション」の声で作ります。聞き比べて、言語ごとにエンジンと声を決めます。決めたら、その声で全部の段落を作って、言語ごとの zip を Claude に渡します。

- 道具：`store/tools/tts_engines.py`（ブランチ `feature/tts-engines`）。今の `chatterbox_tts.py` も、そのまま使えます。
- エンジンは、エンジンごとに別の Python 環境に入れます。アプリにも、リポジトリの依存にも入りません。
- コマンドは、そのままコピーして端末に貼れば進むように書いてあります。`~/qcalc-voice` が作業用のフォルダです。

## 0. エンジンとパソコン

| エンジン | 言語 | 声 | Ubuntu 機（GTX 1650、4 GB） | RTX 4060 の機（8 GB） | GPU のメモリの目安 |
| --- | --- | --- | --- | --- | --- |
| **Qwen3-TTS**（本命） | 7 言語すべて | 説明文から作る（女性・男性） | 声を作る 1.7B は CPU で（数分）。読み上げは 0.6B を fp16 で GPU | 1.7B を bf16 で GPU | 1.7B：5〜6 GB、0.6B：2〜3 GB |
| **Ming-3.0-tts-0.5B** | 7 言語すべて | 説明文から作る（女性・男性） | GPU では動かない（bf16 がない）。CPU なら動くが遅い | bf16 で GPU | 4〜5 GB（重みのファイルは 2.96 GB） |
| **Irodori-TTS v4.1-Small** | 日本語だけ | 説明文から作る（女性・男性） | fp32 で 3.5 GB 以上いるので、入らないことが多い。CPU か int8 版 | bf16 で GPU | bf16：約 2 GB、fp32：3.5〜4 GB |
| Chatterbox（比べる用） | 7 言語すべて | 決まった声 1 つ | CPU（今までどおり） | GPU でも動く | — |

- GTX 1650 は bf16 が使えないので、道具は自動で fp16（Irodori は fp32）にします。
- メモリの目安は見込みです。実際の値は、道具が段落ごとに表示し、聞き比べの一覧と manifest に残します。
- **おすすめ**：サンプルは RTX 4060 のパソコンでまとめて作るのがいちばん楽です。Ubuntu 機だけで作るときは、Qwen3 を `--qwen-size 0.6b` で、Irodori と Ming を `--device cpu` で作ります。

## 1. 共通の準備（最初の 1 回だけ）

GPU が見えているか確かめます（「CUDA Version」の数字を覚えておきます）。

```sh
nvidia-smi
```

ドライバーが古いとき（CUDA Version が 12.8 より小さいとき）は、新しくして再起動します。

```sh
sudo ubuntu-drivers install
sudo reboot
```

uv（Python の環境を作る道具）、音を聞く VLC、ffmpeg を入れます。

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
sudo apt install -y vlc ffmpeg git
```

道具を取ってきます。

```sh
git clone --depth 1 -b feature/tts-engines https://github.com/HiroshiTsu/qcalc.git ~/qcalc-tts
```

すでに `~/qcalc-tts` があるときは、代わりに次を実行します。

```sh
cd ~/qcalc-tts
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
```

モデルは、初めて使うときに Hugging Face から自動で取ってきます（1 つ 2〜5 GB、`~/.cache/huggingface` に入ります）。ディスクの空きは 25 GB くらい見ておいてください。

## 2. Qwen3-TTS（本命）

### 2-1. 環境を作る（最初の 1 回だけ）

```sh
uv venv --python 3.12 ~/tts-qwen3
source ~/tts-qwen3/bin/activate
uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
uv pip install -U qwen-tts
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

最後の行で `True` と GPU の名前が出れば準備ができています。

### 2-2. 端末を開くたびに

```sh
source ~/tts-qwen3/bin/activate
cd ~/qcalc-tts
```

### 2-3. 声を作る（女性と男性、最初の 1 回だけ）

説明文（`store/tools/tts-voices.json`）から、短い見本の録音を作ります。この見本の声で、全部の段落を読みます。

RTX 4060：

```sh
python store/tools/tts_engines.py design ~/qcalc-voice --engine qwen3
```

GTX 1650（声を作るモデルは 1.7B しかないので、CPU で作ります。数分かかります）：

```sh
python store/tools/tts_engines.py design ~/qcalc-voice --engine qwen3 --device cpu
```

できた見本は `~/qcalc-voice/tts/voices/qwen3-female.wav` と `qwen3-male.wav` です。声が気に入らないときは、`tts-voices.json` の説明文か seed を変えて、`design ... --redesign` で作り直します。

### 2-4. サンプルを作る（日本語・英語・スペイン語）

RTX 4060：

```sh
python store/tools/tts_engines.py sample ~/qcalc-voice ja,en,es --engine qwen3
```

GTX 1650（読み上げは小さい 0.6B のモデルで）：

```sh
python store/tools/tts_engines.py sample ~/qcalc-voice ja,en,es --engine qwen3 --qwen-size 0.6b
```

ほかの 4 言語（de・fr・ko・zh-TW）も聞きたいときは、言語を `ja,en,es,de,fr,ko,zh-TW` にします。

## 3. Ming-3.0-tts-0.5B（比べる相手）

公式の手順は Python 3.10、PyTorch 2.6、CUDA 12.4、Transformers 4.46.3、pynini 2.1.6（conda）と版が決まっているので、conda で環境を作ります。**GTX 1650 では GPU で動きません**（Ming のコードは bf16 で計算します）。RTX 4060 のパソコンで作るか、Ubuntu 機では `--device cpu` で作ります。

入れるのに手間がかかりすぎるときは、後回しにしてかまいません（そのことを Claude に伝えてください）。

### 3-1. 環境を作る（最初の 1 回だけ）

```sh
curl -L -O https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh
bash Miniforge3-Linux-x86_64.sh -b -p ~/miniforge3
source ~/miniforge3/bin/activate
conda create -y -n tts-ming python=3.10
conda activate tts-ming
git clone --depth 1 https://github.com/inclusionAI/Ming-3.0-tts.git ~/Ming-3.0-tts
pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
pip install -r ~/Ming-3.0-tts/requirements.txt
conda install -y -c conda-forge pynini==2.1.6
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

### 3-2. 端末を開くたびに

```sh
source ~/miniforge3/bin/activate
conda activate tts-ming
cd ~/qcalc-tts
```

### 3-3. 声を作って、サンプルを作る

RTX 4060：

```sh
python store/tools/tts_engines.py design ~/qcalc-voice --engine ming
python store/tools/tts_engines.py sample ~/qcalc-voice ja,en,es --engine ming
```

Ubuntu 機（CPU、時間がかかります）：

```sh
python store/tools/tts_engines.py design ~/qcalc-voice --engine ming --device cpu
python store/tools/tts_engines.py sample ~/qcalc-voice ja,en,es --engine ming --device cpu
```

pynini が入らなかったときは、どちらのコマンドにも `--no-text-normalization` を足します（数字の読みが悪くなることがあります）。Ming の公式の手順が `~/Ming-3.0-tts` 以外の場所にあるときは `--ming-repo 場所` を足します。

## 4. Irodori-TTS v4.1-Small（日本語だけ）

Irodori は、自分のフォルダの中で uv が作る環境で動かします。道具は、そのフォルダから `uv run --no-sync` で動かします。fp16 は使えないので、GTX 1650 では fp32 になり、GPU のメモリが足りないことがあります。そのときは `--device cpu` か、int8 の版（下）を使います。

### 4-1. 環境を作る（最初の 1 回だけ）

```sh
git clone --depth 1 https://github.com/Aratako/Irodori-TTS.git ~/Irodori-TTS
cd ~/Irodori-TTS
uv sync --extra cu128
uv run --no-sync python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

### 4-2. 声を作って、サンプルを作る

```sh
cd ~/Irodori-TTS
uv run --no-sync python ~/qcalc-tts/store/tools/tts_engines.py design ~/qcalc-voice --engine irodori
uv run --no-sync python ~/qcalc-tts/store/tools/tts_engines.py sample ~/qcalc-voice ja --engine irodori
```

GTX 1650 で「CUDA out of memory」と出たときは、int8 の版で作ります。

```sh
cd ~/Irodori-TTS
uv run --no-sync python ~/qcalc-tts/store/tools/tts_engines.py design ~/qcalc-voice --engine irodori --irodori-model Aratako/Irodori-TTS-v4.1-Small-Quantized/int8-weight-only
uv run --no-sync python ~/qcalc-tts/store/tools/tts_engines.py sample ~/qcalc-voice ja --engine irodori --irodori-model Aratako/Irodori-TTS-v4.1-Small-Quantized/int8-weight-only
```

それでも入らないときは、`--irodori-model ...` の代わりに `--device cpu` を足します。

v4-Large は、重みの許諾が Gemma の利用規約なので使いません（道具も受け付けません）。

## 5. Chatterbox も並べる（英語・スペイン語、比べる用）

前に作った環境（TTS-CHATTERBOX-ja.md）で動かします。

```sh
source ~/chatterbox-env/bin/activate
cd ~/qcalc-tts
python store/tools/tts_engines.py sample ~/qcalc-voice en,es --engine chatterbox
```

## 6. 聞き比べる

サンプルを作るたびに、聞き比べの一覧が作り直されます。ブラウザで開くと、段落ごとに全部のエンジンと声が並び、その場で聞けます。

```sh
xdg-open ~/qcalc-voice/tts/sample/listen.html
```

VLC で聞くときは次のとおりです（ファイル名で、言語・エンジン・声・段落が分かります。例：`ja-irodori-female-p09-youtube-01.wav` は、日本語・Irodori・女性・9 番目の段落）。

```sh
vlc ~/qcalc-voice/tts/sample/ja/*.wav
```

一覧には段落ごとに「聞く所」が書いてあります。

- **数字・単位・記号**：「60 mph to km/h」「√」「π」「20 万桁」「85000 円」「2D」「3D」「=」などを正しく読むか
- **漢字の読み**（日本語）：方程式、積分、厳密、液面、履歴などを正しく読むか
- **文の抑揚**：文の切れ目と終わり方、「……」の間が自然か
- 枠に入るか：段落の長さが、動画のその場面に入らないときは「枠に入らない」と出ます
- 作った時間と GPU のメモリ：段落ごとの値です（全部を作るときの時間の見当になります）

読み方がおかしい言葉は、`store/tools/tts-readings.json` に書くと直せます（字幕は変わりません）。全部のエンジンに効く書き方と、1 つのエンジンだけに効く書き方があります。

```json
{"ja": [["√", "ルート"]], "qwen3:ja": [["π", "パイ"]]}
```

書いたら、同じ `sample` のコマンドをもう一度実行します。読み方が変わった段落だけが作り直されます。

## 7. 声を決めて、全部を作る

言語ごとに、エンジンと声を決めます（言語ごとに別のエンジン・別の声でかまいません）。例：日本語は Irodori の女性、ほかの言語は Qwen3 の女性。

決めたら、その組み合わせを `--use` に書いて、エンジンの環境ごとに同じコマンドを実行します。その環境のエンジンの言語だけが作られ、ほかは「its own environment」と出て飛ばされます。

Irodori の環境で（日本語）：

```sh
cd ~/Irodori-TTS
uv run --no-sync python ~/qcalc-tts/store/tools/tts_engines.py all ~/qcalc-voice --use qwen3:female,ja=irodori:female
```

Qwen3 の環境で（ほかの 6 言語。GTX 1650 なら `--qwen-size 0.6b` を足します）：

```sh
source ~/tts-qwen3/bin/activate
cd ~/qcalc-tts
python store/tools/tts_engines.py all ~/qcalc-voice --use qwen3:female,ja=irodori:female
```

- **時間：** 1 段落あたりの時間は、サンプルの一覧の「作った時間」が目安です（7 言語で約 175 段落）。
- **途中で止めたとき（Ctrl + C）：** 同じコマンドで続きから作ります。
- **終わると：** 言語ごとに `~/qcalc-voice/voice-tts-ja.zip` のような zip ができます。
- **おかしい段落：** 「check ja:7 …」と出た段落を聞いて、おかしければ `--redo ja:7` を足して同じコマンドを実行します（別の seed で作り直します）。「long ja:7 …」は、速く読んでも場面に入らない段落です。そのまま Claude に伝えてください。

できた `voice-tts-<言語>.zip` を Claude のチャットに添付します。zip には、音声と、どの音声がどの動画のどの場面かの記録（manifest.json）と、声の見本が入っています。

## 8. うまくいかないとき

- **`torch.cuda.is_available()` が False：** `nvidia-smi` の CUDA Version が、入れた PyTorch（cu124 など）より古いことが多いです。1 のドライバーの更新をしてから、環境を作り直します。
- **CUDA out of memory：** ほかのアプリを閉じます。Qwen3 は `--qwen-size 0.6b`、Irodori は int8 の版、それでもだめなら `--device cpu` にします。
- **「Ming computes in bf16 …」と出る：** GTX 1650 では GPU で動きません。`--device cpu` か、RTX 4060 のパソコンで動かします。
- **モデルのダウンロードが止まる：** もう一度同じコマンドを実行すると、続きから取ってきます。ディスクの空きも確かめます（`df -h ~`）。
- **同じ声をもう一度作りたい：** 声の説明文と seed は `store/tools/tts-voices.json` にあり、作った見本は `~/qcalc-voice/tts/voices/` にあります（見本の録音も保存しておいてください。パソコンや精度が違うと、同じ seed でも少し違う声になることがあります）。
- **声を変えたい：** `tts-voices.json` の説明文を変えて `design ... --redesign`。英語の訛りが日本語に出るときは、そのエンジンの声の `anchor_lang` を `"ja"` にして作り直すと良くなることがあります（見本を日本語で作り、その声でほかの言語も読みます）。
- **何がおかしいか分からない：** 端末の表示をそのまま Claude に貼ってください。

## 9. Windows のパソコン（RTX 4060）で作るとき

いちばん簡単なのは、Windows の中で Ubuntu を動かす WSL2 です。NVIDIA のドライバーは Windows 側のものだけで GPU が使えます（Ubuntu の中にドライバーは入れません）。

1. PowerShell を「管理者として実行」で開いて、次を実行し、再起動します。

   ```powershell
   wsl --install -d Ubuntu-24.04
   ```

2. スタートメニューから「Ubuntu 24.04」を開き、ユーザー名とパスワードを決めます。
3. Ubuntu の中で `nvidia-smi` を実行して、RTX 4060 が見えることを確かめます。見えないときは、Windows の NVIDIA のドライバーを新しくします。
4. あとは、この手順の 1〜8 を Ubuntu の中でそのまま実行します（「sudo ubuntu-drivers install」は WSL2 では実行しません）。
5. できたファイルは、Windows のエクスプローラーのアドレス欄に `\\wsl$\Ubuntu-24.04\home\ユーザー名\qcalc-voice` と入れると見られます。

WSL2 を使わずに Windows で直接動かすこともできます（Qwen3 と Irodori。Ming は pynini が Windows では入りにくいので WSL2 にしてください）。PowerShell で：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
git clone --depth 1 -b feature/tts-engines https://github.com/HiroshiTsu/qcalc.git $HOME\qcalc-tts
uv venv --python 3.12 $HOME\tts-qwen3
& $HOME\tts-qwen3\Scripts\Activate.ps1
uv pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
uv pip install -U qwen-tts
cd $HOME\qcalc-tts
python store\tools\tts_engines.py design $HOME\qcalc-voice --engine qwen3
python store\tools\tts_engines.py sample $HOME\qcalc-voice ja,en,es --engine qwen3
```

Irodori は `git clone https://github.com/Aratako/Irodori-TTS.git $HOME\Irodori-TTS`、`cd $HOME\Irodori-TTS`、`uv sync --extra cu128` のあと、`uv run --no-sync python $HOME\qcalc-tts\store\tools\tts_engines.py sample $HOME\qcalc-voice ja --engine irodori` です。聞き比べの一覧は `$HOME\qcalc-voice\tts\sample\listen.html` をブラウザで開きます。

## 10. 許諾と、守ること

| エンジン | 許諾 | 守ること・知っておくこと |
| --- | --- | --- |
| Qwen3-TTS（Alibaba Qwen） | Apache-2.0（コードとモデル）。商用に使える | モデルやコードを配るときは許諾文を付ける（動画の音声には条件なし）。透かしは入らない |
| Ming-3.0-tts-0.5B（inclusionAI） | MIT（コードとモデル）。商用に使える | モデルカードの注意：同意なしに実在の人になりすまさない、人をだます目的に使わない、本物の録音と間違えられるおそれがある所では合成音声だと表示する |
| Irodori-TTS v4.1-Small（Aratako） | MIT（コードとモデル）。商用に使える | 同意なしに人の声を複製・なりすましに使わない、人を誤解させる音声や偽情報に使わない。プロジェクトで使うときは引用（クレジット）を求めている。生成した音声には SilentCipher の聞こえない透かしが自動で入る（そのまま使う）。v4-Large は Gemma の利用規約なので使わない |
| Chatterbox（Resemble AI） | MIT | 聞こえない電子透かし（PerTh）が入る |

- この道具は、実在の人の声を使いません。声は説明文から作り、その見本（合成の声）で全部を読みます。
- 動画の説明欄に「ナレーションは音声合成です（エンジン名）」と書いておくことを勧めます（Ming の注意に合い、Irodori のクレジットにもなります）。
