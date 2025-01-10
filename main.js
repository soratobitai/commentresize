// デフォルトサイズ
const defaultCommentNumberFontSize = '100%'
const defaultCommentTextFontSize = '100%'
const defaultIsShowFullComment = false

let commentNumberFontSize = defaultCommentNumberFontSize
let commentTextFontSize = defaultCommentTextFontSize
let isShowFullComment = defaultIsShowFullComment

// 初期値を chrome.storage から取得
chrome.storage.sync.get(['commentNumberFontSize', 'commentTextFontSize', 'isShowFullComment'], (result) => {
    commentNumberFontSize = result.commentNumberFontSize || defaultCommentNumberFontSize
    commentTextFontSize = result.commentTextFontSize || defaultCommentTextFontSize
    isShowFullComment = result.isShowFullComment || defaultIsShowFullComment
})

let isWheelActive = false // スクロール中かどうかのフラグ
let isBackgroundColor = false // 背景色を変更するかどうかのフラグ

window.addEventListener('load', function () {

    // 監視対象の要素
    const targetNode = document.body
    if (!targetNode) return

    setTimeout(() => {

        // 設定画面を追加
        insertSettingPanel(targetNode)

        // コメントの挿入を監視
        checkElementInsert(targetNode)

        // 初期スタイルを適用
        updateStyles(targetNode.querySelectorAll('.table-row'))

        // ホイールイベントを追加
        attachWheelEventForAutoScroll()

        // インジケータボタンのイベントを追加
        addClickEvent_indicatorButton()

    }, 1500) // 1500
})

function attachWheelEventForAutoScroll() {
    let timeout // タイマー用の変数

    // マウスホイール操作を検出
    const tableBody = document.querySelector('[class*="_body_"]')
    if (!tableBody) return
    tableBody.addEventListener('wheel', () => {
        isWheelActive = true // ホイール操作中はtrueに設定

        // 既存のタイマーをクリアして再設定
        clearTimeout(timeout)

        if (isScrollAtBottom()) {
            isWheelActive = false
        }

        // 一定時間後にフラグをfalseに戻す
        timeout = setTimeout(() => {
            isWheelActive = false
        }, 1000)
    })
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
            <input id="commentNumberSlider" type="range" min="50" max="300" value="${parseInt(commentNumberFontSize)}" style="width: 100%;">
            <br>
            <label>コメントサイズ: <span id="comment-text-size">${commentTextFontSize}</span></label>
            <input id="commentTextSlider" type="range" min="50" max="300" value="${parseInt(commentTextFontSize)}" style="width: 100%;">
            <br>
            <div style="margin-top: 10px;">
                <label>
                    <input type="checkbox" id="isShowFullCommentCheckbox" ${isShowFullComment ? 'checked' : ''}>
                    コメント折り返し（β）
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
        chrome.storage.sync.set({ isShowFullComment }) // chrome.storageに保存
        updateStyles(targetNode.querySelectorAll('.table-row'))
    })

    // スライダーのイベントリスナー
    commentNumberSlider.addEventListener('input', function () {
        commentNumberFontSize = this.value + '%'
        commentNumberSizeLabel.textContent = commentNumberFontSize
        chrome.storage.sync.set({ commentNumberFontSize }) // chrome.storageに保存
        updateStyles(targetNode.querySelectorAll('.table-row'))
    })

    commentTextSlider.addEventListener('input', function () {
        commentTextFontSize = this.value + '%'
        commentTextSizeLabel.textContent = commentTextFontSize
        chrome.storage.sync.set({ commentTextFontSize }) // chrome.storageに保存
        updateStyles(targetNode.querySelectorAll('.table-row'))
    })

    // ダブルクリックでデフォルトサイズにリセット
    commentNumberSlider.addEventListener('dblclick', function () {
        commentNumberFontSize = defaultCommentNumberFontSize
        commentNumberSizeLabel.textContent = commentNumberFontSize
        commentNumberSlider.value = parseInt(defaultCommentNumberFontSize)
        chrome.storage.sync.set({ commentNumberFontSize }) // chrome.storageに保存
        updateStyles(targetNode.querySelectorAll('.table-row'))
    })

    commentTextSlider.addEventListener('dblclick', function () {
        commentTextFontSize = defaultCommentTextFontSize
        commentTextSizeLabel.textContent = commentTextFontSize
        commentTextSlider.value = parseInt(defaultCommentTextFontSize)
        chrome.storage.sync.set({ commentTextFontSize }) // chrome.storageに保存
        updateStyles(targetNode.querySelectorAll('.table-row'))
    })

    // ホイールイベントを追加
    const handleMouseWheel = (event, slider, sizeLabel, fontSizeKey) => {
        event.preventDefault() // デフォルトのスクロールを無効化
        const step = 1 // サイズ変更のステップ
        let newValue = parseInt(slider.value) + (event.deltaY > 0 ? -step : step)
        newValue = Math.min(300, Math.max(50, newValue)) // 範囲を制限
        slider.value = newValue
        sizeLabel.textContent = newValue + '%'
        chrome.storage.sync.set({ [fontSizeKey]: newValue + '%' }) // 保存

        // スタイルを更新
        if (fontSizeKey === 'commentNumberFontSize') {
            commentNumberFontSize = newValue + '%' // 更新されたサイズをセット
        } else {
            commentTextFontSize = newValue + '%' // 更新されたサイズをセット
        }
        updateStyles(targetNode.querySelectorAll('.table-row')) // スタイルを更新
    }

    // コメント番号ホイールイベント
    commentNumberSlider.addEventListener('wheel', function (event) {
        handleMouseWheel(event, commentNumberSlider, commentNumberSizeLabel, 'commentNumberFontSize')
    })

    // コメントテキストホイールイベント
    commentTextSlider.addEventListener('wheel', function (event) {
        handleMouseWheel(event, commentTextSlider, commentTextSizeLabel, 'commentTextFontSize')
    })

    insertToggleButton() // トグルボタンをaddon-controller内に挿入
}


/**
 * 設定画面の表示・非表示ボタンを挿入
 */
function insertToggleButton() {
    const addonController = document.querySelector('.addon-controller')
    if (addonController) {
        const toggleButton = document.createElement('button')
        toggleButton.textContent = 'Aa'
        toggleButton.style.backgroundColor = '#000'
        toggleButton.style.color = '#fff'
        toggleButton.style.border = 'none'
        toggleButton.style.cursor = 'pointer'

        // 設定画面表示・非表示のトグル
        toggleButton.addEventListener('click', function () {
            const sliderContainer = document.querySelector('.setting-container')
            if (sliderContainer) {
                sliderContainer.style.display = sliderContainer.style.display === 'none' ? 'block' : 'none'
            }
        })

        // addon-controller内の最後にボタンを挿入
        addonController.appendChild(toggleButton)
    }
}

/**
 * 要素の挿入を監視
 */
function checkElementInsert(targetNode) {

    // MutationObserverを作成
    const observer = new MutationObserver(async function (mutations) {
        mutations.forEach(function (mutation) {
            // 追加された要素を取得する
            const newNodes = mutation.addedNodes
            const targets = Array.from(newNodes).reduce((accumulator, node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    accumulator.push(node)
                }
                return accumulator
            }, [])

            updateStyles(targets)
        })
    })

    // MutationObserverを開始
    observer.observe(targetNode, { childList: true, subtree: true })
}

/**
 * スタイルを適用
 */
function updateStyles(targets) {
    targets.forEach(target => {

        // コメントタブに切り替わった時に再度イベントを追加
        if (target.classList.contains('contents-tab-panel')) {
            attachWheelEventForAutoScroll()
            addClickEvent_indicatorButton()
            updateStyles(target.querySelectorAll('.table-row'))
            return
        }

        // コメントの要素でない場合はスキップ
        if (!target.classList.contains('table-row')) return

        // あるクラス名を含んでいる場合はスキップ
        if (target.classList.contains('fix-element')) return

        // fix-elementを削除
        target.parentElement?.querySelector('.fix-element')?.remove()

        // 要素を取得
        const tableRow = target
        const table = tableRow.parentElement
        if (!table) return
        const tableBody = table?.parentElement
        if (!tableBody) return

        // コメントのスタイルを変更
        ChangeCommentsStyle(tableRow)
        isBackgroundColor = !isBackgroundColor

        // 自動スクロール
        autoScroll(tableBody, tableRow)
    })
}

/**
 * コメントのスタイルを変更
 */
function ChangeCommentsStyle(tableRow) {
    
    tableRow.style.height = 'auto'
    tableRow.style.minHeight = '32px'

    // コメント番号のサイズを変更
    const commentNumber = tableRow.querySelector('.comment-number')
    if (commentNumber) {
        commentNumber.style.fontSize = commentNumberFontSize
    }

    // コメントテキストのサイズを変更
    const commentText = tableRow.querySelector('.comment-text')
    if (commentText) {
        commentText.style.fontSize = commentTextFontSize
        commentText.style.whiteSpace = isShowFullComment ? 'normal' : 'nowrap'

        // 弾幕コメント判定
        if (isShowFullComment) {
            const comment = commentText.textContent
            if (comment) {
                commentText.style.whiteSpace = isDanmakuComment(comment) ? 'nowrap' : 'normal'
            }
        }
    }
    
    // コメント全文表示時、背景色をストライプにする
    const tableRows = tableRow.parentElement.querySelectorAll('.table-row')
    tableRows.forEach((row, index) => {
        const isEven = index % 2 === 0
        const shouldApplyBackground = isEven === isBackgroundColor
        const backgroundColor = isShowFullComment ? 'rgba(150, 150, 150, 0.2)' : ''
        row.style.backgroundColor = shouldApplyBackground ? backgroundColor : ''
    })
}

function autoScroll(tableBody, tableRow) {

    // コメントサイズ分スクロール
    if (!isWheelActive) scrollToPosition(tableBody, tableRow.offsetHeight)
    
    // 一番下へスクロール
    setTimeout(() => {
        if (!isWheelActive) scrollToPosition(tableBody)
    }, 500)
}

// スクロール
function scrollToPosition(tableBody, position = 'bottom') {    
    if (position === 'bottom') {
        tableBody.scrollTo({
            top: tableBody.scrollHeight
        })
    } else if (typeof position === 'number') {
        tableBody.scrollBy({
            top: position
        })
    }
}

// スクロール位置が一番下にあるか
function isScrollAtBottom() {
    const tableBody = document.querySelector('[class*="_body_"]')
    // 要素のスクロール位置と高さを取得
    const scrollTop = tableBody.scrollTop; // 現在のスクロール位置
    const scrollHeight = tableBody.scrollHeight; // コンテンツの全体の高さ
    const clientHeight = tableBody.clientHeight; // 表示領域の高さ

    // スクロールバーが一番下にあるかをチェック
    return scrollTop + clientHeight >= scrollHeight - 1;
}

function addClickEvent_indicatorButton() {
    const playerSection = document.querySelector('[class*="_player-section_"]')
    if (!playerSection) return

    // MutationObserverで`indicator`の追加を監視
    const observer = new MutationObserver(() => {
        const indicator = playerSection.querySelector('[class*="_indicator_"]')
        if (indicator && !indicator.dataset.myEventAdded) {
            // イベントが未登録の場合のみ追加
            indicator.addEventListener('click', handleIndicatorClick)
            indicator.dataset.myEventAdded = 'true' // フラグを設定して再登録を防止
        }
    })

    // `playerSection` 内のDOM変更を監視
    observer.observe(playerSection, {
        childList: true,
        subtree: true,
    })

    // イベントハンドラー関数
    function handleIndicatorClick(e) {
        const emotionButton = document.querySelector('[class*="_emotion-button_"]')
        const lockItemArea = document.querySelector('[class*="_lock-item-area_"]')
        const nageadButton = lockItemArea?.querySelector('[data-content-type="nagead"]')

        if (emotionButton) {
            emotionButton.click()
            setTimeout(() => emotionButton.click(), 100)
        } else if (nageadButton) {
            nageadButton.click()
            setTimeout(() => nageadButton.click(), 100)
        }
    }
}




// 弾幕判定関数
function isDanmakuComment(comment) {
    const totalLength = comment.length
    if (totalLength === 0) return false

    // 通常のコメントを抽出する正規表現
    const regex = /[ぁ-ゟ゠-ヿ一-龯ａ-ｚＡ-Ｚa-zA-Z0-9０-９]/g

    // 弾幕文字の割合を計算
    const danmakuCount = (comment.replace(regex, '') || []).length
    const danmakuRatio = danmakuCount / totalLength

    // 判定
    const isNormalTextHeavy = (Math.round(danmakuRatio * 10) / 10) >= 0.5

    return isNormalTextHeavy
}

// // 矢印（下へ）ボタンがあるかどうか
// function isIndicatorButton() {
//     const playerSection = document.querySelector('[class*="_player-section_"]')
//     const indicator = playerSection?.querySelector('[class*="_indicator_"]')
//     if (!indicator) return false

//     return true
// }

// // 矢印（下へ）ボタンをクリック
// function clickIndicatorButton() {
//     const playerSection = document.querySelector('[class*="_player-section_"]')
//     const indicator = playerSection?.querySelector('[class*="_indicator_"]')
//     if (indicator) indicator.click()
// }


// function testButton() {
//     // ボタンを作成
//     const button = document.createElement('button')
//     button.textContent = 'TEST!'
//     button.style.position = 'fixed'
//     button.style.bottom = '20px'
//     button.style.right = '20px'
//     button.style.padding = '10px 20px'
//     button.style.backgroundColor = '#007bff'
//     button.style.color = '#fff'
//     button.style.border = 'none'
//     button.style.borderRadius = '5px'
//     button.style.cursor = 'pointer'
//     button.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)'
//     button.style.zIndex = '9999'

//     // ボタンにホバー効果を追加
//     button.addEventListener('mouseover', () => {
//         button.style.backgroundColor = '#0056b3'
//     })
//     button.addEventListener('mouseout', () => {
//         button.style.backgroundColor = '#007bff'
//     })

//     // ボタンクリック時の動作を定義
//     button.addEventListener('click', () => {
//         // fix()
//     })

//     // ボタンをドキュメントに追加
//     document.body.appendChild(button)
// }

