# ナレーションを Qwen3-TTS で作る（RTX 4060 のパソコン、Windows・Ubuntu）

QCalc の動画のナレーションを、Qwen3-TTS だけで作る手順です（2026-11-22 に決めました。Ming と Irodori は使いません）。

1. 準備をする（最初の 1 回だけ）
2. 声を作る（女性と男性の 2 つ）
3. サンプルを作る（日本語・英語・スペイン語）
4. 聞いて、女性か男性かを決める
5. 決めた声で全部を作る
6. 言語ごとの zip を Claude のチャットに添付する

- 道具は `store/tools/tts_engines.py`（ブランチ `feature/tts-engines`）です。ほかのエンジンも並べる詳しい手順は `TTS-ENGINES-ja.md` にありますが、この手順には要りません。
- 各段の手順は、**Ubuntu** と **Windows**（PowerShell）に分けて書いてあります。どちらも、そのままコピーして貼れば進みます。
- 作業用のフォルダは、Ubuntu では `~/qcalc-voice`、Windows では `$HOME\qcalc-voice` です。
- RTX 4060（8 GB）では、声を作るモデルも読み上げのモデルも 1.7B を bf16 で GPU に載せます（GPU のメモリは 5〜6 GB の見込み）。
- モデルは、初めて使うときに Hugging Face から自動で取ってきます（2 つで数 GB）。ディスクの空きは 15 GB くらい見ておいてください。

## 1. 最初の準備（1 回だけ）

### Ubuntu

GPU が見えているか確かめます。右上の「CUDA Version」が 12.8 以上なら、そのまま進みます。

```sh
nvidia-smi
```

12.8 より小さいときは、ドライバーを新しくして再起動します。

```sh
sudo ubuntu-drivers install
sudo reboot
```

uv（Python の環境を作る道具）と git を入れ、道具を取ってきます。

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
sudo apt install -y git sox
git clone --depth 1 -b feature/tts-engines https://github.com/HiroshiTsu/qcalc.git ~/qcalc-tts
```

すでに `~/qcalc-tts` があるときは、`git clone` の代わりに次を実行します。

```sh
cd ~/qcalc-tts
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
```

Qwen3-TTS の環境を作ります。

```sh
uv venv --python 3.12 ~/tts-qwen3
source ~/tts-qwen3/bin/activate
uv pip install qwen-tts torch torchaudio --torch-backend cu128
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

最後の行で `True` と `NVIDIA GeForce RTX 4060` が出れば準備ができています。`--torch-backend cu128` を付けると、torch と torchaudio は GPU 用のものが入ります（付けないと GPU を使わない版が入ることがあります）。

前の手順書で `~/tts-qwen3` を作ってあるときは、`uv venv` の行を飛ばして `source` の行から実行します。最後の行で `True` が出れば、その環境をそのまま使えます。

WSL2（Windows の中の Ubuntu）で進めるときも、この Ubuntu の手順のままです。ただし、ドライバーは Windows 側のものを使うので、`sudo ubuntu-drivers install` は実行しません。

### Windows

PowerShell を開きます（「管理者として実行」でなくてかまいません）。GPU が見えているか確かめます。右上の「CUDA Version」が 12.8 以上なら、そのまま進みます。12.8 より小さいとき、またはコマンドが見つからないときは、NVIDIA App か NVIDIA のサイトからドライバーを新しくして、再起動します。

```powershell
nvidia-smi
```

git と uv を入れ、PowerShell で環境のスクリプトを動かせるようにします（`Set-ExecutionPolicy` で聞かれたら `Y` を押します）。

```powershell
winget install --id Git.Git -e --source winget
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

ここで PowerShell を一度閉じて、開き直します（git と uv が見つかるようになります）。道具を取ってきて、Qwen3-TTS の環境を作ります。

```powershell
git clone --depth 1 -b feature/tts-engines https://github.com/HiroshiTsu/qcalc.git $HOME\qcalc-tts
uv venv --python 3.12 $HOME\tts-qwen3
& $HOME\tts-qwen3\Scripts\Activate.ps1
uv pip install qwen-tts torch torchaudio --torch-backend cu128
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

最後の行で `True` と `NVIDIA GeForce RTX 4060` が出れば準備ができています。

すでに `$HOME\qcalc-tts` があるときは、`git clone` の代わりに次を実行します。

```powershell
cd $HOME\qcalc-tts
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
```

### 出ても気にしなくてよい表示

- `Warning: flash-attn is not installed` … 入れなくても動きます（道具は flash-attn を使いません。Windows では入りません）。
- `SoX could not be found!` … Qwen3 の読み上げには使いません。
- Windows で、Hugging Face のキャッシュが「symlinks」を使えないという警告 … ディスクを少し多く使うだけです。

## 2. 端末を開くたびに

### Ubuntu

```sh
source ~/tts-qwen3/bin/activate
cd ~/qcalc-tts
```

### Windows

```powershell
& $HOME\tts-qwen3\Scripts\Activate.ps1
cd $HOME\qcalc-tts
$env:PYTHONUTF8 = "1"
```

（`PYTHONUTF8` は、韓国語や中国語の文を表示するときに文字のエラーが出ないようにするためのものです。）

## 3. 声を作る（女性と男性、最初の 1 回だけ）

説明文（`store/tools/tts-voices.json`）から、声の短い見本を作ります。この見本の声で、7 言語の全部の段落を読みます。初めてのときは、声を作るモデルを取ってくるので時間がかかります。

### Ubuntu

```sh
python store/tools/tts_engines.py design ~/qcalc-voice --engine qwen3
```

### Windows

```powershell
python store\tools\tts_engines.py design $HOME\qcalc-voice --engine qwen3
```

できた見本は `qcalc-voice/tts/voices/qwen3-female.wav` と `qwen3-male.wav` です。そのまま聞くこともできます。

## 4. サンプルを作る（日本語・英語・スペイン語）

数字・単位・記号のある段落を、女性と男性の声で作ります。初めてのときは、読み上げのモデルを取ってきます。

### Ubuntu

```sh
python store/tools/tts_engines.py sample ~/qcalc-voice ja,en,es --engine qwen3
```

### Windows

```powershell
python store\tools\tts_engines.py sample $HOME\qcalc-voice ja,en,es --engine qwen3
```

ほかの 4 言語も聞きたいときは、`ja,en,es` を `ja,en,es,de,fr,ko,zh-TW` にします。段落ごとに、作った時間と GPU のメモリが表示されます（全部を作るときの時間の見当になります）。

## 5. 聞いて、女性か男性かを決める

聞き比べの一覧をブラウザで開きます。段落ごとに女性と男性の声が並び、その場で聞けます（前にほかのエンジンでサンプルを作っていたら、それも並びます）。

### Ubuntu

```sh
xdg-open ~/qcalc-voice/tts/sample/listen.html
```

### Windows

```powershell
start $HOME\qcalc-voice\tts\sample\listen.html
```

ファイルは `qcalc-voice/tts/sample/<言語>/` にもあります（例：`ja-qwen3-female-p09-youtube-01.wav` は、日本語・Qwen3・女性・9 番目の段落）。

聞く所：

- **数字・単位・記号**：「60 mph to km/h」「√」「π」「20 万桁」「85000 円」「2D」「3D」「=」などを正しく読むか
- **漢字の読み**（日本語）：方程式、積分、厳密、液面、履歴などを正しく読むか
- **文の抑揚**：文の切れ目と終わり方、「……」の間が自然か
- **枠に入るか**：段落が動画のその場面に入らないときは、一覧に「枠に入らない」と出ます

読み方がおかしい言葉は、`store/tools/tts-readings.json` に書くと直せます（字幕は変わりません）。Qwen3 だけに効かせるときは、`"qwen3:ja"` のように言語の前に `qwen3:` を付けます。

```json
{"qwen3:ja": [["√", "ルート"], ["π", "パイ"]]}
```

書いたら、4 の `sample` のコマンドをもう一度実行します。読み方が変わった段落だけが作り直されます。

声そのものを変えたいときは、`tts-voices.json` の説明文か seed を変えて、`design` のコマンドに `--redesign` を足して作り直し、`sample` をもう一度実行します。英語のなまりは、11 月 22 日から既定になった A（6 の説明）で出なくなります。`tts-readings.json` や `tts-voices.json` を変えたときは、変えた内容を Claude に伝えてください（リポジトリにも入れます）。

## 6. 決めた声で全部を作る

声は女性（`qwen3:female`）に決まりました（11 月 22 日）。7 言語で約 175 段落あるので、先に日本語・英語・スペイン語を作り、そのあとで残りの 4 言語を作ります。

**英語なまりの直し方 A（11 月 22 日に決定、今は既定）**：見本の声からは声の特徴（x-vector）だけを使い、話し方はまねません。見本は英語で作った 1 つの声のままなので、7 言語とも同じ女性の声で、どの言語にも英語の話し方が移りません。コマンドに何も足さなくても A で作ります（`--qwen-clone xvector` と同じ）。

2 の「端末を開くたびに」のあと、まず道具を新しくします（A は 11 月 22 日の版からです）。

### Ubuntu

```sh
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
python store/tools/tts_engines.py all ~/qcalc-voice ja,en,es --use qwen3:female
python store/tools/tts_engines.py all ~/qcalc-voice --use qwen3:female
```

### Windows

```powershell
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
python store\tools\tts_engines.py all $HOME\qcalc-voice ja,en,es --use qwen3:female
python store\tools\tts_engines.py all $HOME\qcalc-voice --use qwen3:female
```

2 行目は 7 言語すべてを指定しますが、1 行目で作った日本語・英語・スペイン語の段落は作り直さず、残りの 4 言語だけを作ります。

- **前に作った音声（英語なまりのもの）**：A の音声はファイル名に `-xvec-` が入る別のファイル（例：`qwen3-female-xvec-youtube-01-….wav`）なので、前の音声を使い回すことはありません。7 言語とも最初から作り直します。前の音声は消さなくてかまいません（zip には A の音声だけが入ります）。声の見本（`tts/voices/qwen3-female.wav`）は前のものをそのまま使います。
- **サンプルで確かめたいとき**：4 の `sample` のコマンドも A で作ります（ファイル名は `ja-qwen3-female-xvec-p09-youtube-01.wav` のように `-xvec-` 付き。聞き比べの一覧には、前のサンプルと並んで「female-xvec」として出ます）。
- **前の作り方（見本の話し方までまねる）に戻すとき**：コマンドに `--qwen-clone icl` を足します。ふだんは使いません。

- **途中で止めたとき（Ctrl + C）**：同じコマンドで続きから作ります。
- **「check ja:7 …」と出たとき**：その段落を聞いて、おかしければ `--redo ja:7` を足して同じコマンドを実行します（別の seed で作り直します）。
- **「long ja:7 …」と出たとき**：速く読んでも場面に入らない段落です。そのまま Claude に伝えてください（文の直し方を考えます）。

### A が効いているか確かめる（11 月 23 日）

11 月 22 日 21:21 から作った A の zip（7 言語）は、音の中身が、前の音声（20:20 に送った、英語なまりのもの）と 1 バイトも違いませんでした（7 言語の 175 段落すべて）。作り直すまえに、このパソコンで A と前の作り方が本当に違う音になるかを確かめます。1 言語に 1 分ほどです。

#### Ubuntu

```sh
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
python store/tools/tts_engines.py clone-check ~/qcalc-voice ja,en --engine qwen3 --voice female
```

#### Windows

```powershell
git fetch --depth 1 origin feature/tts-engines
git checkout -B feature/tts-engines FETCH_HEAD
python store\tools\tts_engines.py clone-check $HOME\qcalc-voice ja,en --engine qwen3 --voice female
```

同じ段落を、同じ seed で、A（`xvector`）と前の作り方（`icl`）の両方で読ませ、`qcalc-voice/tts/clone-check/` に WAV を書きます（聞き比べられます）。表示の見方は次のとおりです。

- **`different audio`**：A はこのパソコンでも別の音になります。それなのに zip の音が前と同じだったのは、A のファイルが A で作られていないということです。次の行の「`N of N audio files of A are the very same audio`」でも確かめられます。その A のファイルを別のフォルダに移してから（消さなくてかまいません）、上の 6 のコマンドで作り直します。

  Ubuntu：

  ```sh
  mkdir -p ~/qcalc-voice/old-xvec && find ~/qcalc-voice/voice-tts -name 'qwen3-female-xvec-*.wav' -exec mv -t ~/qcalc-voice/old-xvec {} +
  ```

  Windows：

  ```powershell
  New-Item -ItemType Directory -Force $HOME\qcalc-voice\old-xvec | Out-Null
  Get-ChildItem -Recurse $HOME\qcalc-voice\voice-tts -Filter 'qwen3-female-xvec-*.wav' | Move-Item -Destination $HOME\qcalc-voice\old-xvec
  ```

- **`the SAME audio both ways`**：このパソコンの Qwen3-TTS では、作り方を変えても音が変わりません。A では英語なまりは直りません。表示をそのまま Claude に貼ってください（`qwen-tts` の版も 1 行目に出ます）。言語ごとの見本で作る B などを考えます。

## 7. zip を添付する

1 つの言語ができるたびに、作業用のフォルダに `voice-tts-<言語>.zip` ができます（`voice-tts-ja.zip`、`voice-tts-en.zip` など）。zip には、音声と、どの音声がどの動画のどの場面かの記録（manifest.json）と、声の見本が入っています。

- Ubuntu：`~/qcalc-voice/voice-tts-ja.zip`
- Windows：`$HOME\qcalc-voice\voice-tts-ja.zip`（エクスプローラーでは、`C:\Users\<ユーザー名>\qcalc-voice`。WSL2 のときは、アドレス欄に `\\wsl$\Ubuntu-24.04\home\<ユーザー名>\qcalc-voice`）

できた言語から、ja → en → es → de・fr・ko・zh-TW の順に、Claude のチャットに添付します。Claude は、届いた言語の動画・字幕・YouTube の説明文・サムネイルのセットを作ります。

## 8. うまくいかないとき

- **`torch.cuda.is_available()` が False**：`nvidia-smi` の CUDA Version が 12.8 より小さいことが多いです。ドライバーを新しくしてから、次で torch を入れ直します（Windows も同じコマンドです）。

  ```sh
  uv pip install --reinstall torch torchaudio --torch-backend cu128
  ```

- **CUDA out of memory**：ブラウザやゲームなど、GPU を使うほかのアプリを閉じて、同じコマンドを実行します。それでも足りないときは、`sample` と `all` のコマンドに `--qwen-size 0.6b` を足します（読み上げを小さいモデルにします。声を作るモデルは 1.7B だけです）。
- **Windows で `Activate.ps1` が「スクリプトの実行が無効」と出る**：1 の `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` を実行してから、開き直します。
- **モデルのダウンロードが止まる**：もう一度同じコマンドを実行すると、続きから取ってきます。ディスクの空きも確かめます。
- **同じ声をもう一度作りたい**：声の説明文と seed は `store/tools/tts-voices.json` にあり、作った見本は `qcalc-voice/tts/voices/` にあります。見本も残しておいてください（パソコンや精度が違うと、同じ seed でも少し違う声になることがあります）。
- **何がおかしいか分からない**：端末の表示をそのまま Claude に貼ってください。

## 9. 許諾と、守ること

Qwen3-TTS（Alibaba Qwen）は、コードもモデルも Apache-2.0 で、商用に使えます。動画の音声には条件はありません（モデルやコードを人に配るときは許諾文を付けます）。透かしは入りません。

この道具は、実在の人の声を使いません。声は説明文から作り、その見本（合成の声）で全部を読みます。動画の説明欄には「ナレーションは音声合成（Qwen3-TTS）です。」と書きます。
