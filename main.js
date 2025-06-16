// デフォルトサイズ
const defaultCommentNumberFontSize = '100%'
const defaultCommentTextFontSize = '100%'
const defaultIsShowFullComment = false

let commentNumberFontSize = defaultCommentNumberFontSize
let commentTextFontSize = defaultCommentTextFontSize
let isShowFullComment = defaultIsShowFullComment
let isWheelActive = false // スクロール中かどうかのフラグ
let saveTimeout = null // 保存の遅延用タイマー
let updateStylesTimeout = null // スタイル更新の遅延用タイマー

// リソース管理用のグローバル変数
let wheelEventTimeout = null // ホイールイベント用タイマー
let commentInsertObserver = null // コメント挿入監視用Observer
let fullscreenObserver = null // フルスクリーン監視用Observer
let isWheelEventAttached = false // ホイールイベント重複防止フラグ
let isInitialized = false // 初期化完了フラグ
let initializationTimeout = null // 初期化用タイマー

document.addEventListener('DOMContentLoaded', () => {

    // 監視対象の要素
    const targetNode = document.getElementById('root')
    if (!targetNode) return

    // chrome.storageから設定を取得
    chrome.storage.sync.get(['commentNumberFontSize', 'commentTextFontSize', 'isShowFullComment'], (result) => {
        // エラーハンドリング
        if (chrome.runtime.lastError) {
            // console.warn('設定の読み出しに失敗しました:', chrome.runtime.lastError)
            // デフォルト値を使用
        }

        commentNumberFontSize = result.commentNumberFontSize || defaultCommentNumberFontSize
        commentTextFontSize = result.commentTextFontSize || defaultCommentTextFontSize
        isShowFullComment = result.isShowFullComment || defaultIsShowFullComment

        // コメントの挿入を監視してから初期化を開始
        startCommentMonitoring(targetNode)
    })
})

/**
 * コメント監視を開始し、最初のコメントが挿入されてから初期化を実行
 */
function startCommentMonitoring(targetNode) {
    // 既存のObserverがある場合は切断
    if (commentInsertObserver) {
        commentInsertObserver.disconnect()
    }

    // MutationObserverを作成
    commentInsertObserver = new MutationObserver(async function (mutations) {
        let hasNewComments = false
        let newTableRows = []

        mutations.forEach(function (mutation) {
            // 追加された要素を取得する
            const newNodes = mutation.addedNodes
            const targets = Array.from(newNodes).reduce((accumulator, node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    accumulator.push(node)
                }
                return accumulator
            }, [])

            targets.forEach(target => {
                if (target.classList.contains('contents-tab-panel')) {
                    // 初期化が完了していない場合は初期化を実行
                    if (!isInitialized) {
                        scheduleInitialization(targetNode)
                    }
                    return
                }

                if (target.classList.contains('table-row')) {
                    hasNewComments = true
                    newTableRows.push(target)
                }

                // 子要素の中にtable-rowがあるかチェック
                const childRows = target.querySelectorAll('.table-row')
                if (childRows.length > 0) {
                    hasNewComments = true
                    newTableRows.push(...Array.from(childRows))
                }
            })
        })

        // 最初のコメントが挿入された場合、初期化をスケジュール
        if (hasNewComments && !isInitialized) {
            scheduleInitialization(targetNode)
        }

        // 初期化が完了している場合は通常のコメント処理を実行
        if (hasNewComments && isInitialized) {
            setTimeout(() => {
                processNewComments(newTableRows)
                
                // 自動スクロール処理
                if (newTableRows.length > 0 && !isWheelActive && isScrollAtBottom()) {
                    const tableBody = newTableRows[0]?.parentElement?.parentElement
                    if (tableBody) {
                        const lastRow = newTableRows[newTableRows.length - 1]
                        if (lastRow) {
                            scrollToPosition(lastRow.offsetTop - tableBody.offsetTop)
                        }
                    }
                }
            }, 500)
        }
    })

    // MutationObserverを開始
    commentInsertObserver.observe(targetNode, { childList: true, subtree: true })
}

/**
 * 初期化をスケジュール
 */
function scheduleInitialization(targetNode) {
    // 既存のタイマーをクリア
    if (initializationTimeout) {
        clearTimeout(initializationTimeout)
    }

    // 1秒後に初期化を実行
    initializationTimeout = setTimeout(() => {
        if (!isInitialized) {
            initializeApp(targetNode)
            isInitialized = true
            
            // 初期化後にスクロール位置を調整
            setTimeout(() => {
                scrollToPosition()
            }, 300)
        }
    }, 500)
}

/**
 * アプリケーションの初期化
 */
function initializeApp(targetNode) {
    // CSSスタイルルールを作成
    createCommentStyles()

    // 設定画面を追加
    insertSettingPanel(targetNode)

    // 初期スタイルを適用
    updateCommentStyles(true) // 即座に更新

    // ホイールイベントを追加
    attachWheelEventForAutoScroll()

    // 設定ボタンを追加（少し遅延させてDOMの準備を待つ）
    setTimeout(() => {
        insertToggleButton()
    }, 1000)
}

/**
 * 設定を保存（デバウンス機能付き）
 */
function saveSettings(settings, immediate = false) {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }

    if (immediate) {
        // 即座に保存（チェックボックスなど）
        chrome.storage.sync.set(settings, () => {
            if (chrome.runtime.lastError) {
                // console.warn('設定の保存に失敗しました:', chrome.runtime.lastError)
            }
        })
    } else {
        // 遅延保存（スライダーなど）
        saveTimeout = setTimeout(() => {
            chrome.storage.sync.set(settings, () => {
                if (chrome.runtime.lastError) {
                    // console.warn('設定の保存に失敗しました:', chrome.runtime.lastError)
                }
            })
        }, 500) // 500ms遅延
    }
}

/**
 * リソースのクリーンアップ
 */
function cleanupResources() {
    // タイマーのクリーンアップ
    if (saveTimeout) {
        clearTimeout(saveTimeout)
        saveTimeout = null
    }
    if (updateStylesTimeout) {
        clearTimeout(updateStylesTimeout)
        updateStylesTimeout = null
    }
    if (wheelEventTimeout) {
        clearTimeout(wheelEventTimeout)
        wheelEventTimeout = null
    }
    if (initializationTimeout) {
        clearTimeout(initializationTimeout)
        initializationTimeout = null
    }

    // Observerのクリーンアップ
    if (commentInsertObserver) {
        commentInsertObserver.disconnect()
        commentInsertObserver = null
    }
    if (fullscreenObserver) {
        fullscreenObserver.disconnect()
        fullscreenObserver = null
    }

    // フラグのリセット
    isWheelEventAttached = false
    isInitialized = false
}

function attachWheelEventForAutoScroll() {
    try {
        // 既にイベントが追加されている場合はスキップ
        if (isWheelEventAttached) return

        // マウスホイール操作を検出
        const tableBody = document.querySelector('[class*="_body_"]')
        if (!tableBody) {
            // console.warn('ホイールイベント対象の要素が見つかりません')
            return
        }

        tableBody.addEventListener('wheel', () => {
            try {
                isWheelActive = true // ホイール操作中はtrueに設定

                // 既存のタイマーをクリアして再設定
                if (wheelEventTimeout) {
                    clearTimeout(wheelEventTimeout)
                }

                if (isScrollAtBottom()) {
                    isWheelActive = false
                }

                // 一定時間後にフラグをfalseに戻す
                wheelEventTimeout = setTimeout(() => {
                    isWheelActive = false
                }, 1000)
            } catch (error) {
                // console.warn('ホイールイベント処理中にエラーが発生しました:', error)
                isWheelActive = false
            }
        })

        isWheelEventAttached = true
    } catch (error) {
        // console.warn('ホイールイベントの設定中にエラーが発生しました:', error)
    }
}

/**
 * 設定画面を挿入
 */
function insertSettingPanel(targetNode) {

    const contentsArea = targetNode.querySelector('[class*="_contents-area_"]')

    const sliderContainer = document.createElement('div')
    sliderContainer.classList.add('setting-container') // 設定画面の表示/非表示用にクラスを追加
    sliderContainer.style.display = 'none' // 初期状態

    sliderContainer.innerHTML = `
        <div style="padding:20px; border-top: 1px solid #ccc;">
            <label>番号サイズ: <span id="comment-number-size">${commentNumberFontSize}</span></label>
            <input id="commentNumberSlider" type="range" min="50" max="300" value="${parseInt(commentNumberFontSize) || 100}" style="width: 100%;">
            <br>
            <label>コメントサイズ: <span id="comment-text-size">${commentTextFontSize}</span></label>
            <input id="commentTextSlider" type="range" min="50" max="300" value="${parseInt(commentTextFontSize) || 100}" style="width: 100%;">
            <br>
            <div style="margin-top: 10px;">
                <label>
                    <input type="checkbox" id="isShowFullCommentCheckbox" ${isShowFullComment ? 'checked' : ''}>
                    長いコメントを折り返す
                </label>
            </div>
        </div>
    `
    contentsArea.parentNode.insertBefore(sliderContainer, contentsArea.nextSibling)

    // 設定画面のイベントリスナーを追加
    const commentNumberSlider = document.getElementById('commentNumberSlider')
    const commentTextSlider = document.getElementById('commentTextSlider')
    const commentNumberSizeLabel = document.getElementById('comment-number-size')
    const commentTextSizeLabel = document.getElementById('comment-text-size')
    const isShowFullCommentCheckbox = document.getElementById('isShowFullCommentCheckbox')

    // チェックボックスの変更イベント
    isShowFullCommentCheckbox.addEventListener('change', function () {
        isShowFullComment = this.checked
        saveSettings({ isShowFullComment }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    // スライダーのイベントリスナー
    commentNumberSlider.addEventListener('input', function () {
        commentNumberFontSize = this.value + '%'
        commentNumberSizeLabel.textContent = commentNumberFontSize
        saveSettings({ commentNumberFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
    })

    commentTextSlider.addEventListener('input', function () {
        commentTextFontSize = this.value + '%'
        commentTextSizeLabel.textContent = commentTextFontSize
        saveSettings({ commentTextFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
    })

    // ダブルクリックでデフォルトサイズにリセット
    commentNumberSlider.addEventListener('dblclick', function () {
        commentNumberFontSize = defaultCommentNumberFontSize
        commentNumberSizeLabel.textContent = commentNumberFontSize
        commentNumberSlider.value = parseInt(defaultCommentNumberFontSize) || 100
        saveSettings({ commentNumberFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    commentTextSlider.addEventListener('dblclick', function () {
        commentTextFontSize = defaultCommentTextFontSize
        commentTextSizeLabel.textContent = commentTextFontSize
        commentTextSlider.value = parseInt(defaultCommentTextFontSize) || 100
        saveSettings({ commentTextFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    // ホイールイベントを追加
    const handleMouseWheel = (event, slider, sizeLabel, fontSizeKey) => {
        event.preventDefault() // デフォルトのスクロールを無効化
        const step = 1 // サイズ変更のステップ
        let newValue = parseInt(slider.value) + (event.deltaY > 0 ? -step : step)
        newValue = Math.min(300, Math.max(50, newValue)) // 範囲を制限
        slider.value = newValue
        sizeLabel.textContent = newValue + '%'
        saveSettings({ [fontSizeKey]: newValue + '%' }) // 保存

        // スタイルを更新
        if (fontSizeKey === 'commentNumberFontSize') {
            commentNumberFontSize = newValue + '%' // 更新されたサイズをセット
        } else {
            commentTextFontSize = newValue + '%' // 更新されたサイズをセット
        }
        updateCommentStyles() // 遅延更新
    }

    // コメント番号ホイールイベント
    commentNumberSlider.addEventListener('wheel', function (event) {
        handleMouseWheel(event, commentNumberSlider, commentNumberSizeLabel, 'commentNumberFontSize')
    })

    // コメントテキストホイールイベント
    commentTextSlider.addEventListener('wheel', function (event) {
        handleMouseWheel(event, commentTextSlider, commentTextSizeLabel, 'commentTextFontSize')
    })
}

/**
 * 設定画面の表示・非表示ボタンを挿入
 */
function insertToggleButton() {
    try {
        const addonController = document.querySelector('.addon-controller')
        if (!addonController) {
            // console.warn('addon-controller要素が見つかりません')
            return
        }

        if (addonController.querySelector('.option-button')) {
            // console.log('設定ボタンは既に存在します')
            return
        }

        const optionButton = document.createElement('button')
        optionButton.textContent = 'Aa'
        optionButton.style.backgroundColor = 'initial'
        optionButton.style.color = '#fff'
        optionButton.style.border = 'none'
        optionButton.style.cursor = 'pointer'
        optionButton.classList.add('option-button')

        // 設定画面表示・非表示のトグル
        optionButton.addEventListener('click', function () {
            try {
                const sliderContainer = document.querySelector('.setting-container')
                if (sliderContainer) {
                    sliderContainer.style.display = sliderContainer.style.display === 'none' ? 'block' : 'none'
                } else {
                    // console.warn('設定コンテナが見つかりません')
                }
            } catch (error) {
                // console.warn('設定ボタンクリック処理中にエラーが発生しました:', error)
            }
        })

        // addon-controller内の最後にボタンを挿入
        addonController.appendChild(optionButton)
        
        // フルスクリーン監視を開始
        watchFullscreenChange()
    } catch (error) {
        // console.warn('設定ボタンの挿入中にエラーが発生しました:', error)
    }
}

/**
 * 新しいコメントの弾幕判定とクラス付与
 */
function processNewComments(newTableRows) {
    if (!newTableRows || newTableRows.length === 0) return

    // 新しいコメントのみを処理
    newTableRows.forEach(row => {
        const commentText = row.querySelector('.comment-text')
        if (commentText) {
            const comment = commentText.textContent || ''
            const isDanmaku = isDanmakuComment(comment)
            
            // 弾幕クラスの付与
            if (isDanmaku) {
                commentText.classList.add('danmaku-comment')
            } else {
                commentText.classList.remove('danmaku-comment')
            }
        }
    })
}

/**
 * CSS変数を更新してコメントスタイルを適用（最適化版）
 */
function updateCommentStyles(immediate = false) {
    if (updateStylesTimeout) {
        clearTimeout(updateStylesTimeout)
    }

    if (immediate) {
        // 即座に実行（チェックボックスなど）
        applyCommentStyles()
    } else {
        // 遅延実行（スライダーなど）
        updateStylesTimeout = setTimeout(() => {
            applyCommentStyles()
        }, 16) // 約60fps
    }
}

/**
 * 実際のスタイル適用処理
 */
function applyCommentStyles() {
    // CSS変数のみ更新（DOM操作なし）
    document.documentElement.style.setProperty('--comment-number-size', commentNumberFontSize)
    document.documentElement.style.setProperty('--comment-text-size', commentTextFontSize)
    document.documentElement.style.setProperty('--comment-wrap-mode', isShowFullComment ? 'normal' : 'nowrap')
}

/**
 * コメント用のCSSスタイルルールを作成
 */
function createCommentStyles() {
    // 既存のスタイルが存在する場合は削除
    const existingStyle = document.getElementById('comment-resize-styles')
    if (existingStyle) {
        existingStyle.remove()
    }

    const style = document.createElement('style')
    style.id = 'comment-resize-styles'
    style.textContent = `
        :root {
            --comment-number-size: ${commentNumberFontSize};
            --comment-text-size: ${commentTextFontSize};
            --comment-wrap-mode: ${isShowFullComment ? 'normal' : 'nowrap'};
        }
        
        .table-row {
            height: auto !important;
            min-height: 32px !important;
            padding-top: 0.4rem !important;
            padding-bottom: 0.4rem !important;
            border-bottom: 1px solid rgba(150,150,150,0.4) !important;
        }
        
        .comment-number {
            font-size: var(--comment-number-size) !important;
        }
        
        .comment-text {
            font-size: var(--comment-text-size) !important;
            white-space: var(--comment-wrap-mode) !important;
        }
        
        .danmaku-comment {
            white-space: nowrap !important;
        }
    `
    document.head.appendChild(style)
}

// スクロール
function scrollToPosition(position = 'bottom') {
    try {
        const tableBody = document.querySelector('[class*="_body_"]')
        if (!tableBody) {
            // console.warn('スクロール対象の要素が見つかりません')
            return
        }

        // scrollToメソッドの存在確認
        if (typeof tableBody.scrollTo !== 'function') {
            // console.warn('scrollToメソッドが利用できません')
            return
        }

        const isBottom = position === 'bottom'
        const isNumber = typeof position === 'number'

        const scrollOptions = {
            top: isBottom
                ? tableBody.scrollHeight || 0
                : (tableBody.scrollTop || 0) + (isNumber ? position : 0),
            behavior: 'auto'
        }

        tableBody.scrollTo(scrollOptions)
    } catch (error) {
        // console.warn('スクロール実行中にエラーが発生しました:', error)
    }
}

// スクロール位置が一番下にあるか
function isScrollAtBottom() {
    try {
        const tableBody = document.querySelector('[class*="_body_"]')
        if (!tableBody) {
            // console.warn('スクロール要素が見つかりません')
            return false
        }

        // 要素のスクロール位置と高さを取得
        const scrollTop = tableBody.scrollTop || 0
        const scrollHeight = tableBody.scrollHeight || 0
        const clientHeight = tableBody.clientHeight || 0

        // スクロールバーが一番下にあるかをチェック
        return scrollTop + clientHeight >= scrollHeight - 1
    } catch (error) {
        // console.warn('スクロール位置の確認中にエラーが発生しました:', error)
        return false
    }
}

// 弾幕判定関数
function isDanmakuComment(comment) {
    try {
        // 入力値の検証
        if (!comment || typeof comment !== 'string') {
            return false
        }

        const totalLength = comment.length
        if (totalLength === 0) return false

        // 通常のコメントを抽出する正規表現
        const regex = /[ぁ-ゟ゠-ヿ一-龯ａ-ｚＡ-Ｚa-zA-Z0-9０-９]/g

        // 弾幕文字の割合を計算
        const danmakuCount = (comment.replace(regex, '') || '').length
        const danmakuRatio = danmakuCount / totalLength

        // 判定
        const isNormalTextHeavy = (Math.round(danmakuRatio * 10) / 10) >= 0.5

        return isNormalTextHeavy
    } catch (error) {
        // console.warn('弾幕判定中にエラーが発生しました:', error)
        return false
    }
}

// フルスクリーン時にボタン非表示
function watchFullscreenChange() {
    try {
        const optionButton = document.getElementsByClassName('option-button')[0]

        if (!optionButton) {
            // option-button要素が見つからない場合は、少し遅延して再試行
            setTimeout(() => {
                watchFullscreenChange()
            }, 1000)
            return
        }

        // 既存のObserverがある場合は切断
        if (fullscreenObserver) {
            fullscreenObserver.disconnect()
        }

        fullscreenObserver = new ResizeObserver(entries => {
            try {
                for (const entry of entries) {
                    const elementWidth = entry.contentRect.width
                    const windowWidth = window.innerWidth

                    if (elementWidth === windowWidth) {
                        optionButton.style.display = 'none'
                    } else {
                        optionButton.style.display = ''
                    }
                }
            } catch (error) {
                // console.warn('フルスクリーン監視中にエラーが発生しました:', error)
            }
        })

        const elements = document.querySelectorAll('[class*="_player-display-footer-area_"]')
        if (elements.length === 0) {
            // console.warn('フルスクリーン監視対象の要素が見つかりません')
            return
        }

        elements.forEach(el => {
            try {
                fullscreenObserver.observe(el)
            } catch (error) {
                // console.warn('要素の監視開始中にエラーが発生しました:', error)
            }
        })
    } catch (error) {
        // console.warn('フルスクリーン監視設定中にエラーが発生しました:', error)
    }
}

// ページアンロード時のクリーンアップ
window.addEventListener('beforeunload', () => {
    cleanupResources()
})

// ページ非表示時のクリーンアップ（オプション）
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // ページが非表示になった時の処理（必要に応じて）
    }
})
