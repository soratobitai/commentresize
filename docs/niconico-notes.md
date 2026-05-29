# 開発メモ：ニコ生コメント欄の仕様・挙動

このファイルは、コメント欄まわりの修正・開発で判明したニコ生本体（`live.nicovideo.jp/watch/*`）の
仕様や、本拡張のアーキテクチャ・ハマりどころを記録するもの。コードからは読み取れない「外部の挙動」が中心。

> 注意: ニコ生は予告なく実装を変えるため、ここに書いたセレクタ/挙動は将来変わりうる。
> 修正前に現物で確認すること（記録時点: 2026-05、Edge 148 / nicolib.ef28b11540.js で確認）。

## DOM 構造

- スクロールコンテナ: `[class*="_body_"]`（コメント欄。`scrollTop`/`scrollHeight` はこの要素）。
- その中の `.table`（`___table___...`）: 仮想スクロールの土台。`height` に全コメント分の高さ、
  `padding-top` で表示窓の縦位置を調整する。**直下の子はすべて `.table-row`**（スペーサー用の
  兄弟要素は無い）。
- 行 `.table-row`: `position: static`（通常フロー）。属性 `data-comment-type`(normal 等),
  `data-new-comment`(true/false), `role="row"`。一度に描画されるのは十数行のみ（仮想化）。
- コメント番号: `.comment-number` ／ コメント本文: `.comment-text`
  （番号+本文は `[data-name="detail"]` セル内）。
- 「最新コメントに戻る」ボタン: `[aria-label="最新コメントに戻る"]`
  （上にスクロールし未読がある時に出現）。
- エモーションパネル開閉ボタン: `[aria-label="エモーションパネルの開閉"]`。

## スクロール追従の挙動（重要）

- 新着コメントごとに、ニコ生本体が React の `componentDidUpdate` → `E.scrollToNewBottom`
  （nicolib.js）で `el.scrollTop = scrollHeight` を実行して底へ追従する。**メインワールドで動作**
  するため、隔離ワールドのコンテンツスクリプトからは止められない。
- 「底付近とみなす」しきい値は最終コメント 1 行ぶんの高さに連動するらしい。
  **本拡張でコメント文字を拡大すると、このしきい値が ~300px 以上に膨らむ**。その結果、
  通常の上スクロール(100–200px)が「まだ底」と判定され引き戻される
  （= 文字拡大時に上スクロールできないバグの原因）。勢いよく(>しきい値)動かすと解放される。
- プログラム的な `scrollTop` 書き込みは距離に関係なく追従が発動する（純粋に位置ベース）。
  実測: 底から 300px 離れた位置に置いても新着で底へ戻された。
- ユーザーのネイティブ操作（ホイール/スクロールバー）は JS の `scrollTop` セッターを介さない。
  これを利用し、本拡張は「メインワールドで `scrollTop`/`scrollTo` をラップして、ユーザーが
  上スクロール中だけニコ生の引き戻しをブロック」している（`inject.js`）。

## 仮想スクロールの行高さ（rowHeightPx）と余白の根本原因 ★最重要

nicolib.js の解析で判明した、ニコ生コメント欄の仮想スクロールの中核ロジック。

- 仮想スクロールは `calculator`（minified class `b`）が **単一の固定 `rowHeightPx`** で全行を扱う：
  - `scrollHeightPx = rowHeightPx * rowsLength`（全体の高さ）
  - `frameRowLength = ceil(offsetHeightPx / rowHeightPx)`（描画する行数）
  - `marginTopPx = startRowIndex * rowHeightPx` / `marginBottomPx = (残り行数) * rowHeightPx`（padding）
- `rowHeightPx` は **初期化時に最初の1行の `offsetHeight` を1回だけ計測**した値（`initializeCalculator`、
  `if (initialized) return` で再計測しない）。**改行・サイズ変化に追従しない。**
- 底へのスクロールは `scrollToNewBottom`（React `componentDidUpdate` 内）が `target.scrollTop = target.scrollHeight`。
  底判定は `IntersectionObserver`（底のセンチネル `sentinelElement`、`isAtBottomByIO`）。
- **余白バグの原因**: 本拡張で文字を拡大／行高さが変わると、計測済み `rowHeightPx` と実際の行高さがズレる。
  `rowHeightPx` が実際より大きいと `frameRowLength` が小さくなり、描画行数が足りずビューポート下部に余白。
  小さいと逆に過剰描画。実測例: `rowHeightPx=32`（拡張CSSの min-height を空行で計測）に対し実際の行は 100px。
- **1.2.5 のエモーションパネル2回トグルが効いた理由**: トグルでコメント欄が破棄→再生成（リマウント）され、
  `rowHeightPx` が再計測されるため。ただしUIハックで、先頭飛び等の副作用があった（1.2.6 で撤去→余白再発）。

### 根本対策（1.2.11、`inject.js`）
- `.table-row` の React fiber を上方向に辿り、`scrollProcessor.calculator`（`_rowHeightPx` を持つ）に到達。
  （`__reactFiber$...` キー → `fiber.return` を辿る。`stateNode` がコンポーネント実体で `forceUpdateDeep` も持つ）
- `calculator._rowHeightPx` を**実際の行高さ（描画中の行の中央値）に同期**し、変化時に `forceUpdateDeep()`/`forceUpdate()`
  で再描画させる（`syncRowHeight`）。300ms ごと＋リマウント検出時＋「最新コメントに戻る」時に実行。
- fiber/内部名に到達できない（ニコ生更新で minified 名が変わる等）場合は **エモーショントグル（`triggerRelayout`）に
  自動フォールバック**するので退行しない。
- **限界**: 行高さが混在する放送（テキスト42px・スタンプ/画像70px等）は、単一 `rowHeightPx` では完全一致できない
  （niconico の仕様上の制約）。中央値で最善化するが微小なズレは残りうる。テキスト中心なら完全一致で余白ゼロ。
- リマウント（エモーション画面から復帰・タブ切替・SPA遷移）時は、コンテナ差し替えを検出して
  追従ON＋底へ強制追従（`forcePinLoop`, `FORCE_PIN_MS`）し「最新が見えない」を防ぐ。

## コメントの並び順

- ニコ生は、古いコメントの取得時やほぼ同時刻のコメントを、**受信順（コメント番号順でない）で
  DOM に挿入**することがあり、隣接する番号が入れ替わる（例: …1190, **1192, 1191**, 1193…）。
- **拡張 OFF（CSS 除去・並べ替え停止）でも再現する** → ニコ生由来の仕様。本拡張の処理
  （`processComments` はクラス付与のみ）は DOM 並べ替えをしないため原因ではない。
- 表示行は通常フローなので、`.table-row` を番号順に並べ替えれば見た目も直り、再描画後も維持される
  （`sortCommentRows`）。

## 本拡張のアーキテクチャ（1.2.6〜）

- `inject.js`（manifest の `content_scripts` に `"world": "MAIN"`, `run_at: document_start`）:
  **スクロール追従の唯一の担い手**。メインワールドの `scrollTop`/`scrollTo` をラップし、
  ユーザーが上スクロール中はニコ生の引き戻しをブロック、底に戻れば追従再開、追従中は真の底へ pin
  （文字拡大時に最新コメントが見切れるのを防ぐ）。「最新コメントに戻る」クリックで追従再開。
- `main.js`（隔離ワールド）: CSS（文字サイズ・行スタイル）、設定パネル、弾幕判定、
  フルスクリーン制御、コメント番号順の並べ替え（`sortCommentRows`）。
- 隔離ワールドとメインワールドは `Element.prototype` が別オブジェクト。隔離側からの `scrollTo` は
  メイン側の番人ラッパーに掛からない（= 拡張自身のスクロールはブロックされない）。この分離を活用。

## 開発・検証時の注意（ハマりどころ）

- **`--load-extension` 環境では、ページ再読み込みだけではコンテンツスクリプトの変更が反映されない**
  ことがある（古いコードが動き続ける）。編集後はブラウザ（＝拡張）を再起動して確認すること。
- `manifest.json` を変更（content_scripts 追加など）した場合も、拡張の再読み込み（ブラウザ再起動）
  が必要。
- Playwright の合成ホイール（`page.mouse.wheel`）はこのページで発火しないことがある。実機のホイール
  操作が必要。テストで上スクロールを再現するには、別 realm（一時 iframe）の未改変な `scrollTop`
  セッターを呼んでネイティブ相当のスクロールにする（メイン側の番人ゲートを迂回できる）。
- コメント欄は仮想スクロール。`.table-row` の数は十数個だが `scrollHeight` は全コメント分。
  合成した行を注入しても検証にならないので、実際に流れるコメントで確認する。
- 検証用の Playwright ハーネスは `commentresize/e2e/`（リポジトリ外）。CDP `:9222` で接続。
