// Supabase 配置
var SUPABASE_URL = 'https://ntjcnmsrjqllmaynhasf.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_mM9NXFFP7mtvYz1duoXbEg_i1brWES7';
var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 题库
var questions = [
    { id: 1, description: "形容人非常高兴，像雀儿一样跳跃", answer: "欢呼雀跃" },
    { id: 2, description: "比喻事情很容易做", answer: "易如反掌" },
    { id: 3, description: "形容人勇敢不怕死", answer: "视死如归" },
    { id: 4, description: "形容精神饱满，气概不凡", answer: "神采奕奕" },
    { id: 5, description: "形容办事认真，一点不马虎", answer: "一丝不苟" },
    { id: 6, description: "比喻文章或说话简明扼要", answer: "言简意赅" },
    { id: 7, description: "比喻事情非常顺利，毫无阻碍", answer: "一帆风顺" },
    { id: 8, description: "比喻工作刚开始就取得成功", answer: "旗开得胜" },
    { id: 9, description: "形容情绪低落，失望沮丧", answer: "垂头丧气" },
    { id: 10, description: "形容饮食简单，生活俭朴", answer: "粗茶淡饭" },
    { id: 11, description: "比喻人多，大家议论纷纷", answer: "七嘴八舌" },
    { id: 12, description: "形容注意力高度集中", answer: "聚精会神" },
    { id: 13, description: "比喻没有眼力，分辨不出好坏", answer: "有眼无珠" },
    { id: 14, description: "形容心里慌乱不安", answer: "心神不定" },
    { id: 15, description: "形容盼望得非常急切", answer: "迫不及待" },
    { id: 16, description: "比喻反复无常，变卦迅速", answer: "朝三暮四" },
    { id: 17, description: "比喻事情很难办到", answer: "难如登天" },
    { id: 18, description: "比喻虚有其表，没有真才实学", answer: "名不副实" },
    { id: 19, description: "形容举动慌张，或无法应付", answer: "手忙脚乱" },
    { id: 20, description: "形容十分忠诚", answer: "忠心耿耿" },
    { id: 21, description: "比喻说话算数，决不反悔", answer: "一言为定" },
    { id: 22, description: "比喻从旁帮腔，从旁助势", answer: "摇旗呐喊" },
    { id: 23, description: "比喻白白地浪费精力、时间", answer: "徒劳无功" },
    { id: 24, description: "比喻虽然力量小，只要坚持也能成功", answer: "水滴石穿" },
    { id: 25, description: "形容非常害怕或极度紧张", answer: "心惊胆战" },
    { id: 26, description: "比喻力量太小，无济于事", answer: "杯水车薪" },
    { id: 27, description: "比喻不费力气就能成功", answer: "唾手可得" },
    { id: 28, description: "比喻隐藏才能，不使外露", answer: "深藏不露" },
    { id: 29, description: "形容表面强大，实际虚弱", answer: "外强中干" },
    { id: 30, description: "比喻事情做得干净利落，没有留下痕迹", answer: "干净利落" },
    { id: 31, description: "比喻善于见风使舵，随机应变", answer: "八面玲珑" },
    { id: 32, description: "比喻事情已经发生，无法改变", answer: "木已成舟" },
    { id: 33, description: "形容急于求成", answer: "操之过急" },
    { id: 34, description: "比喻彻底悔改", answer: "洗心革面" },
    { id: 35, description: "比喻行动和目的相反", answer: "南辕北辙" },
    { id: 36, description: "比喻做多余的事，反而不恰当", answer: "画蛇添足" },
    { id: 37, description: "形容军队战斗力强，所向无敌", answer: "势如破竹" },
    { id: 38, description: "比喻从此没有消息", answer: "杳无音信" },
    { id: 39, description: "形容人非常担心或害怕", answer: "忐忑不安" },
    { id: 40, description: "比喻一下子把全部力量拿出来", answer: "倾囊相授" },
    { id: 41, description: "形容人刻苦自励，发愤图强", answer: "卧薪尝胆" },
    { id: 42, description: "比喻勤奋好学", answer: "悬梁刺股" },
    { id: 43, description: "比喻真心诚意，一再邀请", answer: "三顾茅庐" },
    { id: 44, description: "比喻事业蓬勃发展，兴旺昌盛", answer: "蒸蒸日上" },
    { id: 45, description: "比喻年纪虽大，精力依然旺盛", answer: "老当益壮" },
    { id: 46, description: "比喻从小事中看出大道理", answer: "见微知著" },
    { id: 47, description: "比喻真心实意地对待别人", answer: "推心置腹" },
    { id: 48, description: "比喻说话毫无根据", answer: "无稽之谈" },
    { id: 49, description: "形容见解、议论深刻透彻", answer: "入木三分" },
    { id: 50, description: "比喻热心公益，乐于助人", answer: "古道热肠" },
    { id: 51, description: "比喻说话做事有充分理由", answer: "理直气壮" },
    { id: 52, description: "形容遇到危险情况沉着冷静", answer: "临危不乱" },
    { id: 53, description: "比喻先经历艰苦，然后享受幸福", answer: "苦尽甘来" },
    { id: 54, description: "比喻没有做亏心事，心里很坦然", answer: "问心无愧" },
    { id: 55, description: "形容对人真诚热情", answer: "推诚相见" },
    { id: 56, description: "形容心口不一致", answer: "口是心非" },
    { id: 57, description: "比喻彼此相当，不分高下", answer: "旗鼓相当" },
    { id: 58, description: "比喻不顾事实，随意乱说", answer: "信口开河" },
    { id: 59, description: "形容一个人仪表端庄，神采奕奕", answer: "风度翩翩" },
    { id: 60, description: "比喻一个人气量狭小，计较小事", answer: "斤斤计较" }
];

// 游戏状态
var GAME_DURATION = 100;
var score = 0;
var timeLeft = GAME_DURATION;
var currentQuestion = null;
var answeredIds = [];
var timerInterval = null;
var isAnswering = false;

// 屏幕切换
function showScreen(screenId) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
        screens[i].classList.add('hidden');
    }
    document.getElementById(screenId).classList.remove('hidden');
}

function showMenu() {
    showScreen('menu-screen');
}

function showLeaderboard() {
    showScreen('leaderboard-screen');
    loadLeaderboard();
}

// 开始游戏
function startGame() {
    score = 0;
    timeLeft = GAME_DURATION;
    answeredIds = [];
    currentQuestion = null;
    isAnswering = false;

    updateScore();
    updateTimer();
    updateTimerCircle();

    showScreen('game-screen');
    getNextQuestion();
    startTimer();

    setTimeout(function() {
        document.getElementById('answer-input').focus();
    }, 100);
}

// 计时器
function startTimer() {
    timerInterval = setInterval(function() {
        timeLeft--;
        updateTimer();
        updateTimerCircle();
        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function updateTimer() {
    var minutes = Math.floor(timeLeft / 60);
    var seconds = timeLeft % 60;
    document.getElementById('timer').textContent = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

function updateTimerCircle() {
    var circle = document.getElementById('timer-circle');
    var circumference = 2 * Math.PI * 45;
    var offset = circumference * (1 - timeLeft / GAME_DURATION);
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
}

function updateScore() {
    document.getElementById('score').textContent = score;
}

// 获取下一题
function getNextQuestion() {
    var available = [];
    for (var i = 0; i < questions.length; i++) {
        if (answeredIds.indexOf(questions[i].id) === -1) {
            available.push(questions[i]);
        }
    }

    if (available.length === 0) {
        endGame();
        return;
    }

    var randomIndex = Math.floor(Math.random() * available.length);
    currentQuestion = available[randomIndex];

    document.getElementById('question-text').textContent = currentQuestion.description;
    document.getElementById('question-number').textContent = answeredIds.length + 1;
    document.getElementById('answered-count').textContent = answeredIds.length;
}

// 提交答案
function submitAnswer() {
    if (isAnswering || !currentQuestion) return;

    var input = document.getElementById('answer-input');
    var userAnswer = input.value.trim();

    if (!userAnswer) return;

    isAnswering = true;
    input.disabled = true;
    document.getElementById('submit-btn').disabled = true;

    var isCorrect = checkAnswer(userAnswer, currentQuestion.answer);

    if (isCorrect) {
        score++;
        updateScore();
        showFeedback('correct', '回答正确！+1分');
    } else {
        showFeedback('wrong', '正确答案是：' + currentQuestion.answer);
    }

    answeredIds.push(currentQuestion.id);

    setTimeout(function() {
        hideFeedback();
        input.value = '';
        input.disabled = false;
        document.getElementById('submit-btn').disabled = false;
        isAnswering = false;
        getNextQuestion();
        input.focus();
    }, 1500);
}

function checkAnswer(userAnswer, correctAnswer) {
    var normalize = function(str) {
        return str.trim().replace(/\s+/g, '').toLowerCase();
    };
    return normalize(userAnswer) === normalize(correctAnswer);
}

function showFeedback(type, message) {
    var feedback = document.getElementById('feedback');
    feedback.className = 'feedback ' + type;
    feedback.querySelector('.feedback-text').textContent = message;
}

function hideFeedback() {
    document.getElementById('feedback').className = 'feedback hidden';
}

// 结束游戏
function endGame() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    document.getElementById('final-score').textContent = score;
    document.getElementById('total-answered').textContent = answeredIds.length;
    document.getElementById('student-id-input').value = '';
    document.getElementById('nickname-input').value = '';
    hideSubmitMessage();

    showScreen('result-screen');

    setTimeout(function() {
        animateScoreCircle();
    }, 300);
}

function animateScoreCircle() {
    var circle = document.getElementById('score-circle');
    var circumference = 2 * Math.PI * 90;
    var maxScore = Math.min(60, answeredIds.length > 0 ? answeredIds.length : 1);
    var percentage = score / maxScore;
    var offset = circumference * (1 - percentage);
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
}

// 加载排行榜
function loadLeaderboard() {
    var content = document.getElementById('leaderboard-content');
    content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><span>加载中...</span></div>';

    supabaseClient.from('排行榜').select('*').order('分数', { ascending: false }).limit(50)
        .then(function(result) {
            var data = result.data;
            var error = result.error;

            if (error) {
                content.innerHTML = '<div class="no-data">加载失败，请点击刷新重试</div>';
                return;
            }

            if (!data || data.length === 0) {
                content.innerHTML = '<div class="no-data">暂无记录，快来榜上留名！</div>';
                return;
            }

            var html = '<table class="leaderboard-table"><thead><tr><th class="rank-cell">排名</th><th>雅号</th><th class="score-cell">分数</th><th class="time-cell">时间</th></tr></thead><tbody>';

            for (var i = 0; i < data.length; i++) {
                var record = data[i];
                var rank = i + 1;
                var rankClass = 'rank-other';
                var rankDisplay = rank;

                if (rank === 1) { rankClass = 'rank-1'; rankDisplay = '🥇'; }
                else if (rank === 2) { rankClass = 'rank-2'; rankDisplay = '🥈'; }
                else if (rank === 3) { rankClass = 'rank-3'; rankDisplay = '🥉'; }

                html += '<tr>';
                html += '<td class="rank-cell ' + rankClass + '"><span class="rank-badge">' + rankDisplay + '</span></td>';
                html += '<td class="nickname-cell">' + escapeHtml(record.昵称) + '</td>';
                html += '<td class="score-cell"><span class="score-tag ' + (rank <= 3 ? 'top3' : 'normal') + '">' + record.分数 + '</span></td>';
                html += '<td class="time-cell">' + formatDate(record.时间) + '</td>';
                html += '</tr>';
            }

            html += '</tbody></table>';
            content.innerHTML = html;
        })
        .catch(function(err) {
            content.innerHTML = '<div class="no-data">加载失败，请点击刷新重试</div>';
        });
}

// 提交分数
function submitScore() {
    var studentIdInput = document.getElementById('student-id-input');
    var nicknameInput = document.getElementById('nickname-input');
    var studentId = studentIdInput.value.trim();
    var nickname = nicknameInput.value.trim();

    var studentIdError = validateStudentId(studentId);
    if (studentIdError) {
        showSubmitMessage(studentIdError, 'error');
        return;
    }

    var nicknameError = validateNickname(nickname);
    if (nicknameError) {
        showSubmitMessage(nicknameError, 'error');
        return;
    }

    var studentIdNum = parseInt(studentId, 10);
    
    supabaseClient.from('排行榜').select('*').eq('学号', studentIdNum).single()
        .then(function(result) {
            var existingRecord = result.data;
            var queryError = result.error;

            if (queryError && queryError.code !== 'PGRST116') {
                showSubmitMessage('查询失败，请重试', 'error');
                return;
            }

            if (existingRecord) {
                if (score > existingRecord.分数) {
                    return supabaseClient.from('排行榜').update({
                        昵称: nickname,
                        分数: score,
                        时间: new Date().toISOString().split('T')[0]
                    }).eq('学号', studentIdNum);
                } else {
                    showSubmitMessage('未超过历史最高分（' + existingRecord.分数 + '分）', 'error');
                    return Promise.reject('skip');
                }
            } else {
                return supabaseClient.from('排行榜').insert({
                    学号: studentIdNum,
                    昵称: nickname,
                    分数: score,
                    时间: new Date().toISOString().split('T')[0]
                });
            }
        })
        .then(function(result) {
            if (result && result.error) {
                showSubmitMessage('提交失败，请重试', 'error');
            } else if (result) {
                showSubmitMessage('恭喜！榜上留名成功！', 'success');
                studentIdInput.value = '';
                nicknameInput.value = '';
            }
        })
        .catch(function(err) {
            if (err !== 'skip') {
                showSubmitMessage('提交失败，请重试', 'error');
            }
        });
}

function validateStudentId(studentId) {
    if (!/^\d{8}$/.test(studentId)) {
        return '学号必须是8位数字';
    }
    var year = parseInt(studentId.substring(0, 4), 10);
    if (year < 2000) return '学号前四位年份不能早于2000年';
    if (year > new Date().getFullYear()) return '学号前四位年份不能大于当前年份';
    return null;
}

function validateNickname(nickname) {
    if (!nickname || nickname.length === 0) return '请输入你的雅号';
    if (nickname.length > 12) return '雅号不能超过12个字符';
    return null;
}

function showSubmitMessage(message, type) {
    var el = document.getElementById('submit-message');
    el.textContent = message;
    el.className = 'message ' + type;
}

function hideSubmitMessage() {
    document.getElementById('submit-message').className = 'message hidden';
}

function formatDate(dateString) {
    if (!dateString) return '-';
    var date = new Date(dateString);
    var year = date.getFullYear();
    var month = (date.getMonth() + 1).toString();
    var day = date.getDate().toString();
    if (month.length === 1) month = '0' + month;
    if (day.length === 1) day = '0' + day;
    return year + '/' + month + '/' + day;
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 键盘事件
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        var gameScreen = document.getElementById('game-screen');
        if (!gameScreen.classList.contains('hidden') && !isAnswering) {
            submitAnswer();
        }
    }
});

console.log('成语猜猜猜游戏脚本加载完成');
