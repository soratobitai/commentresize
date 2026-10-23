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

### ★スクロール／コメントが固まる現象の原因と対策（重要）
- 症状: まれに（特に**4行以上に折り返した長いコメント**の直後）スクロールも新規コメント描画も止まる。
- 原因（`following` フラグの**ラッチ固着**）: 旧実装は追従ON/OFFを「底から `NEAR_BOTTOM_PX`(8px) 以内か」
  という**位置だけ**で判定していた。長い折り返し行が最後に来ると、ニコ生の底スナップ
  （`scrollTop=scrollHeight`、`rowHeightPx`=最小≒1行ぶんで計算）が、その行の実際のはみ出し分
  （3〜4行＝数十px）だけ**真の底に届かない（undershoot）**。すると `distFromBottom>8` になり
  `setFollowing(false)` でラッチ → 以後ニコ生の底書き込みは番人ゲート（`!following` で `return`）に
  **全ブロック** → スクロール停止 → 底センチネル（IO）が交差せずニコ生が**新規描画も停止** → 固まる。
  直すはずの `pinIfFollowing` は、まさにOFFになったそのフラグでゲートされ動けない自己ロック。
- 対策: **追従OFFは「実際のユーザー入力」があった時だけ**許可する。
  - ニコ生のプログラム的スクロールは `wheel`/`touch`/キーを発火しない。一方 scrollTop の「底の座標」は
    仮想スクロールの再計算で**単調に増えない**ため、増減（方向）だけで判定すると、3〜4行のコメントで
    scrollTop が一時的に小さくなった時に「上スクロール」と誤検知し追従OFFにラッチ → **底まで届かず止まる**
    （※増減で判定する初版の固着対策はこの副作用があり、入力ベースへ差し替えた）。
  - `wheel/touchstart/touchmove/pointerdown/keydown` で `lastUserInputAt` を記録し、scroll イベントでは
    「底付近(`<=NEAR_BOTTOM_PX`)なら追従ON」「`USER_INPUT_MS(300ms)` 以内のユーザー入力があり底でないなら追従OFF」。
    それ以外（底でない＆ユーザー入力なし＝再レイアウト/undershoot）は**追従維持**し、`pinIfFollowing` が
    実際の底（実 `scrollHeight`）へ押し込む。これで誤OFFも固着も底未到達も起きない。

## 仮想スクロールの行高さ（rowHeightPx） ★CDP実機診断で大幅訂正

> ⚠️ 訂正（CDP でライブ配信を実測して判明。以下の旧記述に優先する。検証: `e2e/{observe,monitor_h1,
> probe_write,repro_rootmargin,repro_scroll,watch_freeze}.mjs`）:
> - **`calculator._rowHeightPx` への書き込みは永続しない**。123 を書いて `forceUpdateDeep` しても ~400ms で
>   niconico が 32 に戻す。→ 旧 `syncRowHeight`（min/median/avg いずれも）は**レイアウトに無効な no-op**。
>   1.2.11〜1.2.13 の min/中央値論争は実は無意味だった。
> - niconico の `rowHeightPx` は実質 **常に 32**。reserved(=32·N) は常に real(`scrollHeight`) より小さく
>   content があふれる＝**下余白は構造的に出ない**（旧「余白＝rowHeightPx が大きすぎ」説は誤り）。
>   ※**2026-06-08 訂正**: これは当該検証配信限定。文字拡大＋折り返しの実利用では niconico 自身が
>   `rowHeightPx` を高く確定する（実機キャプチャで **62**、`scrollHeight=62*186`）。その時 `frame=ceil(460/62)=8`
>   で末尾窓が under-fill し**下余白は出る**。詳細は下記「下余白（ボトムブランク）」節（実機確定）。
> - **追従は sentinel/IntersectionObserver ではなく位置ベース**（`_fixedBottom`／`scrollTop≈scrollHeight`）。
>   フォント特大で `real−reserved=−16,785px`・sentinel が画面外でも `isAtBottomByIO`/`_fixedBottom` は true の
>   まま追従継続（`rootMargin:"0px"` でも）。→「sentinel を通り越し IO=false で固まる」説(H1)は**実機で否定**。
> - 旧 `syncRowHeight` の唯一の実害＝**行が高いコメントの時だけ 300ms 毎に `forceUpdateDeep` を撃つ churn**
>   （短いコメントは `|32−minRowH|<6` で不発）。これが 4 行コメント／バーストでの固まりの最有力容疑のため
>   **1.2.14 で撤去**（以後 `forceUpdate` 系は使わない）。代わりに「直前まで流れていたのに追従中・最下部で
>   描画停止」を検出する `freezeWatch`（記録＋niconico 自身の `scrollToNewBottom`＋pin で自己回復）を追加。
> - 確認済み API: `scrollProcessor.{isAtBottomByIO, sentinelElement, observer, setupObserver,
>   scrollToNewBottom, setFixedBottom}`, `calculator.{_rowHeightPx, _rowsLength, _offsetHeightPx, _fixedBottom,
>   scrollToBottom, calculateScrollTopForRow}`, `comp.{forceUpdate, forceUpdateDeep}`。`rowsLength` は ~200 で頭打ち
>   （ローリングウィンドウ）。
> - 注意: 上記は CDP 実機で再現できた範囲。**固まりそのものはこの開発環境では再現できず**（passive 追従／
>   forceUpdate 連打／特大フォント／スクロール上げ下げのいずれも固まらない）、ユーザー環境固有のトリガーが
>   残る可能性あり。`window.__crFreeze` に最後の検出状態が入る。

> ⚠️ 訂正2（実機 `window.__crFreeze` キャプチャの多視点＋反証検証。記録: 2026-06-07）:
> 実機キャプチャ例 `{stalledMs:2696, distFromBottom:0, scrollTop:6646, scrollHeight:7106, clientHeight:460,
> rowHeightPx:32, rowsLength:200, fixedBottom:true, isAtBottomByIO:true}` を 3 視点で分析→2 名で反証した結果:
> - **「scrollTop が仮想座標系(rowHeightPx*rowsLength=6400)をはみ出し startRowIndex=floor(6646/32)=207>rowsLength
>   で描画ウィンドウが行範囲外になり描画が止まる」仮説は否定された**。決定的反証: (a) `scrollHeight(7106)` は
>   仮想高さ(6400)を**上回る**＝行は十分にマテリアライズされた背の高いリスト＝「空ウィンドウ」の正反対
>   （空なら scrollHeight は padding だけの ~6400 以下に縮むはず）。(b) 過去のフォント1000%テストで
>   実−仮想=−16,785px（24倍の赤字）でも固まらなかった＝8行のはみ出しでは説明不能。(c) `startRowIndex` は
>   一度も実測しておらず式からの推測。(d) ニコ生がクランプ(`[0,rowsLength-frame]`)していれば最新行は常に窓内。
> - **`freezeWatch` の発火条件はゆるい**（直近8秒で3進捗＋2500ms停止）。バースト直後の2.7秒の無風でも満たすため、
>   このキャプチャ自体が「無風/一過性のリフロー」を固まりと誤検出した可能性も排除できない。
> - **結論: 8項目スナップショットだけでは機構を特定できない**。1.2.15 で次の実機固まり用に決定的項目を追加記録:
>   `tableRowCount`(~15=正常な仮想窓)／`newestInDom`(窓が古い行に留まるか)／`marginTopPx`・`tableHeightPx`・
>   `scrollHeightPxVirtual` vs 実 `scrollHeight`／`outOfRange`／`following`／`clearedAfterMs`(一過性か本物か)。
>   回復は**範囲外の時だけ**範囲内へ一度ナッジし `advancedAfterNudge`(描画再開したか)を記録＝回復処理を実験化。
>   書き込みは `selfScrollWrite` でゲートを迂回（`following=false` 飲み込みによる自己ロックを恒久的に防止）。
> - 次アクション: 実機で `window.__crFreeze`(と `window.__crFreezes`) を採取し、`outOfRange`/`tableRowCount`/
>   `advancedAfterNudge`/`clearedAfterMs` で機構を確定 → 確定後に恒久修正を 1.2.16 で入れる。

> ✅ 機構確定（1.2.15 実機キャプチャ3件＋ユーザー証言。記録: 2026-06-07）— **固まり＝「スクロール操作で
> 目覚める描画停止」**。座標バグではない:
> - 実測 `{scrollTop:6401, scrollHeight:6861, clientHeight:460, rowHeightPx:32, rowsLength:200,
>   tableRowCount:15, marginTopPx:5920, newestInDom:31770→31860→32161, outOfRange:true, clearedAfterMs:~300}`。
> - **`tableRowCount:15`＋`marginTopPx:5920(=185*32)`＝ニコ生は `startRowIndex` を 185 にクランプし末尾15行
>   （最新含む）を正常描画**。`newestInDom` もキャプチャ間で前進＝行範囲外/空ウィンドウ説は実測で完全否定。
>   `outOfRange:true`（scrollTop>仮想底5920）は**無害な見かけだけ**。→ ワークフロー設計案の「pin を範囲内へ
>   クランプ」修正は最新を切るだけで無意味と判明（測ってから直して正解）。
> - **正体は時間的な描画停止**: 背の高い折り返しコメント直後にニコ生の描画が止まり、新着データだけでは
>   再開せず「**スクロール操作を与えるまで固まったまま**」（ユーザー証言:「一度止まると操作するまで戻らない」）。
>   ユーザーが手動スクロールで復帰していたのはこのため。
> - **回復の有効成分＝スクロール運動**: 1.2.14（`scrollToNewBottom`+pin、運動なし）は回復せず、1.2.15 で
>   底→上(5460)→底 の programmatic なスクロール運動を入れて**初めて自動回復**（ユーザー:「回復したのは初めて／
>   以前より明確に良くなった」）。`advancedAfterNudge:false` は計測が早すぎ(2フレーム)ただけで、`clearedAfterMs:~300`
>   が実際の回復を示す（回復は検出後~300msで起きる）。
> - **1.2.16 で確定修正**: 回復を「outOfRange に関係なく」スクロール運動（底→上→底）で発火するよう一般化。
>   1.2.15 の弱点だった (a)outOfRange ゲート (b)ナッジ直後の `scrollToNewBottom` による計測汚染 を解消。
>   `selfScrollWrite` で全書き込みがゲートを迂回（`following=false` 飲み込みの自己ロックを恒久防止）。
> - **未解明（実害は回復済み）**: 描画停止そのものの内部原因（IO/スクロール駆動の描画フラッシュが背の高い行で
>   詰まる等）は未特定だが、スクロール運動で確実に起こせるため実用上は解決。

> 🎯 1.2.17 — 「見切れゼロのまま体感停止をなくす」方針（ユーザー要望「止まってほしくない／見切れも困る」）:
> - **位置クランプ（scrollTop をニコ生の仮想底 maxInRangeTop まで下げる）は不採用**。実コンテンツは仮想底の
>   数百px下にあるため、クランプすると最新コメントが**画面外に隠れる**（見切れどころか見えない）＝逆効果。
> - 採用: **位置は実際の底のまま（最新フル表示）**、固まりやすい `outOfRange` の時だけ検出を素早くして
>   （しきい値 `outOfRange?400:2500`ms、ポーリング 300→**200ms**、回復スロットル 1500→**400ms**）
>   1.2.15/1.2.16 で確定した**同期スクロール運動**（底→上→底を1ティック内で完結＝画面は動いて見えない）で
>   即回復。これで見切れゼロ・体感停止ほぼ無し（~3s → ≤~0.5s）。
> - 高速ポーリングで毎回 fiber を辿らないよう `getScrollComponent` に2秒キャッシュ（コンテナ差し替え時は
>   `invalidateScrollComp` で破棄）。`window.__crFreezes` は直近40件に制限。
> - 仮説（未確証）: 描画停止のトリガーは「scrollTop が仮想底を超える(outOfRange)と底センチネル/IO が固定され
>   新着で再計算が走らない」こと。だから outOfRange を高速回復の発火条件にしている。さらに詰める場合は、
>   `outOfRange` 中に微小な同期運動を**継続**して撃つ keep-alive（完全無停止狙い、churn 増）も可能。
>   逆に体感が十分なら据え置き。停止の内部機構の確定には、固まり中の「モデル最新番号 vs DOM最新番号」採取が必要。

> 🚀 1.2.18 — keep-alive（固まりを起こさせない）。ユーザー要望「0.5秒も嫌、完全に止めたくない」:
> - `outOfRange`・追従・最下部・非操作（`lastUserInputAt` から `USER_INPUT_MS` 経過）の間だけ、`requestAnimationFrame`
>   ループ（~33Hz 上限）で描画進捗（`renderSignature`）を見張り、**~60ms 進まなければ見えない同期スクロール
>   パルス（底→上→底を1ティック完結＝画面は動かない）**で再計算を起こす。新着が常に即描画され続け、止まる隙を
>   与えない（~3s → 0）。スムーズに流れている間（60ms 以内に進捗）はパルスを撃たない＝無駄な負荷なし。
> - 位置は実際の底のまま＝**最新フル表示・見切れゼロ**。`forceUpdate`/`_rowHeightPx` は触らないので 1.2.11 の
>   チカチカ（margin⇄補正の発振）は原理的に起きない（パルスは毎回同じ底位置で完結＝可視状態が変化しない）。
> - 1.2.17 の高速 freezeWatch（`outOfRange?400:2500`ms）は**安全網**として併存。keep-alive が効いていれば
>   `renderSignature` が進み続けるので freezeWatch は発火しない＝`window.__crFreeze` が残ったら keep-alive 失敗の証拠。
> - ユーザー操作（wheel/touch/key）中は keep-alive を止めるので、上スクロールでの履歴閲覧は妨げない。
> - 観察ポイント（実機）: チカチカ／CPU 過負荷／上スクロール阻害が無いか。あれば throttle(30ms)・stale(60ms) を緩める。

> 🔇 1.2.19 — ログ静音化＋無駄パルス間引き（実機で「__crFreeze/scroll-wake のログが連続して出続ける」報告を受けて）:
> - 原因: `freezeWatch`(1.2.17 安全網, しきい値 `outOfRange?400:2500`ms)は「無風（コメントの切れ目）」と「本物の固まり」を
>   区別できず、賑やかな配信でも 0.4s 以上の切れ目ごとに detect+recover を console.warn していた（実害なし＝画面は止まって
>   いない／パルスは空振り、だが煩い＋無駄 CPU）。
> - 対策: (1) 全 console.warn を **`window.__crDebug=true` の時だけ**出すよう静音化（既定オフ）。(2) `freezeWatch` のしきい値を
>   **`outOfRange?1500:4000`ms** に上げ「keep-alive が間に合わなかった長い停止」だけを静かに記録する最終安全網に格下げ。
>   (3) keep-alive は **直近進捗<1500ms なら 100ms / それ以外 600ms** に pulse を間引き（`kaProductiveAt`/`kaLastPulse`）。
>   固まりは「進捗の直後」に起きるので、進捗直後だけ高頻度なら取りこぼさない。体感(止まらない・見切れない)は 1.2.18 と同じ。
> - 学び: `renderSignature`(scrollHeight+最大番号)の静止は「固まり」と「無風」を区別できない（反証パスの指摘どおり）。
>   厳密に区別するには固まり中の「モデル最新番号 vs DOM最新番号」採取が必要（未実施）。今は productive ベースの間引きで近似。

> 🧪 1.2.20 — keep-alive の効果を確認する検証ツール（ユーザー指摘「keep-alive が効いているか未確認／効くなら scroll-wake は不要」）:
> - 重要な認識: keep-alive が速く(100ms)叩くため停止が育つ前に消え、ログだけでは「本物の固まりを防いだ」のか
>   「そもそも固まっていない（切れ目）」のか区別できない。**確認には A/B（keep-alive を切って固まりが戻るか）が必要**。
> - 追加トグル（コンソールで設定）: `window.__crNoKeepAlive=true` で keep-alive 無効化（この時 freezeWatch しきい値は
>   400ms に下がり素早く回復＝固まりが短く見える）。`window.__crNoSafety=true` で freezeWatch の回復も無効化
>   （両方 true＝素のニコ生＝固まりが操作するまで戻らない元の症状を再現）。
> - 追加カウンタ `window.__crStats = { kaPulse, kaRescued, fzFire, lastRescue }`: kaPulse=keep-alive パルス総数、
>   kaRescued=「150ms以上止まった後にパルス→直後に描画が前進」した回数（＝本物の固まりを keep-alive が救った近似値）、
>   fzFire=安全網 freezeWatch が発火した回数（＝keep-alive が取りこぼした回数）。
> - 判定: 賑やか配信で数分視聴し、(A) 通常(keep-alive ON)で `kaRescued>0 かつ fzFire≈0` なら keep-alive が固まりを
>   実際に防いでいる証拠＝scroll-wake は削除可。(B) `__crNoKeepAlive=true` にして固まり（短い引っかかり）が出る/`fzFire` が
>   増えるなら、keep-alive が効いていた裏付け。(C) ON でも `kaRescued=0` のままなら、そもそも固まりが発生していない可能性。
> - 次アクション: A/B 結果しだいで scroll-wake(freezeWatch 回復)を削除して keep-alive 一本化、または keep-alive のパラメータ調整。

以下は nicolib.js の静的解析メモ（歴史的経緯。結論は上記訂正が優先する）。

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

### 行高さ同期は撤去済み（1.2.14）— 現 `inject.js` は `_rowHeightPx` を書かない ⚠️訂正
- **旧実装（撤去済み）**: `.table-row` の React fiber を辿って `scrollProcessor.calculator._rowHeightPx` を実高さへ同期し
  `forceUpdateDeep()`/`forceUpdate()` で再描画（`syncRowHeight`、リマウント時＋「最新に戻る」時＋300ms毎）。
  これは **1.2.14 で撤去**（チカチカ＝自励発振の原因で効果も薄い。本書「rowHeightPx」節・「1.2.11 発振」節参照）。
  `triggerRelayout`（エモーショントグル）フォールバックも同時に廃止。
- **現在**: `inject.js` は fiber 経由で `calculator`（`_rowHeightPx`/`_rowsLength`）を **読むだけ**。`_rowHeightPx` への
  書き込みや `forceUpdate*` は一切行わない（`forceUpdate 不使用`）。固まりは keep-alive＋freezeWatch の同期スクロール
  パルス（底→上→底）で対処する。`syncRowHeight`/`triggerRelayout` は現コードに存在しない。
- リマウント（エモーション画面から復帰・タブ切替・SPA遷移）時は、コンテナ差し替えを検出して
  追従ON＋底へ強制追従（`forcePinLoop`, `FORCE_PIN_MS`）し「最新が見えない」を防ぐ。

#### ★1.2.11 が一部環境でチカチカした原因と、その後の発振対策（重要）
- **発振の正体**: 1.2.11 は `_rowHeightPx` に**描画中の行の「中央値」**を書き戻していた。だが中央値は
  『どの行が描画されるか』に依存し、その描画範囲は `frameRowLength = ceil(clientHeight/rowHeightPx)` で
  `rowHeightPx` 自身が決める。＝**測定対象が制御値に依存する自励発振**。さらに変化2px毎に毎回 `forceUpdateDeep`、
  その DOM 変化を `MutationObserver`→`pinToBottom` が拾い増幅。**行高さ混在の放送だけ**中央値が描画窓ごとに揺れて
  収束せず「下余白⇄底補正」を繰り返し**チカチカ**した（テキスト一色なら中央値が動かず無症状＝環境依存の正体）。
- **対策（発振を断つ）**:
  1. 中央値ではなく**最小行高さ（実質1行ぶん、`smallestRowHeight`、下限 `ROW_MIN_FLOOR=24px`）**を使う。
     `rowHeightPx` を実高さ**以下**にすると `frameRowLength` が過剰になり**下余白が出ない**（真の底へは `pinToBottom` が押し込む）。
     最小値は描画範囲が変わっても動きにくく、発振源を断つ。
  2. 値は**下げる方向にのみ追従（単調収束、`lockedRowHeight`）**。フォント拡大時も小さいまま＝余白は出ない
     （代償は描画行数がやや増えるだけ）。
  3. calculator と**6px以上ズレた時だけ** `forceUpdate`（**定常再描画＝フラッシュを廃止**）。収束後は再描画しない。
- **限界**: 行高さ混在（テキスト/スタンプ/画像）を単一 `rowHeightPx` で完全一致はできない（niconico 仕様の制約）。
  最小値固定は「余白を出さない・発振しない」側に倒した設計で、その分わずかに過剰描画になりうる。

## 下余白（ボトムブランク）— 「最新コメントに戻る」後にたまに出る空白

> ✅ **2026-10-23 根本対策済み**（下の「2026-10-23 根本対策」節）。nicolib のソースを読んで計測箇所を特定し、
> MAIN ワールドで計測値そのものを丸める方式に変更。以下の 06-08 までの記述は経緯として残す。

> 🔬 1.2.21 で診断計測（`blankWatch`/`window.__crBlank`）を**一時追加 → 原因確定後に撤去し 1.2.20 へ戻した**
> （知識はこの節に保存。**コードに `window.__crBlank`/`blankWatch` 等はもう無い**）。多視点ワークフローで原因網羅＋修正案を反証検証。

- 症状: 最下部にいるのに**最後のコメントの下に空白**が出る。主に「最新コメントに戻る」直後、たまに。
  開発当初からの既知問題で、固まり修正とは別。文字拡大で行が高いほど出やすい。
- 仮想スクロールの幾何: `.table` は `height=scrollHeightPx(=rowHeightPx*rowsLength)`、`padding-top=marginTopPx`
  （窓より上の行ぶん）、`padding-bottom=marginBottomPx`（窓より下の未描画行ぶんの予約スペース）。
- ✅ **実機キャプチャで原因確定（2026-06-08, `window.__crBlank`/`__crBlanks` 計10件・撤去前に採取）**:
  - **#1（reserved `marginBottomPx` 説）は誤り**: 全10件で `marginBottomPx=0`。空白は「窓より下の予約スペースの露出」では**ない**。
  - **真因＝`rowHeightPx` 過大による「最下窓の under-fill」**: ニコ生の単一 `rowHeightPx` は**この回 62**（32 ではない！
    `scrollHeight=11532=62*186`）。`frame=ceil(460/62)=8` で末尾窓は 8 行しか描かれないが、実行高さは平均 ~47px＝計 **380px**
    しかないのに content box は `frame*rowHeightPx=8*62=496px` 予約 → 差 **116px が最終コメントの下に空白**。
    `scrollTop=scrollHeight` はこの 116px を内包するのでピンでは閉じられない。`blankPx ≈ scrollHeight − lastRowBottomInContentPx`。
  - これは旧「余白＝`rowHeightPx` が大きすぎ」説（CDP 節で『常に32・構造的に出ない』と誤判定したもの）を**部分復権**させる。
    CDP の『常に32』は当該配信限定で、**文字拡大＋折り返しの実利用では niconico 自身が `rowHeightPx` を高く（62）確定**し
    `frame` が小さくなって under-fill する。ただし `_rowHeightPx` 書き込みは ~400ms で revert する（CDP 既出）ので**書いて直す道は不可**。
  - **2集団に分離**: (A) 一過性 catch-up（`newestLag>0`, `isAtBottomByIO=false`, `clearedAfterMs≈30ms`）＝forcePin 中の追いつき点滅・自己解消。
    (B) **定常の本命**（`newestLag=0`, `isAtBottomByIO=true`, `persistentFrames=414/480`, `clearedAfterMs=null`＝固着。**クリック74秒後でも出る ＝forcePin 非依存**）。
  - 付随: 本命サンプルは `outOfRange=true`（`scrollTop>maxInRangeTop`）＝固まりと同じ `rowHeightPx` 過大ファミリの別症状。
- 🔑 **116px の内訳（決定的な精緻化）と「解消不能」の結論**:
  - `116px = 80px（構造的 under-fill）＋ 36px（オーバースクロール）`。
    - **80px ＝ ビューポート不足**: `clientHeight 460` に対し描画行は `8行 × ~47px ≈ 380px`。**ビューポートを埋めるには約2行足りない**。
      この80pxは「**行をもっと描く**」以外で消せず、それには `rowHeightPx` を下げて `frame` を増やすしかない＝**~400msでrevertする死路**。
    - **36px ＝ オーバースクロール**: `scrollTop(11072) − maxInRangeTop(11036)`。安全に削れるのはこの分だけ（116→80）。
  - 検討した5案はすべて却下（多視点ワークフロー、最高スコア **3.5/10**）:
    - **scroll-up / pin を `lastRowBottomInContentPx` へ**: scrollTop を上へ動かすのと幾何的に等価。窓固定なら80pxが**上へ移るだけ**、窓が動けば**最新を消す**。
    - **render-more-rows**: 増えるのは最新より**上（古い行）**。`scrollHeight` は仮想定数で `lastRowBottom` 不変＝**空白不変**（むしろ slack 増）。
    - **rowHeightPx one-shot**: ~400ms revert → 1.2.14 churn＋1.2.11 自励発振の再来、`forceUpdate` 復活（封印済み）。
    - **container-compensation（負マージンで `scrollHeight` 圧縮）**: ブラウザが scrollTop を上へクランプ＝scroll-up と等価で**80pxを上へ移すだけ**。
      しかも行への負マージンは `.table` の明示高さを変えず **no-op**、`.table` 直書きは React revert。
    - **partial trim（36pxのみ）**: 唯一安全だが 116→80 の部分緩和で 80px は残る＝割に合わない。
  - ⛳ **最終結論＝ニコ生仮想スクロールの構造的制約として受容**: 80px は「最下窓がビューポートを約2行ぶん埋めきれない」不足で、
    `rowHeightPx` 書き換え（revert）なしには消せない。残る36pxのために React/keep-alive と毎フレーム競合する新コード路を足す価値は無い。
    → **1.2.21 診断を撤去し 1.2.20 を据え置き**（推測修正を避ける＝ここでは「直さない」が正解）。

### 2026-06-08 追記：エモーション・トグル復活を実機CDPで再評価＋実装（1.2.22 で既定ON）
上の「受容」は**ページ側の幾何トリック**に対する結論。ユーザー実体験「『最新に戻る』後にエモーションボタン2回押しで余白が消えた」を受け、別レバー（**ニコ生自身に再計測させる**）を実機 CDP（`e2e/`, Edge を起動して live /watch/ に接続）で検証した:
- ✅ **エモーション・トグル＝本物のリマウント**: `_body_`/`calculator`/`sentinelElement` の identity が全て入れ替わり、トグル中は `_body_` が一瞬 DOM から消える（破棄→再生成）。**`forcePin` が先頭飛びをフレーム0から吸収**（`distFromBottom=0`・`follow=1` 維持を実測）＝1.2.6 の撤去理由は今の基盤では解消。
- ✅ **点滅ゼロの「その場再計測」は不在**: `calculator` のメンバは `_rowHeightPx/_bufferSize/_rowsLength/_scrollTopPx/_offsetHeightPx/_fixedBottom/updateScrollTopPx/scrollToBottom/calculateScrollTopForRow`、bool は `_fixedBottom` のみ。**measure/initialized 系は無い**＝rowHeightPx はコンポーネントが**マウント時に1回測る**。**再計測にはリマウントが要る＝エモーション・トグルが唯一のレバー**（候補 C1 は消滅）。
- ⚠️→✅ **当初このビルドで余白を作れなかった**（niconico は `rowHeightPx=32` を測り、フォント 50%→300% でも 32 のまま＝over-fill で余白なし＝元の「常に32」所見と一致）が、**後にリロードや「上スクロール＋最新復帰」の繰り返しで自然に再現**。niconico が**マウント時に背の高い行を測ると `rowHeightPx` が膨張**（実測で 62/65/74/99/165）→ frame 過小で余白。`rowHeightPx` 過大は**実セッション固有＝どの行をマウント時に測るか**で出る（固まり同様）。
- ✅ **実装＝既定ON `inject.js` `blankFixWatch`/`emotionRemount`（実機実証済み・1.2.22）**: 「最下部・操作なし・`rowHeightPx>36`（軽量プレ判定で既定フォントの常時 rect 計測を省く）・`rowHeightPx>実行平均×1.15`・余白>60px が ~600ms 定常」の時だけ、**リマウントボタンを2回トグルして1回リマウント**（クールダウン3s＝`REVIVE_COOLDOWN_MS`）→ niconico がマウント時に rowHeightPx を素の32へ測り直し→frame 増→余白解消。先頭飛びは forcePin 吸収、開閉アニメは一時 `transition:none` 抑制（実機でチラつき体感なし）、入力中スキップ。**リマウントボタン**: `[aria-label="エモーションパネルの開閉"]` → 無ければ `[aria-label="ギフト"]`（放送設定でエモーションOFF時の代替。実機でギフトのトグルもリマウント確認）。両方無ければ no-op（無害）。**無効化** `window.__crNoReviveBlank=true`。記録 `window.__crBlankFix={rowHeightBefore/After,blankBefore/After,rowHeightAt1500/blankAt1500,method:'emotion'|'gift'}`・`window.__crStats.blankFix`。**実機検証(2026-06-08)**: 自然余白で `rowHeightBefore65→After32 / blank176→0 / +1.5s維持 / 発火1回`、自動発火で余白解消をユーザー確認＝採用（上の「受容」結論は本機能で上書き）。
- 🛡 **出荷前レビューで追加した安全策**: ①**効果判定バックオフ**＝発火+1.5sで `rowHeightPx>36`（=効かなかった）or ボタン不在なら失敗カウント、`REVIVE_MAX_FAILS=2` で停止（効かない配信での無限リマウント防止）。ニコ生由来の新規マウント（SPA遷移/エモーション復帰＝自分のリマウント以外）で `reviveFailStreak` をリセット＝再アーム。②**非表示タブで停止**（`document.hidden`）。③**rAF飢餓ウォッチドッグ**＝背景化で rAF が止まっても2s後に `emoBusy`/`transition:none` を確実に解放。④**フォーカスは閉じクリック直後に復元**。⑤パネル開き中は `_body_` が消えるので blankFixWatch は `!el` で発火不可＝開いたパネルを誤トグルしない。
- ⏱ **レイテンシ短縮**: forcePin 抑止を撤去＋`REVIVE_SETTLE_MS 600→100`＋`forcePinLoop` の毎フレームから高速検知（rect は50ms throttle）＝余白出現から **約2s→約0.3s** で回復。

### 2026-10-23 根本対策：行高さの計測値を丸める（`inject.js` `clampRowHeightGetter`）
nicolib（確認時 `nicolib.8b63309f86.js` / `pc-watch.8e5f9be6.js`）のソースを直接読んで、`rowHeightPx` の出どころを特定した:
- **計算器（minified `class b`）**: 全行を単一の `_rowHeightPx` で扱う。`scrollHeightPx=rowHeightPx*rowsLength`、
  `frameRowLength=ceil(offsetHeight/rowHeightPx)`、`bufferRowLength=ceil(frame*bufferSize)`、`startRowIndex=floor(scrollTop/rowHeightPx)−buffer`、
  `.table` の style は `paddingTop=startRowIndex*rowHeightPx`・`height=totalHeightPx−paddingTop`。
- **計測は「1行だけ」の DOM 高さ**（2か所）:
  1. `initializeCalculator`: **行 index 0** の ref（`onMount`、未初期化の時だけ）で `e.offsetHeight`。
  2. `updateCalculator`（`forceUpdateLayout` から）: **先頭に描画中の行**（`body.firstChild.firstChild`）の `clientHeight` で
     `scrollProcessor.initialize` → **calculator を `new b` で作り直す**。
- **`forceUpdateLayout` の呼び出し元**（pc-watch）: `resetPosition`＝100ms 後に `forceUpdateLayout()`＋`setScrollBottom(0)`。
  `resetPosition` は **「最新コメントに戻る」（indicator の onClick）／コメントタブへの切替／コメント0件からの復帰** で呼ばれる。
  → 上スクロール中、画面の先頭行がたまたま背の高いコメントの時に「最新に戻る」を押すと、その行の高さが全行の高さになる＝
  これまでの「`rowHeightPx` 膨張（62/65/74/99/165）」と「上スクロール＋最新復帰の反復で再現」の正体。
- **ページ読込直後が 32 になる理由**: 初回マウント時は main.js の CSS がまだ入っていない（最初の行の 500ms 後に適用）ので
  ニコ生本来の 32px 行を測る。
- **余白の式**: 描画窓の各行について `Σ(rowHeightPx − 実際の行高さ)`。正なら最下部では最新コメントの下に、履歴閲覧中は
  描画行の下（ビューポート下部）に余白が出る。`rowHeightPx ≤ どの行の高さ` なら描画は常に足りる側で、余白は出ない。
- **以前の「`_rowHeightPx` 書き込みは ~400ms で revert」**は、calculator が `updateCalculator` 等で作り直されたためと見られる
  （どの呼び出しだったかは未確認）。インスタンスへの書き込みは作り直しで消えるが、**計測元の DOM 読み取りは MAIN ワールドで制御できる**。
- **対策**: `HTMLElement.prototype.offsetHeight` と `Element.prototype.clientHeight` の getter をラップし、`.table-row` の値だけ
  `min(実測, 32)` を返す（`ROW_FLOOR_PX=32`＝main.js の `.table-row { min-height: 32px }`）。拡張 CSS 下ではどの行も 32px 以上なので
  `rowHeightPx ≤ 全行の高さ` が常に成り立つ＝ページ読込直後の通常状態が常に保たれる。`getBoundingClientRect`・`.table-row` 以外・
  隔離ワールド（main.js）は影響なし。OFF 中（`data-cr-enabled="0"`）は丸めない。
- **実機の証拠**（250%＋折り返しON、`e2e/probe_blank_hook.mjs` でフックを実行時に着脱して A/B）:
  - フックなし: 先頭行193px で再計測 → `rowHeightPx 193`・最下部の余白 **359px**。先頭行229px → `229`・**503px**、
    履歴閲覧中 **24/24 位置で余白（最大512px）**。
  - フックあり: 同じ操作で `rowHeightPx 32`・余白 **0**、履歴 **0/24**。
  - 実装後（`e2e/verify_blank_fix.mjs`）: 先頭行157pxで `forceUpdateLayout` → 32・余白0・履歴0/24。**本物の「最新コメントに戻る」クリック**
    でも 32・0・0/24。ギフト・トグルのリマウント（新しい calculator を確認）でも 32。実高さ105pxの行は `offsetHeight/clientHeight=32`、
    コメント欄自体は実値（556）のまま。`verify_toggle.mjs` 9/9。
- **トレードオフ**: `rowHeightPx(32) < 実際の行高さ` なので描画行数が多め（frame＋buffer で数十行）になり、履歴スクロールの位置と行の対応は
  32px/行で近似される。ただしこれはページ読込直後（ふだん）の状態と同じで、新たに生じるものではない。
- 1.2.22 の `blankFixWatch`/`emotionRemount` は `rowHeightPx>36` でしか動かないため、このフックが効いている間は発火しない。
  ニコ生が計測方法（例: `getBoundingClientRect`）を変えてフックが外れた時の予備として残している。
- 残る余白: 高速スクロール中の描画遅れによる一瞬の空白は仮想スクロール自体の性質。描画停止（固まり）は keep-alive が担当。

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
- **設定パネルの有効/無効は `<html data-cr-enabled="0|1">` で inject.js へ伝える**（メインワールドは
  `chrome.storage` を読めない。DOM は両ワールド共有）。`main.js` が設定読み込み時とトグル時に書き、
  inject.js は `'0'` の間ゲート/pin/keep-alive/freezeWatch/blankFix をすべて止める（未設定＝有効扱い）。
  `following` の追跡だけは続け、再有効化時は追従中なら `forcePinLoop` で底へ収束させる（強制追従中は
  上スクロールが引き戻されるので、窓は 400ms と短め）。
  ※1.2.22 以前はこの受け渡しが無く、OFF にしても inject.js は動き続けていた。検証: `e2e/verify_toggle.mjs`。

## 開発・検証時の注意（ハマりどころ）

- **`--load-extension` 環境では、ページ再読み込みだけではコンテンツスクリプトの変更が反映されない**
  ことがある（古いコードが動き続ける）。編集後はブラウザ（＝拡張）を再起動して確認すること。
- `manifest.json` を変更（content_scripts 追加など）した場合も、拡張の再読み込み（ブラウザ再起動）
  が必要。
- Playwright の合成ホイール（`page.mouse.wheel`）はこのページで発火しないことがある。実機のホイール
  操作が必要。テストで上スクロールを再現するには、別 realm（一時 iframe）の未改変な `scrollTop`
  セッターを呼んでネイティブ相当のスクロールにする（メイン側の番人ゲートを迂回できる）。
- `launch.mjs` で起動した Edge は描画が ~30fps に絞られ、**ときどき ~1s フレームが止まる**。scroll イベントは
  フレームで配送されるため、合成 wheel から `USER_INPUT_MS`(300ms) 以上遅れて届き「ユーザー操作でない」と
  判定されうる（実機のホイールは同一フレームなので起きない）。テストで上スクロールを再現する時は、
  inject.js が scroll イベントを受け取るまで wheel を送り続ける（`verify_toggle.mjs` の `userScrollUp`）。
- コメント欄は仮想スクロール。`.table-row` の数は十数個だが `scrollHeight` は全コメント分。
  合成した行を注入しても検証にならないので、実際に流れるコメントで確認する。
- 検証用の Playwright ハーネスは `commentresize/e2e/`（リポジトリ外）。CDP `:9222` で接続。
