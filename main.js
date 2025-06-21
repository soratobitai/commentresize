// デフォルトサイズ
const defaultCommentNumberFontSize = '100%'
const defaultCommentTextFontSize = '100%'
const defaultIsShowFullComment = false
const defaultIsExtensionEnabled = true // 機能拡張の有効/無効のデフォルト値

let commentNumberFontSize = defaultCommentNumberFontSize
let commentTextFontSize = defaultCommentTextFontSize
let isShowFullComment = defaultIsShowFullComment
let isExtensionEnabled = defaultIsExtensionEnabled // 機能拡張の有効/無効フラグ（ユーザー設定）
let isWheelActive = false // スクロール中かどうかのフラグ
let saveTimeout = null // 保存の遅延用タイマー
let updateStylesTimeout = null // スタイル更新の遅延用タイマー

// リソース管理用のグローバル変数
let wheelEventTimeout = null // ホイールイベント用タイマー
let commentInsertObserver = null // コメント挿入監視用Observer
let fullscreenObserver = null // フルスクリーン監視用Observer
let tableBodyHeightObserver = null // tableBodyの高さ監視用Observer
let contentsTabPanelObserver = null // contents-tab-panel監視用Observer
let isWheelEventAttached = false // ホイールイベント重複防止フラグ
let isInitialized = false // 初期化完了フラグ
let initializationTimeout = null // 初期化用タイマー
let fullscreenCheckFunction = null // フルスクリーンチェック関数の参照
let isTabPanelAvailable = false // contents-tab-panelの存在フラグ（一時的な状態）

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

        // contents-tab-panelの監視を開始
        startContentsTabPanelMonitoring(targetNode)
        
        // コメントの挿入を監視してから初期化を開始
        startCommentMonitoring(targetNode)
    })
})

/**
 * contents-tab-panelの存在を常に監視
 */
function startContentsTabPanelMonitoring(targetNode) {
    // 既存のObserverがある場合は切断
    if (contentsTabPanelObserver) {
        contentsTabPanelObserver.disconnect()
    }

    // MutationObserverを作成
    contentsTabPanelObserver = new MutationObserver((mutations) => {
        let shouldCheck = false
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                // 削除された要素をチェック
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList.contains('contents-tab-panel') || 
                            node.querySelector('.contents-tab-panel')) {
                            shouldCheck = true
                        }
                    }
                })
                
                // 追加された要素をチェック
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList.contains('contents-tab-panel') || 
                            node.querySelector('.contents-tab-panel')) {
                            shouldCheck = true
                        }
                    }
                })
            }
        })
        
        // 変更があった場合のみ状態を更新
        if (shouldCheck) {
            updateExtensionStateBasedOnTabPanel()
        }
    })

    // MutationObserverを開始
    contentsTabPanelObserver.observe(targetNode, {
        childList: true,  // 子要素の追加/削除を監視
        subtree: true     // 子孫要素も監視
    })

    // 初期状態をチェック
    updateExtensionStateBasedOnTabPanel()
}

/**
 * contents-tab-panelの存在に基づいて機能拡張の状態を更新
 */
function updateExtensionStateBasedOnTabPanel() {
    const hasTabPanel = document.querySelector('.contents-tab-panel') !== null
    
    if (hasTabPanel !== isTabPanelAvailable) {
        isTabPanelAvailable = hasTabPanel
        
        // ユーザーが機能拡張を有効にしている場合のみ、パネルの存在に応じて動作を制御
        if (isExtensionEnabled) {
            if (hasTabPanel) {
                // パネルが存在する場合：機能を有効化
                enableExtensionTemporarily()
            } else {
                // パネルが存在しない場合：機能を一時的に無効化
                disableExtensionTemporarily()
            }
        }
    }
}

/**
 * 機能拡張を一時的に無効化（設定には影響しない）
 */
function disableExtensionTemporarily() {
    removeCommentStyles()
    document.documentElement.style.removeProperty('--comment-number-size')
    document.documentElement.style.removeProperty('--comment-text-size')
    document.documentElement.style.removeProperty('--comment-wrap-mode')
    addNoBorderStyle()
}

/**
 * 機能拡張を一時的に有効化（設定には影響しない）
 */
function enableExtensionTemporarily() {
    createCommentStyles()
    updateCommentStyles(true)
    attachWheelEventForAutoScroll()
    removeNoBorderStyle()
    
    // 既存のコメントに弾幕判定を適用
    processComments()
    
    // 有効化後に自動スクロール
    scrollToPosition()
    
    // tableBodyの高さ監視を開始
    startTableBodyHeightMonitoring()
}

/**
 * 機能拡張を無効化（ユーザー設定を変更）
 */
function disableExtension() {
    if (!isExtensionEnabled) return
    
    isExtensionEnabled = false
    disableExtensionTemporarily()
    
    // 設定を保存
    saveSettings({ isExtensionEnabled }, true)
    
    // 設定パネルを更新
    updateSettingPanelState()
}

/**
 * 機能拡張を有効化（ユーザー設定を変更）
 */
function enableExtension() {
    if (isExtensionEnabled) return
    
    isExtensionEnabled = true
    
    // contents-tab-panelが存在する場合のみ実際に機能を有効化
    if (isTabPanelAvailable) {
        enableExtensionTemporarily()
    }
    
    // 設定を保存
    saveSettings({ isExtensionEnabled }, true)
    
    // 設定パネルを更新
    updateSettingPanelState()
}

/**
 * 設定パネルの状態を更新
 */
function updateSettingPanelState() {
    const toggleSwitch = document.querySelector('.toggle-switch')
    const toggleSlider = document.querySelector('.toggle-slider')
    const settingCard = document.querySelector('.setting-container > div > div:nth-child(2)')
    
    if (toggleSwitch && toggleSlider) {
        // トグルスイッチの状態を更新
        toggleSwitch.style.background = isExtensionEnabled ? '#3b82f6' : '#404040'
        toggleSwitch.style.borderColor = isExtensionEnabled ? '#3b82f6' : '#555555'
        toggleSlider.style.left = isExtensionEnabled ? '24px' : '2px'
    }
    
    if (settingCard) {
        // 設定項目カードの状態を更新
        settingCard.style.opacity = isExtensionEnabled ? '1' : '0.4'
        settingCard.style.pointerEvents = isExtensionEnabled ? 'auto' : 'none'
    }
    
    // 各コントロールのdisabled状態を更新
    const commentNumberSlider = document.getElementById('commentNumberSlider')
    const commentTextSlider = document.getElementById('commentTextSlider')
    const isShowFullCommentCheckbox = document.getElementById('isShowFullCommentCheckbox')
    
    if (commentNumberSlider) commentNumberSlider.disabled = !isExtensionEnabled
    if (commentTextSlider) commentTextSlider.disabled = !isExtensionEnabled
    if (isShowFullCommentCheckbox) isShowFullCommentCheckbox.disabled = !isExtensionEnabled
}

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

            processComments(newTableRows)

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

    // 既存のコメントに弾幕判定を適用
    processComments()

    // ホイールイベントを追加
    attachWheelEventForAutoScroll()
    
    // tableBodyの高さ監視を開始
    startTableBodyHeightMonitoring()
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
    if (tableBodyHeightObserver) {
        tableBodyHeightObserver.disconnect()
        tableBodyHeightObserver = null
    }
    if (contentsTabPanelObserver) {
        contentsTabPanelObserver.disconnect()
        contentsTabPanelObserver = null
    }

    // フラグのリセット
    isWheelEventAttached = false
    isInitialized = false

    // フルスクリーンイベントリスナーのクリーンアップ
    if (fullscreenCheckFunction) {
        document.removeEventListener('fullscreenchange', fullscreenCheckFunction)
        document.removeEventListener('webkitfullscreenchange', fullscreenCheckFunction)
        document.removeEventListener('mozfullscreenchange', fullscreenCheckFunction)
        fullscreenCheckFunction = null
    }
}

function attachWheelEventForAutoScroll() {
    try {
        // 機能拡張が無効またはパネルが存在しない場合はスキップ
        if (!isExtensionEnabled || !isTabPanelAvailable) return

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
                // 機能拡張が無効またはパネルが存在しない場合は処理をスキップ
                if (!isExtensionEnabled || !isTabPanelAvailable) return

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

    // addon-controller要素を取得
    const addonController = document.querySelector('.addon-controller')
    if (!addonController) {
        // console.warn('addon-controller要素が見つかりません')
        return
    }

    const sliderContainer = document.createElement('div')
    sliderContainer.classList.add('setting-container') // 設定画面の表示/非表示用にクラスを追加
    sliderContainer.style.display = 'none' // 初期状態
    // 指定されたスタイルを適用
    sliderContainer.style.zIndex = '1000'
    sliderContainer.style.position = 'absolute'
    sliderContainer.style.bottom = 'calc(100% + 20px)'
    sliderContainer.style.right = '0'

    sliderContainer.innerHTML = `
        <div style="
            width: 300px;
            max-width: 300px;
            margin: 0;
            background: rgba(0, 0, 0, 0.7);
            box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3);
            padding: 28px 24px 20px 24px;
            border: 1px solid #404040;
            border-radius: 12px;
            font-family: 'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif;
            backdrop-filter: blur(10px);
        ">
            <!-- 機能拡張の有効/無効トグル -->
            <div style="margin-bottom: 28px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="color: #ffffff; font-weight: 600; font-size: 18px; letter-spacing: 0.03em; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">コメントサイズ調整</span>
                    <div class="toggle-switch" style="position: relative; width: 48px; height: 24px; background: ${isExtensionEnabled ? '#3b82f6' : '#404040'}; border-radius: 12px; cursor: pointer; transition: all 0.3s ease; box-shadow: inset 0 2px 4px rgba(0,0,0,0.2); border: 1px solid ${isExtensionEnabled ? '#3b82f6' : '#555555'};">
                        <div class="toggle-slider" style="position: absolute; top: 2px; left: ${isExtensionEnabled ? '24px' : '2px'}; width: 18px; height: 18px; background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%); border-radius: 50%; transition: all 0.3s ease; box-shadow: 0 2px 8px rgba(0,0,0,0.3);"></div>
                    </div>
                </div>
            </div>

            <!-- 設定項目カード -->
            <div style="
                opacity: ${isExtensionEnabled ? '1' : '0.4'};
                pointer-events: ${isExtensionEnabled ? 'auto' : 'none'};
                transition: all 0.3s ease;
                background: linear-gradient(135deg, #2a2a2a 0%, #333333 100%);
                border-radius: 6px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1);
                padding: 20px 18px 14px 18px;
                margin-bottom: 10px;
                border: 1px solid #404040;
            ">
                <div style="margin-bottom: 20px;">
                    <label style="font-size: 15px; color: #e0e0e0; font-weight: 500; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">番号サイズ
                        <span id="comment-number-size" style="margin-left: 8px; color: #ffffff; font-size: 15px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${commentNumberFontSize}</span>
                    </label>
                    <input id="commentNumberSlider" type="range" min="50" max="300" value="${parseInt(commentNumberFontSize) || 100}"
                        style="width: 100%; margin-top: 8px; accent-color: #3b82f6; height: 6px; border-radius: 3px; background: #404040; outline: none;">
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="font-size: 15px; color: #e0e0e0; font-weight: 500; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">コメントサイズ
                        <span id="comment-text-size" style="margin-left: 8px; color: #ffffff; font-size: 15px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${commentTextFontSize}</span>
                    </label>
                    <input id="commentTextSlider" type="range" min="50" max="300" value="${parseInt(commentTextFontSize) || 100}"
                        style="width: 100%; margin-top: 8px; accent-color: #3b82f6; height: 6px; border-radius: 3px; background: #404040; outline: none;">
                </div>
                <div style="margin-top: 12px; display: flex; align-items: center;">
                    <label style="font-size: 15px; color: #e0e0e0; font-weight: 500; display: flex; align-items: center; cursor: pointer; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
                        <input type="checkbox" id="isShowFullCommentCheckbox" ${isShowFullComment ? 'checked' : ''}
                            style="width: 18px; height: 18px; accent-color: #3b82f6; margin-right: 10px; transform: scale(1.1);">
                        長いコメントを折り返す
                    </label>
                </div>
            </div>
        </div>
    `
    
    // addon-controller内の最後に挿入（Aaボタンの次に配置）
    addonController.appendChild(sliderContainer)

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
        // 手動でトグル
        if (isExtensionEnabled) {
            disableExtension()
        } else {
            enableExtension()
        }
        
        // 設定パネルの表示状態を記憶
        const oldPanel = document.querySelector('.setting-container')
        const prevDisplay = oldPanel ? oldPanel.style.display : ''
        if (oldPanel) oldPanel.remove()
        insertSettingPanel(targetNode)
        // 新しいパネルに表示状態を復元
        const newPanel = document.querySelector('.setting-container')
        if (newPanel && prevDisplay) newPanel.style.display = prevDisplay
    })

    // チェックボックスの変更イベント
    isShowFullCommentCheckbox.addEventListener('change', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        isShowFullComment = this.checked
        saveSettings({ isShowFullComment }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
        
        // 折り返し設定変更後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
    })

    // スライダーのイベントリスナー
    commentNumberSlider.addEventListener('input', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentNumberFontSize = this.value + '%'
        commentNumberSizeLabel.textContent = commentNumberFontSize
        saveSettings({ commentNumberFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
        
        // サイズ変更後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
    })

    commentTextSlider.addEventListener('input', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentTextFontSize = this.value + '%'
        commentTextSizeLabel.textContent = commentTextFontSize
        saveSettings({ commentTextFontSize }) // 遅延保存
        updateCommentStyles() // 遅延更新
        
        // サイズ変更後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
    })

    // ダブルクリックでデフォルトサイズにリセット
    commentNumberSlider.addEventListener('dblclick', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentNumberFontSize = defaultCommentNumberFontSize
        commentNumberSizeLabel.textContent = commentNumberFontSize
        commentNumberSlider.value = parseInt(defaultCommentNumberFontSize) || 100
        saveSettings({ commentNumberFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
        
        // リセット後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
    })

    commentTextSlider.addEventListener('dblclick', function () {
        if (!isExtensionEnabled) return // 機能拡張が無効の場合は処理をスキップ
        
        commentTextFontSize = defaultCommentTextFontSize
        commentTextSizeLabel.textContent = commentTextFontSize
        commentTextSlider.value = parseInt(defaultCommentTextFontSize) || 100
        saveSettings({ commentTextFontSize }, true) // 即座に保存
        updateCommentStyles(true) // 即座に更新
        
        // リセット後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
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
        
        // ホイール変更後に自動スクロールを実行
        setTimeout(() => {
            scrollToPosition()
        }, 100)
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
        optionButton.setAttribute('type', 'button')
        optionButton.setAttribute('aria-label', 'コメントサイズ調整')
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
 * コメントの弾幕判定とクラス付与（統合版）
 * @param {NodeList|Array} commentRows - 処理対象のコメント行要素（省略時は既存のすべてのコメント）
 */
function processComments(commentRows = null) {
    // 機能拡張が無効またはパネルが存在しない場合は処理をスキップ
    if (!isExtensionEnabled || !isTabPanelAvailable) return

    try {
        // 引数が指定されていない場合は既存のすべてのコメント行を取得
        const rows = commentRows || document.querySelectorAll('.table-row')
        
        if (!rows || rows.length === 0) return

        // 各コメント行に対して弾幕判定を実行
        rows.forEach(row => {
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
    } catch (error) {
        // console.warn('コメント処理中にエラーが発生しました:', error)
    }
}

/**
 * CSS変数を更新してコメントスタイルを適用（最適化版）
 */
function updateCommentStyles(immediate = false) {
    // 機能拡張が無効またはパネルが存在しない場合は処理をスキップ
    if (!isExtensionEnabled || !isTabPanelAvailable) return

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
    // 機能拡張が無効またはパネルが存在しない場合は処理をスキップ
    if (!isExtensionEnabled || !isTabPanelAvailable) return

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

    // 機能拡張が無効またはパネルが存在しない場合はスタイルを作成しない
    if (!isExtensionEnabled || !isTabPanelAvailable) return

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

        /* ツールチップ機能 */
        .option-button[aria-label]:before {
            content: attr(aria-label);
        }

        .option-button {
            position: relative;
        }

        .option-button:before {
            letter-spacing: initial;
            box-sizing: border-box;
            text-align: center;
            white-space: nowrap;
            color: #fff;
            background-color: #252525;
            pointer-events: none;
            z-index: 10000;
            opacity: 0;
            border-radius: 2px;
            padding: 6px 8px;
            font-size: 12px;
            line-height: 1;
            transition: opacity .12s;
            display: block;
            position: absolute;
            bottom: 100%;
            left: -20px;
            transform: translateX(-50%);
            margin: 0;
        }

        .option-button:hover:before {
            opacity: 1;
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

        // フルスクリーン判定関数
        const checkFullscreen = () => {
            try {
                let isFullscreen = false

                // 方法1: document.fullscreenElementをチェック（最も確実）
                if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement) {
                    isFullscreen = true
                }

                // 方法2: プレイヤーエリアのサイズをチェック
                const playerElements = document.querySelectorAll('[class*="_player-display-footer-area_"]')
                if (playerElements.length > 0) {
                    playerElements.forEach(el => {
                        const elementWidth = el.offsetWidth || el.clientWidth
                        const windowWidth = window.innerWidth
                        
                        // 要素の幅がウィンドウ幅とほぼ同じ場合をフルスクリーンと判定
                        if (elementWidth > 0 && windowWidth > 0 && Math.abs(elementWidth - windowWidth) < 5) {
                            isFullscreen = true
                        }
                    })
                }

                // ボタンの表示/非表示を切り替え
                if (isFullscreen) {
                    optionButton.style.display = 'none'
                } else {
                    optionButton.style.display = ''
                }
            } catch (error) {
                // エラー時は通常表示としてボタンを表示
                optionButton.style.display = ''
            }
        }

        // グローバル変数に保存（クリーンアップ用）
        fullscreenCheckFunction = checkFullscreen

        // ResizeObserverでサイズ変化を監視
        fullscreenObserver = new ResizeObserver(entries => {
            checkFullscreen()
        })

        // 監視対象の要素を取得
        const elements = document.querySelectorAll('[class*="_player-display-footer-area_"]')
        if (elements.length === 0) {
            // 監視対象が見つからない場合は、少し遅延して再試行
            setTimeout(() => {
                watchFullscreenChange()
            }, 2000)
            return
        }

        // 要素を監視
        elements.forEach(el => {
            try {
                fullscreenObserver.observe(el)
            } catch (error) {
                // console.warn('要素の監視開始中にエラーが発生しました:', error)
            }
        })

        // フルスクリーンイベントリスナーを追加
        document.addEventListener('fullscreenchange', fullscreenCheckFunction)
        document.addEventListener('webkitfullscreenchange', fullscreenCheckFunction)
        document.addEventListener('mozfullscreenchange', fullscreenCheckFunction)

        // 初期状態をチェック
        setTimeout(checkFullscreen, 100)

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

/**
 * tableBodyの高さ変化を監視
 */
function startTableBodyHeightMonitoring() {
    try {
        const tableBody = document.querySelector('[class*="_body_"]')
        if (!tableBody) {
            console.warn('tableBody要素が見つかりません')
            return
        }

        // 既存のObserverがある場合は切断
        if (tableBodyHeightObserver) {
            tableBodyHeightObserver.disconnect()
        }

        // 初期高さを記録
        let previousHeight = tableBody.offsetHeight

        tableBodyHeightObserver = new ResizeObserver(entries => {
            try {
                for (const entry of entries) {
                    const currentHeight = entry.contentRect.height
                    
                    // 高さが変わった場合
                    if (currentHeight !== previousHeight) {
                        // 自動スクロールを実行
                        setTimeout(() => {
                            scrollToPosition()
                        }, 100)
                        previousHeight = currentHeight
                    }
                }
            } catch (error) {
                console.warn('tableBody高さ監視中にエラーが発生しました:', error)
            }
        })

        tableBodyHeightObserver.observe(tableBody)
    } catch (error) {
        console.warn('tableBody高さ監視設定中にエラーが発生しました:', error)
    }
}
