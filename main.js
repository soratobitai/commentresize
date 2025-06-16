// デフォルトサイズ
const defaultCommentNumberFontSize = '100%'
const defaultCommentTextFontSize = '100%'
const defaultIsShowFullComment = false
const defaultIsExtensionEnabled = true // 機能拡張の有効/無効のデフォルト値

let commentNumberFontSize = defaultCommentNumberFontSize
let commentTextFontSize = defaultCommentTextFontSize
let isShowFullComment = defaultIsShowFullComment
let isExtensionEnabled = defaultIsExtensionEnabled // 機能拡張の有効/無効フラグ
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
    chrome.storage.sync.get(['commentNumberFontSize', 'commentTextFontSize', 'isShowFullComment', 'isExtensionEnabled'], (result) => {
        // エラーハンドリング
        if (chrome.runtime.lastError) {
            // console.warn('設定の読み出しに失敗しました:', chrome.runtime.lastError)
            // デフォルト値を使用
        }

        commentNumberFontSize = result.commentNumberFontSize || defaultCommentNumberFontSize
        commentTextFontSize = result.commentTextFontSize || defaultCommentTextFontSize
        isShowFullComment = result.isShowFullComment || defaultIsShowFullComment
        isExtensionEnabled = (typeof result.isExtensionEnabled === 'boolean') ? result.isExtensionEnabled : defaultIsExtensionEnabled

        // 設定画面と設定ボタンは常に表示
        insertSettingPanel(targetNode)
        setTimeout(() => {
            insertToggleButton()
        }, 1000)

        // コメントの挿入を監視してから初期化を開始
        startCommentMonitoring(targetNode)
    })

    // --- ここからエモーションボタン監視追加 ---
    function handleEmotionButtonClick() {
        const hasTabPanel = document.querySelector('.contents-tab-panel') !== null
        if (!hasTabPanel) {
            // 無ければ無効化
            if (!isExtensionEnabled) return
            isExtensionEnabled = false
            removeCommentStyles()
            document.documentElement.style.removeProperty('--comment-number-size')
            document.documentElement.style.removeProperty('--comment-text-size')
            document.documentElement.style.removeProperty('--comment-wrap-mode')
            addNoBorderStyle()
        } else {
            // あれば◯秒後に有効化
            setTimeout(() => {
                if (isExtensionEnabled) return
                isExtensionEnabled = true
                createCommentStyles()
                updateCommentStyles(true)
                attachWheelEventForAutoScroll()
                removeNoBorderStyle()
                // 有効化後に自動スクロール
                scrollToPosition()
            }, 500)
        }
    }

    // エモーションボタンを監視してイベントを付与
    function observeEmotionButton() {
        const tryAttach = () => {
            const btn = document.querySelector('[class*="_emotion-button_"]')
            if (btn && !btn.__extensionEmotionListenerAdded) {
                btn.addEventListener('click', handleEmotionButtonClick)
                btn.__extensionEmotionListenerAdded = true
            }
            // ギフトボタンにも同じ動作を設定
            const giftBtn = document.querySelector('button.___item___qkXEW[data-content-type="nagead"]')
            if (giftBtn && !giftBtn.__extensionGiftListenerAdded) {
                giftBtn.addEventListener('click', handleEmotionButtonClick)
                giftBtn.__extensionGiftListenerAdded = true
            }
        }
        // 初回即時実行
        tryAttach()
        // 以降は定期的に監視（MutationObserverでも可だが簡易にIntervalで）
        setInterval(tryAttach, 1000)
    }
    observeEmotionButton()
    // --- ここまでエモーションボタン監視追加 ---
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
        // 機能拡張が無効の場合は処理をスキップ
        if (!isExtensionEnabled) return

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

    // 初期スタイルを適用
    updateCommentStyles(true) // 即座に更新

    // ホイールイベントを追加
    attachWheelEventForAutoScroll()
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
        // 機能拡張が無効の場合はスキップ
        if (!isExtensionEnabled) return

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
                // 機能拡張が無効の場合は処理をスキップ
                if (!isExtensionEnabled) return

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
        <div style="
            max-width: 350px;
            margin: 0 auto;
            background: linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%);
            box-shadow: 0 8px 32px rgba(60,60,120,0.12), 0 1.5px 4px rgba(60,60,120,0.08);
            padding: 28px 24px 20px 24px;
            border: 1.5px solid #d1d5db;
            font-family: 'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif;
        ">
            <!-- 機能拡張の有効/無効トグル -->
            <div style="margin-bottom: 28px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: #4f46e5; font-weight: bold; font-size: 18px; letter-spacing: 0.03em;">機能拡張</span>
                    <div class="toggle-switch" style="position: relative; width: 44px; height: 22px; background: ${isExtensionEnabled ? '#4CAF50' : '#cbd5e1'}; border-radius: 11px; cursor: pointer; transition: background 0.3s; box-shadow: 0 2px 8px rgba(76,175,80,0.08);">
                        <div class="toggle-slider" style="position: absolute; top: 2px; left: ${isExtensionEnabled ? '23px' : '2px'}; width: 18px; height: 18px; background: white; border-radius: 50%; transition: left 0.3s; box-shadow: 0 2px 8px rgba(60,60,120,0.10);"></div>
                    </div>
                </div>
            </div>

            <!-- 設定項目カード -->
            <div style="
                opacity: ${isExtensionEnabled ? '1' : '0.5'};
                pointer-events: ${isExtensionEnabled ? 'auto' : 'none'};
                transition: opacity 0.3s;
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(60,60,120,0.06);
                padding: 18px 16px 10px 16px;
                margin-bottom: 10px;
                border: 1px solid #e0e7ff;
            ">
                <div style="margin-bottom: 18px;">
                    <label style="font-size: 15px; color: #374151; font-weight: 500;">番号サイズ
                        <span id="comment-number-size" style="margin-left: 8px; color: #6366f1; font-size: 15px;">${commentNumberFontSize}</span>
                    </label>
                    <input id="commentNumberSlider" type="range" min="50" max="300" value="${parseInt(commentNumberFontSize) || 100}"
                        style="width: 100%; margin-top: 6px; accent-color: #6366f1; height: 4px; border-radius: 2px;">
                </div>
                <div style="margin-bottom: 18px;">
                    <label style="font-size: 15px; color: #374151; font-weight: 500;">コメントサイズ
                        <span id="comment-text-size" style="margin-left: 8px; color: #6366f1; font-size: 15px;">${commentTextFontSize}</span>
                    </label>
                    <input id="commentTextSlider" type="range" min="50" max="300" value="${parseInt(commentTextFontSize) || 100}"
                        style="width: 100%; margin-top: 6px; accent-color: #6366f1; height: 4px; border-radius: 2px;">
                </div>
                <div style="margin-top: 10px; display: flex; align-items: center;">
                    <label style="font-size: 15px; color: #374151; font-weight: 500; display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="isShowFullCommentCheckbox" ${isShowFullComment ? 'checked' : ''}
                            style="width: 18px; height: 18px; accent-color: #6366f1; margin-right: 8px;">
                        長いコメントを折り返す
                    </label>
                </div>
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

    // 有効/無効状態に応じてdisabled属性をセット
    commentNumberSlider.disabled = !isExtensionEnabled
    commentTextSlider.disabled = !isExtensionEnabled
    isShowFullCommentCheckbox.disabled = !isExtensionEnabled

    // 機能拡張の有効/無効トグルイベント
    const toggleSwitch = sliderContainer.querySelector('.toggle-switch')
    toggleSwitch.addEventListener('click', function() {
        isExtensionEnabled = !isExtensionEnabled
        
        // 設定パネルの表示状態を記憶
        const oldPanel = document.querySelector('.setting-container')
        const prevDisplay = oldPanel ? oldPanel.style.display : ''
        if (oldPanel) oldPanel.remove()
        insertSettingPanel(targetNode)
        // 新しいパネルに表示状態を復元
        const newPanel = document.querySelector('.setting-container')
        if (newPanel && prevDisplay) newPanel.style.display = prevDisplay

        // 設定を保存
        saveSettings({ isExtensionEnabled }, true)
        
        // 機能拡張の状態に応じて処理を実行
        if (isExtensionEnabled) {
            createCommentStyles() // スタイルを再作成
            updateCommentStyles(true)
            attachWheelEventForAutoScroll()
            removeNoBorderStyle() // ボーダー消去スタイルを削除
        } else {
            removeCommentStyles() // スタイルを削除
            document.documentElement.style.removeProperty('--comment-number-size')
            document.documentElement.style.removeProperty('--comment-text-size')
            document.documentElement.style.removeProperty('--comment-wrap-mode')
            addNoBorderStyle() // ボーダー消去スタイルを追加
        }
    })

    // チェックボックスの変更イベント
    isShowFullCommentCheckbox.addEventListener('change', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        isShowFullComment = this.checked
        saveSettings({ isShowFullComment }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    // スライダーのイベントリスナー
    commentNumberSlider.addEventListener('input', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentNumberFontSize = this.value + '%'
        commentNumberSizeLabel.textContent = commentNumberFontSize
        saveSettings({ commentNumberFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
    })

    commentTextSlider.addEventListener('input', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentTextFontSize = this.value + '%'
        commentTextSizeLabel.textContent = commentTextFontSize
        saveSettings({ commentTextFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
    })

    // ダブルクリックでデフォルトサイズにリセット
    commentNumberSlider.addEventListener('dblclick', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentNumberFontSize = defaultCommentNumberFontSize
        commentNumberSizeLabel.textContent = commentNumberFontSize
        commentNumberSlider.value = parseInt(defaultCommentNumberFontSize) || 100
        saveSettings({ commentNumberFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    commentTextSlider.addEventListener('dblclick', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentTextFontSize = defaultCommentTextFontSize
        commentTextSizeLabel.textContent = commentTextFontSize
        commentTextSlider.value = parseInt(defaultCommentTextFontSize) || 100
        saveSettings({ commentTextFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
    })

    // ホイールイベントを追加
    const handleMouseWheel = (event, slider, sizeLabel, fontSizeKey) => {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
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
        optionButton.addEventListener('click', function (event) {
            try {
                const sliderContainer = document.querySelector('.setting-container')
                if (sliderContainer) {
                    const isOpen = sliderContainer.style.display !== 'none'
                    sliderContainer.style.display = isOpen ? 'none' : 'block'

                    // パネルを開いたときのみ外側クリックで閉じるリスナーを追加
                    if (!isOpen) {
                        // まず既存のリスナーを削除
                        document.removeEventListener('mousedown', handleOutsideClick)
                        // 新たに追加
                        setTimeout(() => {
                            document.addEventListener('mousedown', handleOutsideClick)
                        }, 0)
                    } else {
                        document.removeEventListener('mousedown', handleOutsideClick)
                    }
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

// 設定パネル外クリックで閉じる
function handleOutsideClick(event) {
    const sliderContainer = document.querySelector('.setting-container')
    if (!sliderContainer) return
    const optionButton = document.querySelector('.option-button')
    // パネル内またはAaボタン自体をクリックした場合は閉じない
    if (sliderContainer.contains(event.target) || optionButton.contains(event.target)) return
    sliderContainer.style.display = 'none'
    document.removeEventListener('mousedown', handleOutsideClick)
}

/**
 * 新しいコメントの弾幕判定とクラス付与
 */
function processNewComments(newTableRows) {
    // 機能拡張が無効の場合は処理をスキップ
    if (!isExtensionEnabled) return
    
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
    // 機能拡張が無効の場合は処理をスキップ
    if (!isExtensionEnabled) return

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
    // 機能拡張が無効の場合は処理をスキップ
    if (!isExtensionEnabled) return

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

    // 機能拡張が無効の場合はスタイルを作成しない
    if (!isExtensionEnabled) return

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

/**
 * コメント用のCSSスタイルルールを削除
 */
function removeCommentStyles() {
    const existingStyle = document.getElementById('comment-resize-styles')
    if (existingStyle) {
        existingStyle.remove()
    }
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

/**
 * .table-row の border-bottom を消すスタイルを追加
 */
function addNoBorderStyle() {
    let style = document.getElementById('no-border-style')
    if (!style) {
        style = document.createElement('style')
        style.id = 'no-border-style'
        style.textContent = `.table-row { border-bottom: none !important; }`
        document.head.appendChild(style)
    }
}

/**
 * .table-row の border-bottom を消すスタイルを削除
 */
function removeNoBorderStyle() {
    const style = document.getElementById('no-border-style')
    if (style) style.remove()
}
