// ============================================================
// LEXICON LAB — app logic
// No backend required: speech synthesis/recognition run in the
// browser, progress persists in localStorage.
// ============================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'lexiconlab_progress_v1';
  const GRAMMAR_KEY = 'lexiconlab_grammar_progress_v1';
  const REVIEW_KEY = 'lexiconlab_review_v1';
  const STREAK_KEY = 'lexiconlab_streak_v1';
  const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 14]; // Leitner box 1..5

  const state = {
    view: 'dashboard',
    lessonIdx: 0,
    phraseIdx: 0,
    scores: [],       // scores collected during the current lesson run
    lastHeard: '',
    speaking: false,
    // grammar
    gLessonIdx: 0,
    gExerciseIdx: 0,
    gScores: [],
    gAnswered: false,
    // review
    reviewQueue: [],
    reviewIdx: 0,
    reviewRevealed: false,
    // module intro / gating
    pendingModule: null, // { type: 'speaking'|'grammar', index: number }
  };

  // ---------- persistence ----------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }
  function saveProgress(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }
  function recordPhraseScore(lessonId, phraseIdx, score) {
    const p = loadProgress();
    p[lessonId] = p[lessonId] || {};
    const prevBest = p[lessonId][phraseIdx] || 0;
    p[lessonId][phraseIdx] = Math.max(prevBest, score);
    saveProgress(p);
    bumpStreak();
  }
  const MASTERY_THRESHOLD = 80;

  function isSpeakingLessonComplete(lesson) {
    const p = loadProgress();
    const entry = p[lesson.id];
    if (!entry) return false;
    for (let i = 0; i < lesson.phrases.length; i++) {
      if (!(entry[i] >= MASTERY_THRESHOLD)) return false;
    }
    return true;
  }
  function isGrammarLessonComplete(lesson) {
    const p = loadGrammarProgress();
    const entry = p[lesson.id];
    if (!entry) return false;
    for (let i = 0; i < lesson.exercises.length; i++) {
      if (entry[i] !== 1) return false;
    }
    return true;
  }
  // Module N is unlocked once module N-1 (of the same type) is 100% complete.
  function isSpeakingUnlocked(index) {
    return index === 0 || isSpeakingLessonComplete(LESSONS[index - 1]);
  }
  function isGrammarUnlocked(index) {
    return index === 0 || isGrammarLessonComplete(GRAMMAR_LESSONS[index - 1]);
  }

  function lessonAverage(lessonId, phraseCount) {
    const p = loadProgress();
    const entry = p[lessonId];
    if (!entry) return 0;
    const vals = Object.values(entry);
    if (!vals.length) return 0;
    const sum = vals.reduce((a, b) => a + b, 0);
    return Math.round(sum / phraseCount);
  }
  function totalMastered() {
    const p = loadProgress();
    let count = 0;
    Object.values(p).forEach(lesson => {
      Object.values(lesson).forEach(score => { if (score >= 80) count++; });
    });
    return count + totalGrammarCorrect();
  }

  function loadGrammarProgress() {
    try { return JSON.parse(localStorage.getItem(GRAMMAR_KEY)) || {}; }
    catch { return {}; }
  }
  function saveGrammarProgress(p) {
    localStorage.setItem(GRAMMAR_KEY, JSON.stringify(p));
  }
  function recordGrammarResult(lessonId, exerciseIdx, correct) {
    const p = loadGrammarProgress();
    p[lessonId] = p[lessonId] || {};
    const prevBest = p[lessonId][exerciseIdx] || 0;
    p[lessonId][exerciseIdx] = Math.max(prevBest, correct ? 1 : 0);
    saveGrammarProgress(p);
    bumpStreak();
  }
  function grammarLessonAverage(lessonId, exerciseCount) {
    const p = loadGrammarProgress();
    const entry = p[lessonId];
    if (!entry) return 0;
    const vals = Object.values(entry);
    if (!vals.length) return 0;
    const sum = vals.reduce((a, b) => a + b, 0);
    return Math.round((sum / exerciseCount) * 100);
  }
  function totalGrammarCorrect() {
    const p = loadGrammarProgress();
    let count = 0;
    Object.values(p).forEach(lesson => {
      Object.values(lesson).forEach(v => { if (v === 1) count++; });
    });
    return count;
  }

  // ---------- spaced repetition deck (Leitner system) ----------
  function loadReviewDeck() {
    try { return JSON.parse(localStorage.getItem(REVIEW_KEY)) || {}; }
    catch { return {}; }
  }
  function saveReviewDeck(d) {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(d));
  }
  // Called automatically whenever a speaking phrase is scored.
  function addOrUpdateReviewItem(id, data, wasGood) {
    const deck = loadReviewDeck();
    const existing = deck[id];
    let box = existing ? existing.box : 0;
    box = wasGood ? Math.min(box + 1, 5) : 1;
    if (!existing && !wasGood) box = 1;
    const nextReview = Date.now() + REVIEW_INTERVALS_DAYS[box - 1] * 86400000;
    deck[id] = { text: data.text, ipa: data.ipa, ru: data.ru, box, nextReview };
    saveReviewDeck(deck);
  }
  // Called from a dedicated review session after the user self-rates recall.
  function rateReviewItem(id, rating) {
    const deck = loadReviewDeck();
    const item = deck[id];
    if (!item) return;
    if (rating === 'forgot') item.box = 1;
    else if (rating === 'good') item.box = Math.min(item.box + 1, 5);
    else if (rating === 'easy') item.box = Math.min(item.box + 2, 5);
    item.nextReview = Date.now() + REVIEW_INTERVALS_DAYS[item.box - 1] * 86400000;
    saveReviewDeck(deck);
    bumpStreak();
  }
  function getDueReviewItems() {
    const deck = loadReviewDeck();
    const now = Date.now();
    return Object.entries(deck)
      .filter(([, v]) => v.nextReview <= now)
      .sort((a, b) => a[1].nextReview - b[1].nextReview)
      .map(([id, v]) => ({ id, ...v }));
  }
  function getDeckSize() { return Object.keys(loadReviewDeck()).length; }
  function bumpStreak() {
    const today = new Date().toDateString();
    let s;
    try { s = JSON.parse(localStorage.getItem(STREAK_KEY)) || { last: null, count: 0 }; }
    catch { s = { last: null, count: 0 }; }
    if (s.last === today) return; // already counted today
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    s.count = (s.last === yesterday) ? s.count + 1 : 1;
    s.last = today;
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  }
  function getStreak() {
    try {
      const s = JSON.parse(localStorage.getItem(STREAK_KEY));
      return s ? s.count : 0;
    } catch { return 0; }
  }

  // ---------- speech synthesis (listening) ----------
  function speak(text, rate) {
    if (!('speechSynthesis' in window)) {
      toast('Синтез речи не поддерживается в этом браузере');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = rate || 1;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang && v.lang.startsWith('en'));
    if (enVoice) utter.voice = enVoice;
    return utter;
  }

  function playWithWave(text, rate, waveEl, btnEl) {
    const utter = speak(text, rate);
    if (!utter) return;
    waveEl && waveEl.classList.add('is-active');
    btnEl && btnEl.setAttribute('disabled', 'true');
    utter.onend = utter.onerror = () => {
      waveEl && waveEl.classList.remove('is-active');
      btnEl && btnEl.removeAttribute('disabled');
    };
    window.speechSynthesis.speak(utter);
  }

  // ---------- speech recognition (speaking) ----------
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognitionSupported = !!SpeechRecognitionImpl;
  let recognizer = null;
  if (recognitionSupported) {
    recognizer = new SpeechRecognitionImpl();
    recognizer.lang = 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
  }

  // ---------- scoring: normalized similarity 0-100 ----------
  function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[m][n];
  }
  function similarityScore(target, heard) {
    const a = normalize(target), b = normalize(heard);
    if (!b) return 0;
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length) || 1;
    return Math.max(0, Math.round((1 - dist / maxLen) * 100));
  }

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const viewDash = $('view-dashboard');
  const viewIntro = $('view-intro');
  const viewLesson = $('view-lesson');
  const viewGrammar = $('view-grammar');
  const viewReview = $('view-review');
  const viewComplete = $('view-complete');
  const toastEl = $('toast');

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  // ---------- render: header stats ----------
  function renderStats() {
    $('streakValue').textContent = getStreak();
    $('masteredValue').textContent = totalMastered();
  }

  // ---------- render: dashboard ----------
  function renderDashboard() {
    const dayIdx = Math.floor(Date.now() / 86400000) % ENTRY_OF_DAY.length;
    const entry = ENTRY_OF_DAY[dayIdx];
    $('entryHeadword').textContent = entry.text;
    $('entryIpa').textContent = entry.ipa;
    $('entryTranslation').textContent = entry.ru;

    const grid = $('lessonGrid');
    grid.innerHTML = '';
    LESSONS.forEach((lesson, idx) => {
      const avg = lessonAverage(lesson.id, lesson.phrases.length);
      const unlocked = isSpeakingUnlocked(idx);
      const complete = unlocked && isSpeakingLessonComplete(lesson);
      const tile = document.createElement('button');
      tile.className = 'lesson-tile' + (unlocked ? '' : ' is-locked');
      tile.innerHTML = `
        <p class="lesson-tile__num">Модуль ${String(idx + 1).padStart(2, '0')}</p>
        <h3 class="lesson-tile__title">${lesson.title}</h3>
        <div class="lesson-tile__meta">
          <span class="${complete ? 'lesson-tile__done' : unlocked ? 'lesson-tile__count' : 'lesson-tile__lock'}">
            ${complete ? '✓ пройден' : unlocked ? lesson.phrases.length + ' фраз' : '🔒 заблокирован'}
          </span>
          <div class="lesson-tile__bar"><div class="lesson-tile__bar-fill" style="width:${avg}%"></div></div>
        </div>`;
      tile.addEventListener('click', () => {
        if (!unlocked) { toast('Сначала завершите предыдущий модуль на 100%'); return; }
        openModuleIntro('speaking', idx);
      });
      grid.appendChild(tile);
    });

    const gGrid = $('grammarGrid');
    gGrid.innerHTML = '';
    GRAMMAR_LESSONS.forEach((lesson, idx) => {
      const avg = grammarLessonAverage(lesson.id, lesson.exercises.length);
      const unlocked = isGrammarUnlocked(idx);
      const complete = unlocked && isGrammarLessonComplete(lesson);
      const tile = document.createElement('button');
      tile.className = 'lesson-tile' + (unlocked ? '' : ' is-locked');
      tile.innerHTML = `
        <p class="lesson-tile__num">Грамматика ${String(idx + 1).padStart(2, '0')}</p>
        <h3 class="lesson-tile__title">${lesson.title}</h3>
        <p class="lesson-tile__count" style="display:block;margin:0 0 10px;">${lesson.description}</p>
        <div class="lesson-tile__meta">
          <span class="${complete ? 'lesson-tile__done' : unlocked ? 'lesson-tile__count' : 'lesson-tile__lock'}">
            ${complete ? '✓ пройден' : unlocked ? lesson.exercises.length + ' упражнений' : '🔒 заблокирован'}
          </span>
          <div class="lesson-tile__bar"><div class="lesson-tile__bar-fill" style="width:${avg}%"></div></div>
        </div>`;
      tile.addEventListener('click', () => {
        if (!unlocked) { toast('Сначала завершите предыдущий модуль на 100%'); return; }
        openModuleIntro('grammar', idx);
      });
      gGrid.appendChild(tile);
    });

    renderReviewDashboard();
  }

  // ---------- module intro screen ----------
  function openModuleIntro(type, index) {
    state.pendingModule = { type, index };
    let title, eyebrow, points, examples;
    if (type === 'speaking') {
      const lesson = LESSONS[index];
      title = lesson.title;
      eyebrow = `Модуль ${String(index + 1).padStart(2, '0')} · Разговорная практика`;
      points = lesson.intro.points;
      examples = lesson.phrases.slice(0, 2).map(p => ({ en: p.text, ru: p.ru }));
    } else {
      const lesson = GRAMMAR_LESSONS[index];
      const rule = RULES.find(r => r.grammarId === lesson.id);
      title = lesson.title;
      eyebrow = `Грамматика ${String(index + 1).padStart(2, '0')}`;
      points = rule ? rule.points : [lesson.description];
      examples = rule ? rule.examples : [];
    }
    $('introEyebrow').textContent = eyebrow;
    $('introTitle').textContent = title;
    $('introPoints').innerHTML = points.map(p => `<li>${p}</li>`).join('');
    $('introExamples').innerHTML = examples.map(ex => `
      <div class="rule-card__example">
        <p class="rule-card__example-en">${ex.en}</p>
        <p class="rule-card__example-ru">${ex.ru}</p>
      </div>`).join('');
    switchView('intro');
  }

  // ---------- lesson flow ----------
  function startLesson(idx) {
    state.lessonIdx = idx;
    state.phraseIdx = 0;
    state.scores = [];
    switchView('lesson');
    renderPhrase();
  }

  function currentLesson() { return LESSONS[state.lessonIdx]; }
  function currentPhrase() { return currentLesson().phrases[state.phraseIdx]; }

  function renderPhrase() {
    const lesson = currentLesson();
    const phrase = currentPhrase();
    $('phraseTag').textContent = lesson.title;
    $('phraseText').textContent = phrase.text;
    $('phraseIpa').textContent = phrase.ipa;
    $('phraseTranslation').textContent = phrase.ru;
    $('micHint').textContent = recognitionSupported ? '' : 'Распознавание речи не поддерживается — можно ввести фразу вручную.';
    $('lessonCount').textContent = `${state.phraseIdx + 1} / ${lesson.phrases.length}`;
    $('lessonProgressFill').style.width = `${(state.phraseIdx / lesson.phrases.length) * 100}%`;
    $('feedback').classList.remove('is-visible');
    $('phraseWave').classList.remove('is-active');
    resetSpeakButton();
  }

  function resetSpeakButton() {
    const btn = $('btnSpeak');
    btn.classList.remove('is-recording');
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-2.07A7 7 0 0 0 19 12z" fill="currentColor"/></svg> Повторить вслух`;
  }

  function showFeedback(heardText, score) {
    $('feedbackHeard').textContent = heardText || '—';
    $('feedbackScore').textContent = score + '%';
    const ring = $('feedbackRing');
    const circumference = 119;
    ring.style.strokeDashoffset = circumference - (circumference * score) / 100;
    ring.style.stroke = score >= 80 ? 'var(--sage)' : score >= 50 ? 'var(--amber)' : 'var(--coral)';
    const note = $('feedbackNote');
    if (score >= 80) note.textContent = 'Отлично! Произношение узнаваемо и чётко.';
    else if (score >= 50) note.textContent = 'Неплохо. Прослушайте ещё раз и попробуйте повторить точнее.';
    else note.textContent = 'Прослушайте фразу внимательно и попробуйте снова — по слогам, если нужно.';
    $('feedback').classList.add('is-visible');
  }

  function handleSpeechResult(transcript) {
    const score = similarityScore(currentPhrase().text, transcript);
    state.scores.push(score);
    recordPhraseScore(currentLesson().id, state.phraseIdx, score);
    addOrUpdateReviewItem(`${currentLesson().id}:${state.phraseIdx}`, currentPhrase(), score >= 70);
    showFeedback(transcript, score);
    renderStats();
  }

  function startRecording() {
    const btn = $('btnSpeak');
    if (!recognitionSupported) {
      const typed = window.prompt('Речевой ввод недоступен в этом браузере.\nВведите фразу так, как вы бы её произнесли:');
      if (typed !== null) handleSpeechResult(typed);
      return;
    }
    btn.classList.add('is-recording');
    btn.innerHTML = '<span>Слушаю…</span>';
    $('phraseWave').classList.add('is-active', 'is-listening');

    let finished = false;
    recognizer.onresult = (e) => {
      finished = true;
      const transcript = e.results[0][0].transcript;
      handleSpeechResult(transcript);
    };
    recognizer.onerror = () => {
      finished = true;
      toast('Не удалось распознать речь. Попробуйте ещё раз.');
    };
    recognizer.onend = () => {
      resetSpeakButton();
      $('phraseWave').classList.remove('is-active', 'is-listening');
      if (!finished) toast('Речь не обнаружена.');
    };
    try { recognizer.start(); }
    catch { toast('Микрофон уже используется.'); resetSpeakButton(); }
  }

  function nextPhrase() {
    const lesson = currentLesson();
    if (state.phraseIdx < lesson.phrases.length - 1) {
      state.phraseIdx++;
      renderPhrase();
    } else {
      finishLesson();
    }
  }

  function finishLesson() {
    const lesson = currentLesson();
    const lessonIdx = state.lessonIdx;
    $('lessonProgressFill').style.width = '100%';
    const avg = state.scores.length
      ? Math.round(state.scores.reduce((a, b) => a + b, 0) / state.scores.length)
      : lessonAverage(lesson.id, lesson.phrases.length);
    const complete = isSpeakingLessonComplete(lesson);

    $('completeTitle').textContent = lesson.title;
    $('completeAvg').textContent = avg + '%';
    $('completeCount').textContent = lesson.phrases.length;

    const btn = $('btnBackToDash');
    if (complete) {
      $('completeEyebrow').textContent = 'Модуль пройден на 100%';
      $('completeNote').textContent = 'Следующий модуль открыт.';
      btn.textContent = 'К модулям';
      btn.onclick = () => { switchView('dashboard'); renderDashboard(); };
    } else {
      const mastered = Object.values(loadProgress()[lesson.id] || {}).filter(s => s >= MASTERY_THRESHOLD).length;
      $('completeEyebrow').textContent = 'Модуль пройден не полностью';
      $('completeNote').textContent = `Хорошо получилось ${mastered} из ${lesson.phrases.length} фраз. Чтобы открыть следующий модуль, пройдите этот ещё раз и доведите все фразы до нужного результата.`;
      btn.textContent = 'Попробовать снова';
      btn.onclick = () => startLesson(lessonIdx);
    }

    switchView('complete');
    renderDashboard();
    renderStats();
  }

  // ---------- grammar exercise engine ----------
  function startGrammarLesson(idx) {
    state.gLessonIdx = idx;
    state.gExerciseIdx = 0;
    state.gScores = [];
    switchView('grammar');
    renderGrammarExercise();
  }

  function currentGrammarLesson() { return GRAMMAR_LESSONS[state.gLessonIdx]; }
  function currentGrammarExercise() { return currentGrammarLesson().exercises[state.gExerciseIdx]; }

  function grammarNormalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim();
  }

  function renderGrammarExercise() {
    const lesson = currentGrammarLesson();
    const ex = currentGrammarExercise();
    state.gAnswered = false;

    $('grammarTag').textContent = lesson.title;
    $('grammarPrompt').textContent = ex.prompt;
    $('grammarCount').textContent = `${state.gExerciseIdx + 1} / ${lesson.exercises.length}`;
    $('grammarProgressFill').style.width = `${(state.gExerciseIdx / lesson.exercises.length) * 100}%`;
    $('grammarFeedback').classList.remove('is-visible');

    const body = $('grammarBody');
    body.innerHTML = '';

    if (ex.type === 'multiple_choice') {
      const wrap = document.createElement('div');
      wrap.className = 'gr-options';
      ex.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'gr-option';
        btn.textContent = opt;
        btn.addEventListener('click', () => handleMultipleChoice(opt, btn, wrap));
        wrap.appendChild(btn);
      });
      body.appendChild(wrap);
    }

    if (ex.type === 'fill_blank') {
      const wrap = document.createElement('div');
      wrap.className = 'gr-fill';
      wrap.innerHTML = `
        <input type="text" id="grammarInput" placeholder="введите ответ" autocomplete="off" spellcheck="false">
        <button class="ctrl-btn ctrl-btn--primary gr-check-btn" id="grammarFillCheck">Проверить</button>`;
      body.appendChild(wrap);
      const input = $('grammarInput');
      input.focus();
      const submit = () => handleFillBlank(input.value, input);
      $('grammarFillCheck').addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    if (ex.type === 'reorder') {
      const wrap = document.createElement('div');
      const shuffled = [...ex.words].sort(() => Math.random() - 0.5);
      wrap.innerHTML = `
        <div class="gr-reorder-target" id="grReorderTarget"></div>
        <div class="gr-reorder-bank" id="grReorderBank"></div>
        <button class="ctrl-btn ctrl-btn--primary gr-check-btn" id="grReorderCheck">Проверить</button>`;
      body.appendChild(wrap);
      const target = $('grReorderTarget');
      const bank = $('grReorderBank');
      const placed = [];

      function renderBank() {
        bank.innerHTML = '';
        shuffled.forEach((word, i) => {
          const chip = document.createElement('button');
          chip.className = 'gr-chip' + (placed.includes(i) ? ' is-placed' : '');
          chip.textContent = word;
          chip.disabled = placed.includes(i);
          chip.addEventListener('click', () => {
            placed.push(i);
            renderTarget();
            renderBank();
          });
          bank.appendChild(chip);
        });
      }
      function renderTarget() {
        target.innerHTML = '';
        placed.forEach((i, pos) => {
          const chip = document.createElement('button');
          chip.className = 'gr-chip';
          chip.textContent = shuffled[i];
          chip.addEventListener('click', () => {
            placed.splice(pos, 1);
            renderTarget();
            renderBank();
          });
          target.appendChild(chip);
        });
      }
      renderBank();
      renderTarget();
      $('grReorderCheck').addEventListener('click', () => {
        const built = placed.map(i => shuffled[i]).join(' ');
        handleReorder(built, target);
      });
    }
  }

  function lockGrammarInputs() {
    document.querySelectorAll('.gr-option, .gr-check-btn, .gr-chip').forEach(el => el.disabled = true);
  }

  function showGrammarFeedback(correct, correctDisplay, explain) {
    $('grammarResultIcon').textContent = correct ? '✓' : '✕';
    const ring = $('grammarRing');
    const circumference = 119;
    ring.style.strokeDashoffset = correct ? 0 : circumference * 0.15;
    ring.style.stroke = correct ? 'var(--sage)' : 'var(--coral)';
    $('grammarResultLabel').textContent = correct ? 'Верно' : 'Правильный ответ:';
    $('grammarCorrectAnswer').textContent = correct ? '' : correctDisplay;
    $('grammarExplain').textContent = explain;
    $('grammarFeedback').classList.add('is-visible');
  }

  function finalizeGrammarAnswer(correct) {
    if (state.gAnswered) return;
    state.gAnswered = true;
    state.gScores.push(correct ? 100 : 0);
    recordGrammarResult(currentGrammarLesson().id, state.gExerciseIdx, correct);
    renderStats();
    lockGrammarInputs();
  }

  function handleMultipleChoice(selected, btn, wrap) {
    const ex = currentGrammarExercise();
    if (state.gAnswered) return;
    const correct = selected === ex.answer;
    finalizeGrammarAnswer(correct);
    [...wrap.children].forEach(b => {
      if (b.textContent === ex.answer) b.classList.add('is-correct');
      else if (b === btn) b.classList.add('is-wrong');
    });
    showGrammarFeedback(correct, ex.answer, ex.explain);
  }

  function handleFillBlank(value, input) {
    if (state.gAnswered) return;
    const ex = currentGrammarExercise();
    const correct = grammarNormalize(value) === grammarNormalize(ex.answer);
    finalizeGrammarAnswer(correct);
    input.classList.add(correct ? 'is-correct' : 'is-wrong');
    input.disabled = true;
    showGrammarFeedback(correct, ex.answer, ex.explain);
  }

  function handleReorder(built, target) {
    if (state.gAnswered) return;
    const ex = currentGrammarExercise();
    const correct = grammarNormalize(built) === grammarNormalize(ex.answer);
    finalizeGrammarAnswer(correct);
    target.classList.add(correct ? 'is-correct' : 'is-wrong');
    showGrammarFeedback(correct, ex.display, ex.explain);
  }

  function nextGrammarExercise() {
    const lesson = currentGrammarLesson();
    if (state.gExerciseIdx < lesson.exercises.length - 1) {
      state.gExerciseIdx++;
      renderGrammarExercise();
    } else {
      finishGrammarLesson();
    }
  }

  function finishGrammarLesson() {
    const lesson = currentGrammarLesson();
    const lessonIdx = state.gLessonIdx;
    $('grammarProgressFill').style.width = '100%';
    const avg = state.gScores.length
      ? Math.round(state.gScores.reduce((a, b) => a + b, 0) / state.gScores.length)
      : grammarLessonAverage(lesson.id, lesson.exercises.length);
    const complete = isGrammarLessonComplete(lesson);

    $('completeTitle').textContent = lesson.title;
    $('completeAvg').textContent = avg + '%';
    $('completeCount').textContent = lesson.exercises.length;

    const btn = $('btnBackToDash');
    if (complete) {
      $('completeEyebrow').textContent = 'Модуль пройден на 100%';
      $('completeNote').textContent = 'Следующий модуль открыт.';
      btn.textContent = 'К модулям';
      btn.onclick = () => { switchView('dashboard'); renderDashboard(); };
    } else {
      const solved = Object.values(loadGrammarProgress()[lesson.id] || {}).filter(v => v === 1).length;
      $('completeEyebrow').textContent = 'Модуль пройден не полностью';
      $('completeNote').textContent = `Правильно решено ${solved} из ${lesson.exercises.length}. Чтобы открыть следующий модуль, пройдите этот ещё раз и решите все упражнения верно.`;
      btn.textContent = 'Попробовать снова';
      btn.onclick = () => startGrammarLesson(lessonIdx);
    }

    switchView('complete');
    renderDashboard();
    renderStats();
  }

  // ---------- rules reference ----------
  function renderRules() {
    const list = $('rulesList');
    list.innerHTML = '';
    RULES.forEach(rule => {
      const card = document.createElement('div');
      card.className = 'rule-card';
      const grammarIdx = GRAMMAR_LESSONS.findIndex(l => l.id === rule.grammarId);
      card.innerHTML = `
        <button class="rule-card__head">
          <div>
            <h3 class="rule-card__title">${rule.title}</h3>
          </div>
          <svg class="rule-card__chevron" viewBox="0 0 24 24" width="18" height="18"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="rule-card__body">
          <ul class="rule-card__points">${rule.points.map(p => `<li>${p}</li>`).join('')}</ul>
          <div class="rule-card__examples">
            ${rule.examples.map(ex => `
              <div class="rule-card__example">
                <p class="rule-card__example-en">${ex.en}</p>
                <p class="rule-card__example-ru">${ex.ru}</p>
              </div>`).join('')}
          </div>
          ${grammarIdx >= 0 ? `<button class="ctrl-btn ctrl-btn--primary rule-card__practice">Потренироваться</button>` : ''}
        </div>`;
      card.querySelector('.rule-card__head').addEventListener('click', () => {
        card.classList.toggle('is-open');
      });
      if (grammarIdx >= 0) {
        card.querySelector('.rule-card__practice').addEventListener('click', () => startGrammarLesson(grammarIdx));
      }
      list.appendChild(card);
    });
  }

  // ---------- review session ----------
  function renderReviewDashboard() {
    const due = getDueReviewItems().length;
    const size = getDeckSize();
    $('reviewDueCount').textContent = due;
    $('reviewDeckSize').textContent = size;
    const card = $('reviewSummaryCard');
    const emptyHint = $('reviewEmptyHint');
    const btn = $('btnStartReview');
    if (size === 0) {
      card.style.display = 'none';
      emptyHint.style.display = 'block';
    } else {
      card.style.display = 'flex';
      emptyHint.style.display = 'none';
      btn.disabled = due === 0;
      btn.textContent = due === 0 ? 'Сегодня нечего повторять' : 'Начать повторение';
    }
  }

  function startReviewSession() {
    const queue = getDueReviewItems();
    if (!queue.length) return;
    state.reviewQueue = queue;
    state.reviewIdx = 0;
    switchView('review');
    renderReviewCard();
  }

  function currentReviewItem() { return state.reviewQueue[state.reviewIdx]; }

  function renderReviewCard() {
    const item = currentReviewItem();
    state.reviewRevealed = false;
    $('reviewText').textContent = item.text;
    $('reviewIpa').textContent = item.ipa;
    $('reviewTranslation').textContent = item.ru;
    $('reviewIpa').classList.remove('is-revealed');
    $('reviewTranslation').classList.remove('is-revealed');
    $('reviewRating').classList.remove('is-visible');
    $('btnReviewReveal').style.display = 'inline-flex';
    $('reviewCount').textContent = `${state.reviewIdx + 1} / ${state.reviewQueue.length}`;
    $('reviewProgressFill').style.width = `${(state.reviewIdx / state.reviewQueue.length) * 100}%`;
  }

  function revealReview() {
    state.reviewRevealed = true;
    $('reviewIpa').classList.add('is-revealed');
    $('reviewTranslation').classList.add('is-revealed');
    $('reviewRating').classList.add('is-visible');
    $('btnReviewReveal').style.display = 'none';
  }

  function handleReviewRating(rating) {
    if (!state.reviewRevealed) return;
    const item = currentReviewItem();
    rateReviewItem(item.id, rating);
    renderStats();
    if (state.reviewIdx < state.reviewQueue.length - 1) {
      state.reviewIdx++;
      renderReviewCard();
    } else {
      $('reviewProgressFill').style.width = '100%';
      toast(`Повторено фраз: ${state.reviewQueue.length}. Отличная работа!`);
      switchView('dashboard');
      renderDashboard();
      switchTab('review');
    }
  }

  // ---------- dictionary tool (Free Dictionary API + Datamuse, no key needed) ----------
  const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const DATAMUSE_API = 'https://api.datamuse.com/words';

  function renderDictLoading(word) {
    $('dictResults').innerHTML = `<p class="dict-loading"><span class="dict-spinner"></span> Ищу «${word}»…</p>`;
  }
  function renderDictError(word) {
    $('dictResults').innerHTML = `<p class="dict-error">Слово «${word}» не найдено в словаре. Проверьте написание — учитываются только слова в базовой форме (например, "go", а не "went").</p>`;
  }
  function renderDictNetworkError() {
    $('dictResults').innerHTML = `<p class="dict-error">Не удалось связаться со словарным сервисом. Проверьте подключение к интернету и попробуйте ещё раз.</p>`;
  }

  async function lookupDictionaryWord(word) {
    word = word.trim().toLowerCase();
    if (!word) return;
    renderDictLoading(word);
    let entries;
    try {
      const res = await fetch(DICT_API + encodeURIComponent(word));
      if (res.status === 404) { renderDictError(word); return; }
      if (!res.ok) { renderDictNetworkError(); return; }
      entries = await res.json();
    } catch {
      renderDictNetworkError();
      return;
    }
    let related = [];
    try {
      const relRes = await fetch(`${DATAMUSE_API}?ml=${encodeURIComponent(word)}&max=8`);
      if (relRes.ok) related = (await relRes.json()).map(r => r.word).filter(w => w !== word);
    } catch { /* related words are a nice-to-have; fail silently */ }
    renderDictEntry(entries[0], related);
  }

  function renderDictEntry(entry, related) {
    const phoneticObj = entry.phonetics.find(p => p.audio) || entry.phonetics[0] || {};
    const ipaText = entry.phonetic || phoneticObj.text || '';
    const audioUrl = phoneticObj.audio ? (phoneticObj.audio.startsWith('//') ? 'https:' + phoneticObj.audio : phoneticObj.audio) : '';

    const meaningsHtml = entry.meanings.map(m => `
      <div class="dict-meaning">
        <span class="dict-meaning__pos">${m.partOfSpeech}</span>
        ${m.definitions.slice(0, 3).map(d => `
          <p class="dict-def">${d.definition}</p>
          ${d.example ? `<p class="dict-def__example">"${d.example}"</p>` : ''}
        `).join('')}
      </div>`).join('');

    const chipsHtml = related.length
      ? `<div class="dict-related"><p class="dict-related__label">Похожие по смыслу слова</p>
         <div class="dict-chips">${related.map(w => `<button class="dict-chip" data-lookup="${w}">${w}</button>`).join('')}</div></div>`
      : '';

    $('dictResults').innerHTML = `
      <article class="dict-entry">
        <div class="dict-entry__head">
          <h3 class="dict-entry__word">${entry.word}</h3>
          ${ipaText ? `<span class="dict-entry__ipa">[${ipaText.replace(/\//g, '')}]</span>` : ''}
          <div class="dict-entry__actions">
            <button class="play-btn" id="dictPlayBtn" aria-label="Прослушать" data-audio="${audioUrl}" data-word="${entry.word}">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            </button>
            <button class="ctrl-btn ctrl-btn--ghost" id="dictAddReview" data-word="${entry.word}" data-ipa="${ipaText}">+ В повторение</button>
          </div>
        </div>
        ${meaningsHtml}
        ${chipsHtml}
      </article>`;
  }

  function playDictAudio(url, fallbackWord) {
    if (url) {
      const audio = new Audio(url);
      audio.play().catch(() => playWithWave(fallbackWord, 1));
    } else {
      playWithWave(fallbackWord, 1);
    }
  }

  $('dictSearchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    lookupDictionaryWord($('dictInput').value);
  });

  // event delegation: covers the static hint buttons and all dynamically injected results
  $('dictResults').addEventListener('click', (e) => {
    const exampleBtn = e.target.closest('.dict-example');
    const chipBtn = e.target.closest('.dict-chip');
    const playBtn = e.target.closest('#dictPlayBtn');
    const addBtn = e.target.closest('#dictAddReview');
    if (exampleBtn) {
      $('dictInput').value = exampleBtn.dataset.word;
      lookupDictionaryWord(exampleBtn.dataset.word);
    } else if (chipBtn) {
      $('dictInput').value = chipBtn.dataset.lookup;
      lookupDictionaryWord(chipBtn.dataset.lookup);
    } else if (playBtn) {
      playDictAudio(playBtn.dataset.audio, playBtn.dataset.word);
    } else if (addBtn) {
      const word = addBtn.dataset.word;
      const ipa = addBtn.dataset.ipa;
      const firstDef = document.querySelector('.dict-def')?.textContent || '';
      addOrUpdateReviewItem(`dict:${word}`, { text: word, ipa: ipa ? `[${ipa}]` : '', ru: firstDef }, true);
      renderStats();
      toast(`«${word}» добавлено в колоду повторения`);
    }
  });

  // ---------- view switching ----------
  function switchView(name) {
    state.view = name;
    viewDash.classList.toggle('view--hidden', name !== 'dashboard');
    viewIntro.classList.toggle('view--hidden', name !== 'intro');
    viewLesson.classList.toggle('view--hidden', name !== 'lesson');
    viewGrammar.classList.toggle('view--hidden', name !== 'grammar');
    viewReview.classList.toggle('view--hidden', name !== 'review');
    viewComplete.classList.toggle('view--hidden', name !== 'complete');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- event wiring ----------
  $('entryPlay').addEventListener('click', () => {
    const entry = ENTRY_OF_DAY[Math.floor(Date.now() / 86400000) % ENTRY_OF_DAY.length];
    playWithWave(entry.text, 0.95, $('entryWave'), $('entryPlay'));
  });

  $('btnListen').addEventListener('click', () => {
    playWithWave(currentPhrase().text, 1, $('phraseWave'), $('btnListen'));
  });
  $('btnSlow').addEventListener('click', () => {
    playWithWave(currentPhrase().text, 0.6, $('phraseWave'), $('btnSlow'));
  });
  $('btnSpeak').addEventListener('click', startRecording);
  $('btnRetry').addEventListener('click', () => {
    $('feedback').classList.remove('is-visible');
  });
  $('btnNext').addEventListener('click', nextPhrase);
  $('btnExit').addEventListener('click', () => { switchView('dashboard'); renderDashboard(); });
  $('btnExitGrammar').addEventListener('click', () => { switchView('dashboard'); renderDashboard(); });
  $('btnGrammarNext').addEventListener('click', nextGrammarExercise);

  $('btnExitIntro').addEventListener('click', () => { switchView('dashboard'); renderDashboard(); });
  $('btnIntroStart').addEventListener('click', () => {
    if (!state.pendingModule) return;
    const { type, index } = state.pendingModule;
    if (type === 'speaking') startLesson(index);
    else startGrammarLesson(index);
  });

  $('btnExitReview').addEventListener('click', () => { switchView('dashboard'); renderDashboard(); switchTab('review'); });
  $('btnStartReview').addEventListener('click', startReviewSession);
  $('btnReviewListen').addEventListener('click', () => {
    playWithWave(currentReviewItem().text, 1, $('reviewWave'), $('btnReviewListen'));
  });
  $('btnReviewReveal').addEventListener('click', revealReview);
  $('btnRateForgot').addEventListener('click', () => handleReviewRating('forgot'));
  $('btnRateGood').addEventListener('click', () => handleReviewRating('good'));
  $('btnRateEasy').addEventListener('click', () => handleReviewRating('easy'));

  $('tabSpeaking').addEventListener('click', () => switchTab('speaking'));
  $('tabGrammar').addEventListener('click', () => switchTab('grammar'));
  $('tabRules').addEventListener('click', () => switchTab('rules'));
  $('tabReview').addEventListener('click', () => switchTab('review'));
  $('tabDictionary').addEventListener('click', () => switchTab('dictionary'));

  function switchTab(name) {
    const tabs = { speaking: $('tabSpeaking'), grammar: $('tabGrammar'), rules: $('tabRules'), review: $('tabReview'), dictionary: $('tabDictionary') };
    const panes = { speaking: $('paneSpeaking'), grammar: $('paneGrammar'), rules: $('paneRules'), review: $('paneReview'), dictionary: $('paneDictionary') };
    Object.keys(tabs).forEach(key => {
      tabs[key].classList.toggle('is-active', key === name);
      tabs[key].setAttribute('aria-selected', key === name);
      panes[key].classList.toggle('mode-pane--hidden', key !== name);
    });
    if (name === 'rules') renderRules();
    if (name === 'review') renderReviewDashboard();
  }

  // voices sometimes load async
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }

  // ---------- init ----------
  renderDashboard();
  renderStats();
})();
