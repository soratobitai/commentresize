// MAIN-world script (runs in the page's own JS context, before niconico's scripts).
//
// Why this exists:
//   niconico auto-scrolls the comment list to the bottom on every new comment
//   (E.scrollToNewBottom in componentDidUpdate). It decides "the user is at the
//   bottom" using a threshold that scales with the last comment's height. This
//   extension enlarges the comment font, so that threshold balloons to ~300px+,
//   and a normal slow scroll-up (100-200px) is treated as "still at the bottom",
//   so niconico yanks the view back down — the user can't scroll up.
//
//   niconico's scroll runs in the page (MAIN) world, so the extension's isolated
//   content script cannot intercept it. This script runs in the MAIN world and
//   gates niconico's PROGRAMMATIC scrolling of the comment container:
//     - While the user is following (at the true bottom): allow it, and keep the
//       view pinned to the TRUE bottom so large comments are never cut off.
//     - While the user has scrolled up: block niconico's snap-back so they can read.
//
//   The user's own wheel/scrollbar scrolling is the browser's NATIVE scrolling and
//   does NOT go through the JS scrollTop setter, so it is never blocked. The
//   extension's own scrolls live on the isolated world's Element.prototype, so they
//   are not affected by the wrapper here either.

(function () {
    'use strict'

    const NEAR_BOTTOM_PX = 8 // これ以下なら「底にいる＝追従」とみなす
    const FORCE_PIN_MS = 1500 // 「最新コメントに戻る」後、この間は追従を外さず底へ貼り付ける
    let following = true     // 底に追従中か（初期は追従）
    let selfScrolling = false // このスクリプト自身による pin 中はゲートを通す
    let forcePinUntil = 0    // この時刻(performance.now)までは強制追従（余白対策）

    const isCommentContainer = (el) =>
        el && el.nodeType === 1 && typeof el.matches === 'function' && el.matches('[class*="_body_"]')

    const distFromBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight

    // ネイティブのアクセサ／メソッドを退避
    const proto = Element.prototype
    const topDesc = Object.getOwnPropertyDescriptor(proto, 'scrollTop')
    const nativeScrollTo = proto.scrollTo

    // 追従状態に関わらずゲート(下の scrollTop セッター)を迂回して書き込む。
    // 回復用の書き込みが following=false でゲートに飲まれて自己ロックするのを防ぐ。
    function selfScrollWrite(el, top) {
        selfScrolling = true
        try { topDesc.set.call(el, top) } finally { selfScrolling = false }
    }

    // 自分（pin）はゲートを迂回して本当の底へ
    function pinToBottom(el) {
        selfScrollWrite(el, el.scrollHeight)
    }

    // scrollTop セッターをラップ：追従していない間、コメント欄への
    // プログラム的な書き込み（=niconico の引き戻し）だけをブロックする
    Object.defineProperty(proto, 'scrollTop', {
        configurable: true,
        enumerable: topDesc.enumerable,
        get() { return topDesc.get.call(this) },
        set(v) {
            if (isCommentContainer(this) && !following && !selfScrolling) return // 引き戻しを無視
            return topDesc.set.call(this, v)
        },
    })

    // scrollTo も同様にゲート
    proto.scrollTo = function (...args) {
        if (isCommentContainer(this) && !following && !selfScrolling) return
        return nativeScrollTo.apply(this, args)
    }

    function setFollowing(v) {
        following = v
        try { document.documentElement.dataset.crFollow = v ? '1' : '0' } catch (_) {}
    }

    // ★追従ON/OFF判定は「実際のユーザー入力」に基づける（固着・底未到達の両対策）。
    //   ニコ生のプログラム的スクロールは wheel/touch/キーを発火しない。一方 scrollTop の
    //   「底の座標」は仮想スクロールの再計算で単調に増えないため、増減（方向）だけでユーザー操作と
    //   ニコ生の再レイアウトを区別すると、3〜4行のコメントで scrollTop が一時的に小さくなった時に
    //   「上スクロール」と誤検知して追従OFFにラッチ→底まで届かず止まる。
    //   そこで「直前に本物のユーザー入力があった時だけ追従OFFを許可」する。
    //   底に届かない undershoot は pinIfFollowing が実際の底へ押し込む。
    const USER_INPUT_MS = 300 // この時間内のユーザー入力を「ユーザー操作中」とみなす
    let lastUserInputAt = -1e9
    const markUserInput = () => { lastUserInputAt = performance.now() }
    for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']) {
        document.addEventListener(type, markUserInput, { capture: true, passive: true })
    }

    document.addEventListener('scroll', (e) => {
        const el = e.target
        if (!isCommentContainer(el)) return
        const now = performance.now()
        // 強制追従ウィンドウ中は、再描画の揺れで追従を外さない（余白＝追従喪失の防止）
        if (now < forcePinUntil) { setFollowing(true); return }
        if (distFromBottom(el) <= NEAR_BOTTOM_PX) {
            setFollowing(true)                                 // 底付近 → 追従再開
        } else if (now - lastUserInputAt < USER_INPUT_MS) {
            setFollowing(false)                                // ユーザー操作で底から離れた → 追従解除
        }
        // 底でない＆ユーザー入力なし＝ニコ生の再レイアウト/undershoot → 追従維持＋実際の底へ補正
        if (following) pinIfFollowing()
    }, { capture: true, passive: true })

    // 「最新コメントに戻る」クリックは、ユーザーが追従再開を望んだ合図。
    // ここで追従ONに戻し、続く niconico の底スクロールをゲートで止めないようにする。
    document.addEventListener('click', (e) => {
        const t = e.target
        if (t && typeof t.closest === 'function' && t.closest('[aria-label="最新コメントに戻る"]')) {
            // 追従ONにし、再描画が落ち着くまで強制的に底へ貼り付ける（先頭飛び・余白対策）
            setFollowing(true)
            forcePinUntil = performance.now() + FORCE_PIN_MS
            forcePinLoop()
        }
    }, { capture: true })

    // 強制追従ウィンドウの間、毎フレーム底へ貼り付けて niconico を底レイアウトへ収束させる
    function forcePinLoop() {
        const el = document.querySelector('[class*="_body_"]')
        if (el) pinToBottom(el)
        if (performance.now() < forcePinUntil) requestAnimationFrame(forcePinLoop)
    }

    // ===== 固まり（フリーズ）の検出と回復（1.2.17）=====
    // 実機 window.__crFreeze の多視点＋反証検証で機構が確定した:
    //  - これは仮想スクロールの座標/描画ウィンドウのバグでは「ない」。実測で tableRowCount=15・
    //    marginTopPx=5920(=185*32) ＝ニコ生は startRowIndex を 185 にクランプし末尾15行（最新含む）を
    //    正常に描画している。outOfRange(scrollTop>仮想底=rowHeightPx*rowsLength) は無害な見かけだけ
    //    （1.2.11–1.2.14 および本実装初期の rowHeightPx／行範囲外の各仮説は全て否定された）。
    //  - 正体は「時間的な描画停止」: 特に背の高い折り返しコメント直後にニコ生の描画が止まり、新着データ
    //    だけでは再開せず「スクロール操作」を与えるまで固まったまま（ユーザーが手動スクロールで復帰して
    //    いたのはこのため）。1.2.14 の scrollToNewBottom+pin（スクロール運動を伴わない）では回復せず、
    //    1.2.15 で底→上→底の programmatic なスクロール運動を入れて初めて自動回復した（実機確認）。
    //  - 回復は「スクロール運動」で描画を起こし底（最新）へ戻す。1ティック内で完結する同期処理なので
    //    画面は動いて見えず、最新コメントの見切れも出ない（位置は実際の底のまま＝フル表示）。
    //  - 1.2.17: 見切れゼロのまま体感停止をなくすため、固まりやすい outOfRange の時だけ検出を素早く
    //    （しきい値 400ms・ポーリング 200ms）して即回復する。位置クランプ（=最新を画面外へ隠す）は不採用。
    //    書き込みは全て selfScrollWrite でゲートを迂回（self-lock 防止）。forceUpdate は不使用。
    //    window.__crFreeze に検出時の決定的項目を記録（tableRowCount/newestInDom/marginTopPx/outOfRange/
    //    following/clearedAfterMs 等）、window.__crFreezes に直近の履歴（最大40件）。

    // .table-row の React fiber を上方向に辿り、scrollProcessor / calculator を持つ
    // コンポーネントインスタンスを返す。毎回探索する（リマウント対応）。
    let _scrollComp = null, _scrollCompAt = -1e9
    function invalidateScrollComp() { _scrollComp = null }
    function getScrollComponent() {
        const now = performance.now()
        // 直近に見つけたインスタンスを再利用（高速ポーリングで毎回 fiber を辿らない）。
        if (_scrollComp && (now - _scrollCompAt) < 2000) {
            const sp = _scrollComp.scrollProcessor
            if (sp && sp.calculator && ('_rowHeightPx' in sp.calculator)) return _scrollComp
        }
        _scrollComp = null
        try {
            const start = document.querySelector('.table-row') || document.querySelector('[class*="_body_"]')
            if (!start) return null
            const fk = Object.keys(start).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
            if (!fk) return null
            let fiber = start[fk], depth = 0
            while (fiber && depth < 200) {
                const sn = fiber.stateNode
                if (sn && typeof sn === 'object' && sn.scrollProcessor && sn.scrollProcessor.calculator
                    && ('_rowHeightPx' in sn.scrollProcessor.calculator)) { _scrollComp = sn; _scrollCompAt = now; return sn }
                fiber = fiber.return; depth++
            }
        } catch (_) {}
        return null
    }

    // DOM 上の最新コメント番号（窓が古い行に留まっているか＝描画ミスの判別に使う）。
    function maxCommentNumber(el) {
        let maxNum = 0
        for (const n of el.querySelectorAll('.comment-number')) {
            const v = parseInt((n.textContent || '').replace(/\D/g, ''), 10)
            if (v > maxNum) maxNum = v
        }
        return maxNum
    }
    // 描画進捗のシグネチャ（底の高さ＋最新コメント番号）。一定時間変わらない＝描画が止まっている。
    function renderSignature(el) {
        return el.scrollHeight + ':' + maxCommentNumber(el)
    }
    // 仮想スクロールの土台 .table の padding-top(=marginTopPx) と高さを読む（診断用）。
    function getTableMetrics(el) {
        let marginTopPx = null, tableHeightPx = null
        try {
            const table = el.querySelector('[class*="___table___"]') || el.firstElementChild
            if (table) {
                const cs = getComputedStyle(table)
                marginTopPx = Math.round(parseFloat(cs.paddingTop) || 0)
                tableHeightPx = Math.round(parseFloat(cs.height) || table.offsetHeight || 0)
            }
        } catch (_) {}
        return { marginTopPx, tableHeightPx }
    }

    let fzSig = '', fzSince = 0, fzAdvances = [], fzLogged = false, fzRecoverAt = -1e9, fzDetectAt = -1e9
    // 「直前までコメントが流れていた（アクティブ）のに、追従中・最下部で描画が止まった」状態だけを
    // 固まりとみなす（静かな配信での誤検出を避ける）。検出時は決定的な項目を記録し、スクロール運動で
    // 描画を起こして自動回復する。
    function freezeWatch() {
        const el = document.querySelector('[class*="_body_"]')
        if (!el) return
        const now = performance.now()
        const sig = renderSignature(el)
        if (sig !== fzSig) {
            // 検出後に描画が再開した＝「いつ解消したか」を記録（一過性の無風か、本物の固まりかの区別）。
            if (fzLogged && fzDetectAt > 0) {
                try { if (window.__crFreeze) window.__crFreeze.clearedAfterMs = Math.round(now - fzDetectAt) } catch (_) {}
            }
            fzSig = sig; fzSince = now; fzAdvances.push(now); fzLogged = false
        }
        fzAdvances = fzAdvances.filter(t => now - t < 8000)
        const wasActive = fzAdvances.length >= 3                 // 直近8秒で複数回進んでいた
        const atBottom = distFromBottom(el) <= NEAR_BOTTOM_PX + 6
        const stalledMs = now - fzSince
        if (!(following && atBottom && wasActive)) return        // アクティブ追従・最下部の時だけ判定

        const comp = getScrollComponent()
        const sp = comp && comp.scrollProcessor
        const calc = sp && sp.calculator
        const rh = (calc && calc._rowHeightPx) || 32
        const rl = (calc && calc._rowsLength) || 0
        const frame = Math.max(1, Math.ceil(el.clientHeight / rh))
        // 仮想スクローラが描画可能な最大 scrollTop（startRowIndex を [0, rowsLength-frame] に収める上限）。
        const maxInRangeTop = rl > 0 ? Math.max(0, (rl - frame) * rh) : (el.scrollHeight - el.clientHeight)
        const realTop = el.scrollTop
        const outOfRange = realTop > maxInRangeTop + 1
        // 描画の維持は下の keep-alive ループが担うので、freezeWatch は「keep-alive が間に合わなかった
        // 長い停止」だけを静かに記録する診断＋最終安全網（console には出さない。window.__crDebug=true で出る）。
        // 普通のコメントの切れ目で誤発火しないよう、しきい値は高め。
        // keep-alive 無効時(A/B検証)は素早く回復して固まりが見えるように、通常は安全網として高め。
        const stallThreshold = outOfRange ? (window.__crNoKeepAlive ? 400 : 1500) : 4000
        if (stalledMs <= stallThreshold) return

        if (!fzLogged) {
            fzLogged = true
            fzDetectAt = now
            try { (window.__crStats = window.__crStats || { kaPulse: 0, kaRescued: 0, fzFire: 0, lastRescue: null }).fzFire++ } catch (_) {}
            const tm = getTableMetrics(el)
            const report = {
                t: new Date().toISOString(), stalledMs: Math.round(stalledMs),
                distFromBottom: Math.round(distFromBottom(el)), scrollTop: Math.round(realTop),
                scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
                rowHeightPx: rh, rowsLength: rl,
                fixedBottom: calc && calc._fixedBottom, isAtBottomByIO: sp && sp.isAtBottomByIO,
                following,
                // ↓ 反証検証で決定的とされた診断項目（次の実機固まりで機構を確定する）
                tableRowCount: el.querySelectorAll('.table-row').length, // ~15=正常な仮想窓
                newestInDom: maxCommentNumber(el),
                marginTopPx: tm.marginTopPx, tableHeightPx: tm.tableHeightPx,
                scrollHeightPxVirtual: rl > 0 ? rh * rl : null,         // 仮想高さ vs 実 scrollHeight
                frameRowLength: frame, startRowIndexApprox: Math.floor(realTop / rh),
                maxInRangeTop: Math.round(maxInRangeTop), outOfRange,
                clearedAfterMs: null, recover: null,
            }
            try { window.__crFreeze = report } catch (_) {}
            try { const a = (window.__crFreezes = window.__crFreezes || []); a.push(report); if (a.length > 40) a.shift() } catch (_) {}
            try { if (window.__crDebug) console.warn('[commentresize] long stall recorded — window.__crFreeze', report) } catch (_) {}
        }

        // 最終安全網の回復（keep-alive が間に合わなかった時だけ）。見えない同期スクロール運動。
        // __crNoSafety=true で無効化可（A/B検証で「素の固まり」を見るため）。
        if (!window.__crNoSafety && now - fzRecoverAt > 400) {
            fzRecoverAt = now
            const before = sig
            const wakeTop = Math.max(0, Math.min(realTop, maxInRangeTop) - el.clientHeight) // 一度上へ
            selfScrollWrite(el, wakeTop)                                                     // scroll/IO を発火＝描画を起こす
            try { if (sp && typeof sp.scrollToNewBottom === 'function') sp.scrollToNewBottom() } catch (_) {}
            selfScrollWrite(el, el.scrollHeight)                                             // 実際の底（最新）へ戻す
            // 回復したか（描画が前進したか）を少し後で記録。clearedAfterMs と併せて確認に使う。
            setTimeout(() => {
                const advanced = renderSignature(el) !== before
                const rec = { t: new Date().toISOString(), outOfRange, wakeTop: Math.round(wakeTop), advancedAfterWake: advanced }
                try { if (window.__crFreeze) window.__crFreeze.recover = rec } catch (_) {}
                try { if (window.__crDebug) console.warn('[commentresize] safety recover advancedAfterWake=' + advanced, rec) } catch (_) {}
            }, 250)
        }
    }

    // 追従中は常に「真の底」へ。文字拡大で niconico のスクロールが底まで届かず
    // 最新コメントが見切れる問題を、ここで吸収する。
    function pinIfFollowing() {
        if (!following) return
        const el = document.querySelector('[class*="_body_"]')
        if (el && distFromBottom(el) > 0) pinToBottom(el)
    }

    // コメント追加・レイアウト変化（フォントサイズ変更など）で底へ追従させる
    let rafId = 0
    const schedulePin = () => {
        if (rafId) return
        rafId = requestAnimationFrame(() => { rafId = 0; pinIfFollowing() })
    }

    let observedEl = null
    const mo = new MutationObserver(schedulePin)
    let ro = null
    if (typeof ResizeObserver === 'function') ro = new ResizeObserver(schedulePin)

    // コメント欄が現れる／差し替わるたびに監視対象を張り替える
    function ensureObserving() {
        const el = document.querySelector('[class*="_body_"]')
        if (el && el !== observedEl) {
            try { mo.disconnect() } catch (_) {}
            try { if (ro) ro.disconnect() } catch (_) {}
            invalidateScrollComp()   // コンテナ差し替え＝古いコンポーネント参照を捨てる
            observedEl = el
            mo.observe(el, { childList: true, subtree: true })
            if (ro) ro.observe(el)
            // コメント欄が新規生成/差し替え（初期表示・エモーション画面から復帰・タブ切替・SPA遷移）された。
            // 最新へ追従し、内容が確定するまで底へ強制追従して「最新が見えない」を防ぐ。
            setFollowing(true)
            forcePinUntil = performance.now() + FORCE_PIN_MS
            forcePinLoop()
            schedulePin()
        }
        // 固まり検出＋穏やかな自己回復（描画が止まった時だけ作動。無害）。
        freezeWatch()
    }
    ensureObserving()
    setInterval(ensureObserving, 200) // 要素差し替え(リマウント)検出＋固まり監視（素早く検出して即回復）

    // ===== keep-alive: 固まりを「起こさせない」（1.2.18 / 1.2.19 で間引き）=====
    // 固まりは outOfRange（背の高いコメントで実際の底がニコ生の仮想底を超える）の時、底センチネル/IO が
    // 固定され、新着が来ても描画の再計算が走らないために起きる（=スクロール操作を与えるまで止まる）。
    // そこで outOfRange・追従・最下部・非操作の間だけ描画の進捗を毎フレーム見張り、~60ms 進まなければ
    // 「見えない同期スクロールパルス（底→上→底を1ティックで完結）」で再計算を起こす。画面は動かず最新も
    // フル表示のまま、新着が常に即描画され続ける＝体感ゼロ停止。スムーズに流れている間はパルスを撃たない。
    // forceUpdate/rowHeightPx は触らないので 1.2.11 のチカチカ（margin⇄補正の発振）は起きない。
    // 1.2.19: 直近に進捗があった間だけ高頻度(100ms)・無風が続けば 600ms に間引き、無駄パルス/CPU を抑える。
    let kaPrevSig = '', kaStaleSince = 0, kaThrottleAt = -1e9, kaProductiveAt = -1e9, kaLastPulse = -1e9
    function keepAliveLoop() {
        requestAnimationFrame(keepAliveLoop)
        const now = performance.now()
        if (now - kaThrottleAt < 30) return                 // ~33Hz 上限（過剰駆動を防ぐ）
        kaThrottleAt = now
        if (window.__crNoKeepAlive) return                  // A/B検証用トグル: keep-alive を無効化
        if (!following) return                              // 追従中だけ
        if (now - lastUserInputAt < USER_INPUT_MS) return   // ユーザー操作中はそっとしておく
        const el = observedEl || document.querySelector('[class*="_body_"]')
        if (!el) return
        if (distFromBottom(el) > NEAR_BOTTOM_PX + 6) return // 最下部の時だけ
        const comp = getScrollComponent()
        const sp = comp && comp.scrollProcessor
        const calc = sp && sp.calculator
        if (!calc) return
        const rh = calc._rowHeightPx || 32
        const rl = calc._rowsLength || 0
        const frame = Math.max(1, Math.ceil(el.clientHeight / rh))
        const maxInRangeTop = rl > 0 ? Math.max(0, (rl - frame) * rh) : (el.scrollHeight - el.clientHeight)
        if (el.scrollTop <= maxInRangeTop + 1) { kaStaleSince = now; return } // 範囲内=固まらない条件
        const sig = renderSignature(el)
        if (sig !== kaPrevSig) {                             // 描画が進んだ（新着が描かれた）
            kaPrevSig = sig; kaStaleSince = now; kaProductiveAt = now; return
        }
        if (now - kaStaleSince < 60) return                 // まだ止まって60ms未満
        // 直近に進捗（自然 or パルスで起こした）があった間だけ高頻度（100ms）。無風が続いたら 600ms に
        // 間引いて無駄パルス/CPU を抑える。固まりは「進捗の直後」に起きるので、ここが速ければ取りこぼさない。
        const minGap = (now - kaProductiveAt) < 1500 ? 100 : 600
        if (now - kaLastPulse < minGap) return
        kaLastPulse = now
        const before = sig
        const staleAtPulse = now - kaStaleSince
        const wakeTop = Math.max(0, Math.min(el.scrollTop, maxInRangeTop) - el.clientHeight)
        selfScrollWrite(el, wakeTop)                                          // 見えない同期パルス
        try { if (typeof sp.scrollToNewBottom === 'function') sp.scrollToNewBottom() } catch (_) {}
        selfScrollWrite(el, el.scrollHeight)                                 // 実際の底（最新）へ戻す
        // 統計: パルス数と「効いたパルス」（150ms以上止まった後にパルス→直後に描画が前進）を記録。
        try {
            const st = (window.__crStats = window.__crStats || { kaPulse: 0, kaRescued: 0, fzFire: 0, lastRescue: null })
            st.kaPulse++
            if (staleAtPulse >= 150) {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (renderSignature(el) !== before) {
                        st.kaRescued++; st.lastRescue = { t: new Date().toISOString(), staleMs: Math.round(staleAtPulse) }
                    }
                }))
            }
        } catch (_) {}
    }
    requestAnimationFrame(keepAliveLoop)
})()
