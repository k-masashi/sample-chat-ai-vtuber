//TODO: meboの定数
const MEBO_API_KEY = "<meboのAPIキーを入力してください。>";
const MEBO_AGENT_ID = "<meboのAgent IDを入力してください。>";

// TODO: VOICEVOXのURL (デフォルトの設定の場合は変える必要なし)
const VOICE_VOX_API_URL = "http://localhost:50021";

// TODO: ライブ配信するYouTubeのVideoID
const YOUTUBE_VIDEO_ID = '<YouTube Video IDを入力してください。>';
// TODO: YouTube Data APIを利用可能なAPIKEY
const YOUTUBE_DATA_API_KEY = '<YouTube Data APIのAPIキーを入力してください。>';

// コメントの取得インターバル (ms)
const INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS = 10000;
// QUEUEに積まれたコメントを捌くインターバル (ms)
const INTERVAL_MILL_SECONDS_HANDLING_COMMENTS = 3000;

// VOICEVOXのSpeakerID
const VOICEVOX_SPEAKER_ID = '10';

var audio = new Audio();
// 処理するコメントのキュー
var liveCommentQueues = [];
// 回答済みのコメントの配列
var responsedLiveComments = [];
// VTuberが応答を考え中であるかどうか
var isThinking = false;
// ライブごとに設定する識別子
var LIVE_OWNER_ID = createUuid();
// NGワードの配列
var ngwords = []
// YouTube LIVEのコメント取得のページング
var nextPageToken = "";
// コメントの取得が開始されているかどうかのフラグ
var isLiveCommentsRetrieveStarted = true;

const getLiveChatId = async () => {
    const response = await fetch('https://youtube.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=' + YOUTUBE_VIDEO_ID + '&key=' + YOUTUBE_DATA_API_KEY, {
        method: 'get',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    const json = await response.json();
    if (json.items.length == 0) {
        return "";
    }
    return json.items[0].liveStreamingDetails.activeLiveChatId
}

const getLiveComments = async (activeLiveChatId) => {
    const response = await fetch('https://youtube.googleapis.com/youtube/v3/liveChat/messages?liveChatId=' + activeLiveChatId + '&part=authorDetails%2Csnippet&key=' + YOUTUBE_DATA_API_KEY, {
        method: 'get',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    const json = await response.json();
    const items = json.items;
    return json.items[0].liveStreamingDetails.activeLiveChatId
}

const startTyping = (param) => {
    let el = document.querySelector(param.el);
    el.textContent = "";
    let speed = param.speed;
    let string = param.string.split("");
    string.forEach((char, index) => {
        setTimeout(() => {
            el.textContent += char;
        }, speed * index);
    });
};

async function getMeboResponse(utterance, username, uid, apikey, agentId) {
    var requestBody = {
        'api_key': apikey,
        'agent_id': agentId,
        'utterance': utterance,
        'username': username,
        'uid': uid,
    }
    const response = await fetch('https://api-mebo.dev/api', {
        method: 'post',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    })
    const content = await response.json();
    return content.bestResponse.utterance;
}

const playVoice = async (inputText) => {
    audio.pause();
    audio.currentTime = 0;
    const ttsQuery = await fetch(VOICE_VOX_API_URL + '/audio_query?speaker=' + VOICEVOX_SPEAKER_ID + '&text=' + encodeURI(inputText), {
        method: 'post',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    if (!ttsQuery) return;
    const queryJson = await ttsQuery.json();
    const response = await fetch(VOICE_VOX_API_URL + '/synthesis?speaker=' + VOICEVOX_SPEAKER_ID + '&speedScale=2', {
        method: 'post',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(queryJson)
    })
    if (!response) return;
    const blob = await response.blob();
    const audioSourceURL = window.URL || window.webkitURL
    audio = new Audio(audioSourceURL.createObjectURL(blob));
    audio.onended = function () {
        setTimeout(handleNewLiveCommentIfNeeded, 1000);
    }
    audio.play();
}

const visibleAIResponse = () => {
    let target = document.getElementById('aiResponse');
    target.style.display = ""
}

const invisibleAIResponse = () => {
    let target = document.getElementById('aiResponse');
    target.style.display = "none"
}

const handleLiveComment = async (comment, username) => {
    isThinking = true;
    visibleAIResponse();
    startTyping({
        el: "#aiResponseUtterance",
        string: "Thinking................",
        speed: 50
    });
    let userCommentElement = document.querySelector("#userComment");
    userCommentElement.textContent = username + ":　" + comment;
    const response = await getMeboResponse(comment, username, LIVE_OWNER_ID, MEBO_API_KEY, MEBO_AGENT_ID);
    isThinking = false;
    if (username == "") {
        await playVoice(response, true, response, false);
    } else {
        await playVoice(username + "さん、" + response, true, response, false);
    }
    startTyping({
        el: "#aiResponseUtterance",
        string: response,
        speed: 50
    });
}

const retrieveYouTubeLiveComments = (activeLiveChatId) => {
    var url = "https://youtube.googleapis.com/youtube/v3/liveChat/messages?liveChatId=" + activeLiveChatId + '&part=authorDetails%2Csnippet&key=' + YOUTUBE_DATA_API_KEY
    if (nextPageToken !== "") {
        url = url + "&pageToken=" + nextPageToken
    }
    fetch(url, {
        method: 'get',
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(
        (response) => {
            return response.json();
        }
    ).then(
        (json) => {
            const items = json.items;
            let index = 0
            nextPageToken = json.nextPageToken;
            items?.forEach(
                (item) => {
                    try {
                        const username = item.authorDetails.displayName;
                        let message = ""
                        if (item.snippet.textMessageDetails != undefined) {
                            // 一般コメント
                            message = item.snippet.textMessageDetails.messageText;
                        }
                        if (item.snippet.superChatDetails != undefined) {
                            // スパチャコメント
                            message = item.snippet.superChatDetails.userComment;
                        }
                        // :::で区切っているが、適宜オブジェクトで格納するように変更する。
                        const additionalComment = username + ":::" + message;
                        if (!liveCommentQueues.includes(additionalComment) && message != "") {
                            let isNg = false
                            ngwords.forEach(
                                (ngWord) => {
                                    if (additionalComment.includes(ngWord)) {
                                        isNg = true
                                    }
                                }
                            )
                            if (!isNg) {
                                if (isLiveCommentsRetrieveStarted) {
                                    liveCommentQueues.push(additionalComment)
                                } else {
                                    responsedLiveComments.push(additionalComment);
                                }
                            }
                        }
                    } catch {
                        // Do Nothing
                    }
                    index = index + 1
                }
            )
        }
    ).finally(
        () => {
            setTimeout(retrieveYouTubeLiveComments, INTERVAL_MILL_SECONDS_RETRIEVING_COMMENTS, activeLiveChatId);
        }
    )
}

const getNextComment = () => {
    let nextComment = ""
    let nextRaw = ""
    for (let index in liveCommentQueues) {
        if (!responsedLiveComments.includes(liveCommentQueues[index])) {
            const arr = liveCommentQueues[index].split(":::")
            if (arr.length > 1) {
                nextComment = arr[0] + "さんから、「" + arr[1] + "」というコメントが届いているよ。"
                nextRaw = arr[1]
                break;
            }
        }
    }
    return [nextComment, nextRaw];
}

const handleNewLiveCommentIfNeeded = async () => {
    if (liveCommentQueues.length == 0) {
        // QUEUEがなければ何もしない
        setTimeout(handleNewLiveCommentIfNeeded, INTERVAL_MILL_SECONDS_HANDLING_COMMENTS);
        return;
    }

    if (isThinking) {
        // VTuberが応答を考えているときは新規コメントを捌かない
        setTimeout(handleNewLiveCommentIfNeeded, INTERVAL_MILL_SECONDS_HANDLING_COMMENTS);
        return;
    }

    if (!audio.ended) {
        // VTuberが声を発しているときは新規コメントを捌かない
        setTimeout(handleNewLiveCommentIfNeeded, INTERVAL_MILL_SECONDS_HANDLING_COMMENTS);
        return;
    }

    for (let index in liveCommentQueues) {
        if (!responsedLiveComments.includes(liveCommentQueues[index])) {
            const arr = liveCommentQueues[index].split(":::")
            if (arr.length > 1) {
                responsedLiveComments.push(liveCommentQueues[index]);
                isThinking = true;
                await handleLiveComment(arr[1], arr[0]);
                break;
            }
        }
    }
    setTimeout(handleNewLiveCommentIfNeeded, 5000);
}

const onClickSend = () => {
    let utterance = document.querySelector("#utterance");
    handleLiveComment(utterance.value, '匿名');
    utterance.value = "";
}

// LIVEを開始する
const startLive = () => {
    // 明示的にボタンをクリックする等しなければ、音声が再生できない。そのためLIVE開始ボタンを下記のIDで設置する。
    let startLiveButton = document.querySelector("#startLiveButton");
    startLiveButton.style.display = "none";
    let submitForm = document.querySelector("#submit_form");
    submitForm.style.display = "none";
    getLiveChatId().then(
        (id) => {
            retrieveYouTubeLiveComments(id);
        }
    )
    //LIVE開始時は空文字を送信することで、meboで設定した初回メッセージが返される。
    handleLiveComment('', '');
    blink();
}

const img = ["chara.png", "chara_blinking.png"];
var isBlinking = false;

function blink() {
    if (isBlinking) {
        isBlinking = false;
        document.getElementById("charaImg").src = img[1];
        setTimeout(blink, 100);
    } else {
        isBlinking = true;
        document.getElementById("charaImg").src = img[0];
        setTimeout(blink, 3500);
    }
}

function createUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (a) {
        let r = (new Date().getTime() + Math.random() * 16) % 16 | 0, v = a == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}