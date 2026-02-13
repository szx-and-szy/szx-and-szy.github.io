// ==================== Supabase 配置 ====================
const SUPABASE_URL = 'https://ntjcnmsrjqllmaynhasf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_mM9NXFFP7mtvYz1duoXbEg_i1brWES7';

// 创建 Supabase 客户端
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================== 题库（60道成语） ====================
const questions = [
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
    { id: 60, description: "比喻一个人气量狭小，计较小事", answer: "斤斤计较" },
];

// ==================== 游戏状态变量 ====================
const GAME_DURATION = 100;
const MAX_QUESTIONS = 60;

let score = 0;
let timeLeft = GAME_DURATION;
let currentQuestion = null;
let answeredIds = [];
let timerInterval = null;
let isAnswering = false;

// ==================== 屏幕切换 ====================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

function showMenu() {
    showScreen('menu-screen');
}

function showLeaderboard() {
    showScreen('leaderboard-screen');
    loadLeaderboard();
}

// ==================== 游戏逻辑 ====================
function startGame() {
    // 重置游戏状态
    score = 0;
    timeLeft = GAME_DURATION;
    answeredIds = [];
    currentQuestion = null;
    isAnswering = false;

    // 更新显示
    updateScore();
    updateTimer();
    updateTimerCircle();

    // 切换到游戏界面
    showScreen('game-screen');

    // 获取第一道题
    getNextQuestion();

    // 启动计时器
    startTimer();

    // 聚焦输入框
    setTimeout(() => {
        document.getElementById('answer-input').focus();
    }, 100);
}

function startTimer() {
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimer();
        updateTimerCircle();

        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function updateTimer() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('timer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateTimerCircle() {
    const circle = document.getElementById('timer-circle');
    const circumference = 2 * Math.PI * 45; // r = 45
    const offset = circumference * (1 - timeLeft / GAME_DURATION);
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
}

function updateScore() {
    document.getElementById('score').textContent = score;
}

function getNextQuestion() {
    const available = questions.filter(q => !answeredIds.includes(q.id));

    if (available.length === 0) {
        endGame();
        return;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    currentQuestion = available[randomIndex];

    // 更新题目显示
    document.getElementById('question-text').textContent = currentQuestion.description;
    document.getElementById('question-number').textContent = answeredIds.length + 1;
    document.getElementById('answered-count').textContent = answeredIds.length;
}

function submitAnswer() {
    if (isAnswering || !currentQuestion) return;

    const input = document.getElementById('answer-input');
    const userAnswer = input.value.trim();

    if (!userAnswer) return;

    isAnswering = true;
    input.disabled = true;
    document.getElementById('submit-btn').disabled = true;

    // 检查答案
    const isCorrect = checkAnswer(userAnswer, currentQuestion.answer);

    if (isCorrect) {
        score++;
        updateScore();
        showFeedback('correct', '回答正确！+1分');
    } else {
        showFeedback('wrong', `正确答案是：${currentQuestion.answer}`);
    }

    // 记录已回答
    answeredIds.push(currentQuestion.id);

    // 1.5秒后显示下一题
    setTimeout(() => {
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
    const normalize = (str) => str.trim().replace(/\s+/g, '').toLowerCase();
    return normalize(userAnswer) === normalize(correctAnswer);
}

function showFeedback(type, message) {
    const feedback = document.getElementById('feedback');
    feedback.className = `feedback ${type}`;
    feedback.querySelector('.feedback-text').textContent = message;
}

function hideFeedback() {
    document.getElementById('feedback').className = 'feedback hidden';
}

function endGame() {
    // 停止计时器
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // 显示结果
    document.getElementById('final-score').textContent = score;
    document.getElementById('total-answered').textContent = answeredIds.length;

    // 清空输入
    document.getElementById('student-id-input').value = '';
    document.getElementById('nickname-input').value = '';
    hideSubmitMessage();

    // 切换到结果界面
    showScreen('result-screen');

    // 动画显示分数圆环
    setTimeout(() => {
        animateScoreCircle();
    }, 300);
}

function animateScoreCircle() {
    const circle = document.getElementById('score-circle');
    const circumference = 2 * Math.PI * 90; // r = 90
    const maxScore = Math.min(MAX_QUESTIONS, answeredIds.length > 0 ? answeredIds.length : 1);
    const percentage = score / maxScore;
    const offset = circumference * (1 - percentage);
    
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;
}

// ==================== 排行榜 ====================
async function loadLeaderboard() {
    const content = document.getElementById('leaderboard-content');
    content.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
        </div>
    `;

    try {
        const { data, error } = await supabase
            .from('leaderboard')
            .select('*')
            .order('score', { ascending: false })
            .limit(50);

        if (error) {
            content.innerHTML = '<div class="no-data">加载失败，请点击刷新重试</div>';
            return;
        }

        if (!data || data.length === 0) {
            content.innerHTML = '<div class="no-data">暂无记录，快来榜上留名！</div>';
            return;
        }

        // 生成表格
        let html = `
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th class="rank-cell">排名</th>
                        <th>雅号</th>
                        <th class="score-cell">分数</th>
                        <th class="time-cell">时间</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach((record, index) => {
            const rank = index + 1;
            let rankClass = 'rank-other';
            let rankDisplay = rank;
            
            if (rank === 1) {
                rankClass = 'rank-1';
                rankDisplay = '🥇';
            } else if (rank === 2) {
                rankClass = 'rank-2';
                rankDisplay = '🥈';
            } else if (rank === 3) {
                rankClass = 'rank-3';
                rankDisplay = '🥉';
            }
            
            const scoreTagClass = rank <= 3 ? 'top3' : 'normal';
            const time = formatDate(record.updated_at);

            html += `
                <tr>
                    <td class="rank-cell ${rankClass}">
                        <span class="rank-badge">${rankDisplay}</span>
                    </td>
                    <td class="nickname-cell">${escapeHtml(record.nickname)}</td>
                    <td class="score-cell">
                        <span class="score-tag ${scoreTagClass}">${record.score}</span>
                    </td>
                    <td class="time-cell">${time}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        content.innerHTML = html;

    } catch (err) {
        content.innerHTML = '<div class="no-data">加载失败，请点击刷新重试</div>';
    }
}

// ==================== 提交分数 ====================
async function submitScore() {
    const studentIdInput = document.getElementById('student-id-input');
    const nicknameInput = document.getElementById('nickname-input');

    const studentId = studentIdInput.value.trim();
    const nickname = nicknameInput.value.trim();

    // 验证学号
    const studentIdError = validateStudentId(studentId);
    if (studentIdError) {
        showSubmitMessage(studentIdError, 'error');
        return;
    }

    // 验证昵称
    const nicknameError = validateNickname(nickname);
    if (nicknameError) {
        showSubmitMessage(nicknameError, 'error');
        return;
    }

    try {
        // 查询是否已存在记录
        const { data: existingRecord, error: queryError } = await supabase
            .from('leaderboard')
            .select('*')
            .eq('student_id', studentId)
            .single();

        if (queryError && queryError.code !== 'PGRST116') {
            showSubmitMessage('查询失败，请重试', 'error');
            return;
        }

        if (existingRecord) {
            // 记录已存在，只有当新分数更高时才更新
            if (score > existingRecord.score) {
                const { error: updateError } = await supabase
                    .from('leaderboard')
                    .update({
                        nickname: nickname,
                        score: score,
                        updated_at: new Date().toISOString()
                    })
                    .eq('student_id', studentId);

                if (updateError) {
                    showSubmitMessage('更新失败，请重试', 'error');
                } else {
                    showSubmitMessage('恭喜！成绩已更新！', 'success');
                    studentIdInput.value = '';
                    nicknameInput.value = '';
                }
            } else {
                showSubmitMessage(`未超过历史最高分（${existingRecord.score}分）`, 'error');
            }
        } else {
            // 新记录，直接插入
            const { error: insertError } = await supabase
                .from('leaderboard')
                .insert({
                    student_id: studentId,
                    nickname: nickname,
                    score: score,
                    updated_at: new Date().toISOString()
                });

            if (insertError) {
                showSubmitMessage('提交失败，请重试', 'error');
            } else {
                showSubmitMessage('恭喜！榜上留名成功！', 'success');
                studentIdInput.value = '';
                nicknameInput.value = '';
            }
        }
    } catch (err) {
        showSubmitMessage('提交失败，请重试', 'error');
    }
}

function validateStudentId(studentId) {
    if (!/^\d{8}$/.test(studentId)) {
        return '学号必须是8位数字';
    }

    const year = parseInt(studentId.substring(0, 4), 10);
    const currentYear = new Date().getFullYear();

    if (year < 2000) {
        return '学号前四位年份不能早于2000年';
    }

    if (year > currentYear) {
        return '学号前四位年份不能大于当前年份';
    }

    return null;
}

function validateNickname(nickname) {
    if (!nickname || nickname.length === 0) {
        return '请输入你的雅号';
    }

    if (nickname.length > 12) {
        return '雅号不能超过12个字符';
    }

    return null;
}

function showSubmitMessage(message, type) {
    const msgElement = document.getElementById('submit-message');
    msgElement.textContent = message;
    msgElement.className = `message ${type}`;
}

function hideSubmitMessage() {
    document.getElementById('submit-message').className = 'message hidden';
}

// ==================== 工具函数 ====================
function formatDate(dateString) {
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hour}:${minute}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 键盘事件 ====================
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const gameScreen = document.getElementById('game-screen');
        if (!gameScreen.classList.contains('hidden') && !isAnswering) {
            submitAnswer();
        }
    }
});

// ==================== 页面加载完成 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 初始化
});
