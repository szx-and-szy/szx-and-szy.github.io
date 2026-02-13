// 成语题库
const idioms = [
    { question: "比喻故意颠倒黑白，混淆是非", answer: "指鹿为马" },
    { question: "比喻说话做事有针对性", answer: "有的放矢" },
    { question: "形容人极有才干和智谋", answer: "足智多谋" },
    { question: "比喻死守狭隘的经验，不知变通", answer: "守株待兔" },
    { question: "比喻真心诚意，一再邀请", answer: "三顾茅庐" },
    { question: "形容声音响亮或事业伟大", answer: "惊天动地" },
    { question: "比喻目光短浅，缺乏远见", answer: "鼠目寸光" },
    { question: "形容事物非常完美，没有缺陷", answer: "十全十美" },
    { question: "比喻行动和目的相反", answer: "南辕北辙" },
    { question: "形容学习勤奋，不知疲倦", answer: "孜孜不倦" },
    { question: "比喻人不可貌相", answer: "人不可貌相" },
    { question: "形容说话或文章简短而有力", answer: "短小精悍" },
    { question: "比喻做事有始无终", answer: "半途而废" },
    { question: "形容人或事物非常突出，与众不同", answer: "出类拔萃" },
    { question: "比喻力量太小，解决不了问题", answer: "杯水车薪" },
    { question: "形容人刻苦自励，发奋图强", answer: "卧薪尝胆" },
    { question: "比喻说话直接，不绕弯子", answer: "开门见山" },
    { question: "形容人或事物变化很大", answer: "翻天覆地" },
    { question: "比喻在困境中急中生智", answer: "急中生智" },
    { question: "形容人非常廉洁，不贪污受贿", answer: "两袖清风" }
];

// Supabase配置
const supabaseUrl = 'https://ntjcnmsrjqllmaynhasf.supabase.co';
const supabaseAnonKey = 'sb_publishable_mM9NXFFP7mtvYz1duoXbEg_i1brWES7';
const supabase = supabase.createClient(supabaseUrl, supabaseAnonKey);

// 游戏变量
let gameTime = 100;
let score = 0;
let timerInterval;
let currentQuestion;

// DOM元素变量
let timerElement;
let scoreElement;
let questionElement;
let answerInput;
let submitAnswerBtn;
let startGameBtn;
let gameContainer;
let resultContainer;
let finalScoreElement;
let resultForm;
let studentIdInput;
let nicknameInput;
let rankingList;

// 初始化
function init() {
    // 获取DOM元素
    timerElement = document.getElementById('timer');
    scoreElement = document.getElementById('score');
    questionElement = document.getElementById('question');
    answerInput = document.getElementById('answer');
    submitAnswerBtn = document.getElementById('submit-answer');
    startGameBtn = document.getElementById('start-game');
    gameContainer = document.getElementById('game-container');
    resultContainer = document.getElementById('result-container');
    finalScoreElement = document.getElementById('final-score');
    resultForm = document.getElementById('result-form');
    studentIdInput = document.getElementById('student-id');
    nicknameInput = document.getElementById('nickname');
    rankingList = document.getElementById('ranking-list');
    
    loadRanking();
    startGameBtn.addEventListener('click', startGame);
    submitAnswerBtn.addEventListener('click', checkAnswer);
    resultForm.addEventListener('submit', submitScore);
    answerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            checkAnswer();
        }
    });
}

// 加载排行榜
async function loadRanking() {
    try {
        const { data, error } = await supabase
            .from('ranking')
            .select('nickname, score, updated_at')
            .order('score', { ascending: false })
            .limit(20);
        
        if (error) {
            throw error;
        }
        
        if (data.length === 0) {
            rankingList.innerHTML = '<p>暂无数据</p>';
            return;
        }
        
        let rankingHTML = '';
        data.forEach((item, index) => {
            const time = new Date(item.updated_at).toLocaleString('zh-CN');
            rankingHTML += `
                <div class="rank-item">
                    <span class="rank">${index + 1}</span>
                    <span class="nickname">${item.nickname}</span>
                    <span class="score">${item.score}</span>
                    <span class="time">${time}</span>
                </div>
            `;
        });
        
        rankingList.innerHTML = rankingHTML;
    } catch (error) {
        console.error('加载排行榜失败:', error);
        rankingList.innerHTML = '<p>加载失败</p>';
    }
}

// 开始游戏
function startGame() {
    // 重置游戏状态
    gameTime = 100;
    score = 0;
    timerElement.textContent = `时间: ${gameTime}秒`;
    scoreElement.textContent = `得分: ${score}`;
    
    // 隐藏开始按钮，显示答题区域
    startGameBtn.style.display = 'none';
    answerInput.disabled = false;
    submitAnswerBtn.disabled = false;
    
    // 生成第一题
    generateQuestion();
    
    // 开始倒计时
    timerInterval = setInterval(() => {
        gameTime--;
        timerElement.textContent = `时间: ${gameTime}秒`;
        
        if (gameTime <= 0) {
            clearInterval(timerInterval);
            endGame();
        }
    }, 1000);
}

// 生成随机题目
function generateQuestion() {
    const randomIndex = Math.floor(Math.random() * idioms.length);
    currentQuestion = idioms[randomIndex];
    questionElement.textContent = currentQuestion.question;
    answerInput.value = '';
    answerInput.focus();
}

// 检查答案
function checkAnswer() {
    const userAnswer = answerInput.value.trim();
    if (userAnswer === currentQuestion.answer) {
        score++;
        scoreElement.textContent = `得分: ${score}`;
    }
    generateQuestion();
}

// 结束游戏
function endGame() {
    clearInterval(timerInterval);
    answerInput.disabled = true;
    submitAnswerBtn.disabled = true;
    startGameBtn.style.display = 'block';
    
    // 显示结果
    finalScoreElement.textContent = score;
    gameContainer.style.display = 'none';
    resultContainer.style.display = 'block';
}

// 验证学号
function validateStudentId(id) {
    // 检查是否为8位数字
    if (!/^\d{8}$/.test(id)) {
        return false;
    }
    
    // 检查前四位是否为年份且不大于当前年份
    const year = parseInt(id.substring(0, 4));
    const currentYear = new Date().getFullYear();
    
    if (isNaN(year) || year < 1900 || year > currentYear) {
        return false;
    }
    
    return true;
}

// 提交分数
async function submitScore(e) {
    e.preventDefault();
    
    const studentId = studentIdInput.value.trim();
    const nickname = nicknameInput.value.trim();
    
    // 验证学号
    if (!validateStudentId(studentId)) {
        alert('学号格式不正确：必须为8位数字，且前4位为有效的年份（不大于当前年份）');
        return;
    }
    
    // 验证昵称
    if (nickname.length > 12) {
        alert('昵称不能超过12个字符');
        return;
    }
    
    try {
        // 检查是否已有记录
        const { data: existingRecord, error: fetchError } = await supabase
            .from('ranking')
            .select('score')
            .eq('student_id', parseInt(studentId))
            .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116表示未找到记录
            throw fetchError;
        }
        
        // 如果已有记录且新分数不高于旧分数，则不更新
        if (existingRecord && score <= existingRecord.score) {
            alert('您的分数没有超过之前的记录');
            resetForm();
            return;
        }
        
        // 插入或更新记录
        let { error };
        if (existingRecord) {
            // 更新记录
            ({ error } = await supabase
                .from('ranking')
                .update({ 
                    nickname, 
                    score, 
                    updated_at: new Date().toISOString() 
                })
                .eq('student_id', parseInt(studentId)));
        } else {
            // 插入新记录
            ({ error } = await supabase
                .from('ranking')
                .insert({ 
                    student_id: parseInt(studentId), 
                    nickname, 
                    score, 
                    updated_at: new Date().toISOString() 
                }));
        }
        
        if (error) {
            throw error;
        }
        
        alert('成绩提交成功！');
        loadRanking();
        resetForm();
    } catch (error) {
        console.error('提交分数失败:', error);
        alert('提交失败，请稍后重试');
    }
}

// 重置表单
function resetForm() {
    resultContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    resultForm.reset();
}

// 当DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', init);
