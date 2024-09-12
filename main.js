// デフォルトサイズ
const defaultCommentNumberFontSize = '100%'
const defaultCommentTextFontSize = '100%'

// 初期値を chrome.storage から取得
let commentNumberFontSize = defaultCommentNumberFontSize
let commentTextFontSize = defaultCommentTextFontSize

chrome.storage.sync.get(['commentNumberFontSize', 'commentTextFontSize'], (result) => {
    commentNumberFontSize = result.commentNumberFontSize || defaultCommentNumberFontSize
    commentTextFontSize = result.commentTextFontSize || defaultCommentTextFontSize
    updateCommentStyles() // 設定値が取得された後にスタイルを更新
});

window.addEventListener('load', function () {
    // 監視対象の要素の親ノード
    const parentNode = document.body

    if (parentNode) {
        // 設定画面を追加
        const contentsArea = document.querySelector('[class*="_contents-area_"]')
        if (contentsArea) {
            insertSliders(contentsArea) // 設定画面を挿入
        }

        insertToggleButton() // トグルボタンをaddon-controller内に挿入

        parentNode.querySelectorAll('.table-row').forEach(target => {
            ChangeCommentsStyle(target)
        })

        // 要素の挿入を監視
        checkElementInsert(parentNode)
    }
});

/**
 * 設定画面を挿入
 */
function insertSliders(targetElement) {
    const sliderContainer = document.createElement('div')
    sliderContainer.classList.add('setting-container') // 設定画面の表示/非表示用にクラスを追加
    sliderContainer.style.display = 'none' // 初期状態

    sliderContainer.innerHTML = `
        <div style="padding:10px; border-top: 1px solid #ccc;">
            <label>番号: <span id="comment-number-size">${commentNumberFontSize}</span></label>
            <input id="commentNumberSlider" type="range" min="50" max="300" value="${parseInt(commentNumberFontSize)}" style="width: 100%;">
            <br>
            <label>コメント: <span id="comment-text-size">${commentTextFontSize}</span></label>
            <input id="commentTextSlider" type="range" min="50" max="300" value="${parseInt(commentTextFontSize)}" style="width: 100%;">
        </div>
    `
    targetElement.parentNode.insertBefore(sliderContainer, targetElement.nextSibling)

    // 設定画面のイベントリスナーを追加
    const commentNumberSlider = document.getElementById('commentNumberSlider')
    const commentTextSlider = document.getElementById('commentTextSlider')
    const commentNumberSizeLabel = document.getElementById('comment-number-size')
    const commentTextSizeLabel = document.getElementById('comment-text-size')

    commentNumberSlider.addEventListener('input', function () {
        commentNumberFontSize = this.value + '%'
        commentNumberSizeLabel.textContent = commentNumberFontSize
        chrome.storage.sync.set({ commentNumberFontSize }) // chrome.storageに保存
        updateCommentStyles()
    })

    commentTextSlider.addEventListener('input', function () {
        commentTextFontSize = this.value + '%'
        commentTextSizeLabel.textContent = commentTextFontSize
        chrome.storage.sync.set({ commentTextFontSize }) // chrome.storageに保存
        updateCommentStyles()
    })

    // ダブルクリックでデフォルトサイズにリセット
    commentNumberSlider.addEventListener('dblclick', function () {
        commentNumberFontSize = defaultCommentNumberFontSize
        commentNumberSizeLabel.textContent = commentNumberFontSize
        commentNumberSlider.value = parseInt(defaultCommentNumberFontSize)
        chrome.storage.sync.set({ commentNumberFontSize }) // chrome.storageに保存
        updateCommentStyles()
    })

    commentTextSlider.addEventListener('dblclick', function () {
        commentTextFontSize = defaultCommentTextFontSize
        commentTextSizeLabel.textContent = commentTextFontSize
        commentTextSlider.value = parseInt(defaultCommentTextFontSize)
        chrome.storage.sync.set({ commentTextFontSize }) // chrome.storageに保存
        updateCommentStyles()
    })

    // ホイールイベントを追加
    const handleMouseWheel = (event, slider, sizeLabel, fontSizeKey) => {
        event.preventDefault() // デフォルトのスクロールを無効化
        const step = 1 // サイズ変更のステップ
        let newValue = parseInt(slider.value) + (event.deltaY > 0 ? step : -step)
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
        updateCommentStyles() // スタイルを更新
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
 * スタイルのリアルタイム更新
 */
function updateCommentStyles() {
    const parentNode = document.body
    parentNode.querySelectorAll('.table-row').forEach(target => {
        ChangeCommentsStyle(target)
    })
}

/**
 * 要素の挿入を監視
 */
const checkElementInsert = (parentNode) => {
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

            attachStyle(targets)
        })
    })

    // MutationObserverを開始
    observer.observe(parentNode, { childList: true, subtree: true })
}

/**
 * スタイルを適用
 */
const attachStyle = (targets) => {
    targets.forEach(target => {
        // target が ELEMENT_NODE でない場合はスキップ
        if (target.nodeType !== Node.ELEMENT_NODE) return

        ChangeCommentsStyle(target)
    })
}

/**
 * コメントのスタイルを変更
 */
const ChangeCommentsStyle = (target) => {
    if (!target.classList.contains('table-row')) return

    const commentNumber = target.querySelector('.comment-number')
    if (commentNumber) {
        commentNumber.style.fontSize = commentNumberFontSize
    }

    const commentText = target.querySelector('.comment-text')
    if (commentText) {
        commentText.style.fontSize = commentTextFontSize
    }
}
