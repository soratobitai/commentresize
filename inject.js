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

    // 自分（pin）はゲートを迂回して本当の底へ
    function pinToBottom(el) {
        selfScrolling = true
        try { topDesc.set.call(el, el.scrollHeight) } finally { selfScrolling = false }
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

    // 位置から追従状態を更新（ユーザーのネイティブスクロールはここで拾える）。
    // 底にいれば追従ON、離れれば追従OFF。ブロックされた書き込みは位置を変えず
    // scroll を発火しないので、追従OFFは維持される。
    document.addEventListener('scroll', (e) => {
        const el = e.target
        if (!isCommentContainer(el)) return
        // 強制追従ウィンドウ中は、再描画の揺れで追従を外さない（余白＝追従喪失の防止）
        if (performance.now() < forcePinUntil) { setFollowing(true); return }
        setFollowing(distFromBottom(el) <= NEAR_BOTTOM_PX)
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
            // niconico に高さを再計算させて、行数より大きく確保された余白を畳む
            triggerRelayout()
        }
    }, { capture: true })

    // 強制追従ウィンドウの間、毎フレーム底へ貼り付けて niconico を底レイアウトへ収束させる
    function forcePinLoop() {
        const el = document.querySelector('[class*="_body_"]')
        if (el) pinToBottom(el)
        if (performance.now() < forcePinUntil) requestAnimationFrame(forcePinLoop)
    }

    // コメント欄のサイズを一瞬変える操作で niconico の ResizeObserver を発火させ、
    // 仮想スクロールの行高さ・確保高さを再計算させる（余白の解消）。
    // エモーションパネルの開閉はコメント欄の高さを変えるため再計算のトリガになる。
    // 先頭へ飛ぶ副作用は forcePinLoop（底への強制追従）が相殺する。
    function triggerRelayout() {
        try {
            const emotion = document.querySelector('[aria-label="エモーションパネルの開閉"]')
            const target = emotion
                || document.querySelector('button[aria-label="ギフト"][data-content-type="nagead"][data-target-order="1"]')
                || document.querySelector('button[aria-label="ギフト"]')
            if (!target) return
            target.click()
            setTimeout(() => { try { target.click() } catch (_) {} }, 30) // 開→閉で元に戻す
        } catch (_) {}
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
            observedEl = el
            mo.observe(el, { childList: true, subtree: true })
            if (ro) ro.observe(el)
            schedulePin()
        }
    }
    ensureObserving()
    setInterval(ensureObserving, 1000) // SPA で要素が差し替わっても追従
})()
