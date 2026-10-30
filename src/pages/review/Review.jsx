import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Buddy from '../../components/Buddy';
import ScenePlayer from '../../containers/flashcard/ScenePlayer';
import usePracticeAudio from '../../hooks/usePracticeAudio';
import { compareSpokenAnswer, markSpans } from '../../services/reviewPractice';
import { safeJsonParse } from '../../utils/errors';
import useReviewPractice from './useReviewPractice';
import ReviewLibrary from './ReviewLibrary';

const MODES = [['quiet', '조용히'], ['listen', '듣기'], ['speak', '말하기']];

export default function Review() {
  const navigate = useNavigate();
  const practice = useReviewPractice();
  const [mode, setMode] = useState('quiet');
  const [paused, setPaused] = useState(false);
  const [library, setLibrary] = useState(() => new URLSearchParams(window.location.search).get('library') === '1');
  const [settings, setSettings] = useState(false);
  const [spoken, setSpoken] = useState(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [listened, setListened] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [choice, setChoice] = useState(null);
  const card = practice.parts[practice.partIndex];
  const cardKey = `${practice.currentId}:${practice.partIndex}`;
  // Speaking already produces an answer; every other mode asks "remembered?" before showing one.
  const recall = mode !== 'speak';
  const audio = usePracticeAudio(text => {
    setSpoken({ text, result: compareSpokenAnswer(text, card.word) });
    practice.reveal();
  });
  const { reset: resetAudio, stop: stopAudio } = audio;
  const heading = useRef(null);
  const [displayedId, setDisplayedId] = useState(null);

  // Reset card-local input before rendering the next card, never after paint.
  if (displayedId !== cardKey) {
    setDisplayedId(cardKey);
    setChoice(null);
    setSpoken(null);
    setTypedAnswer('');
    setHintOpen(false);
    setSceneOpen(false);
    setListened(false);
  }

  useEffect(() => {
    resetAudio();
    heading.current?.focus({ preventScroll: true });
  }, [cardKey, resetAudio]);

  useEffect(() => { if (choice) heading.current?.focus({ preventScroll: true }); }, [choice]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) { setPaused(true); setSceneOpen(false); }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  function changeMode(next) {
    resetAudio();
    setSceneOpen(false);
    setChoice(null);
    setSpoken(null);
    setTypedAnswer('');
    setMode(next);
    if (next === 'listen' && practice.current && !practice.revealed) {
      audio.play(card.word);
      setListened(true);
    }
  }

  function reveal() { stopAudio(); practice.reveal(); }
  function forget() { stopAudio(); practice.reveal({ correct: false, type: 'forgot' }); }
  function remember() {
    stopAudio();
    const options = practice.choices();
    // With no other saved meaning to compare against, fall back to checking it yourself.
    if (options) setChoice(options); else practice.reveal();
  }
  function pick(index) {
    stopAudio();
    practice.reveal({ correct: index === choice.answer, type: 'choice', picked: choice.options[index] });
  }
  function next() { stopAudio(); practice.evaluate(practice.result.correct, practice.result.type); }
  function evaluate(correct) {
    stopAudio();
    practice.evaluate(correct, spoken?.result === 'match' ? 'answer-confirmed' : 'self');
  }
  function pause() { stopAudio(); setSceneOpen(false); setPaused(true); }
  function leave() { stopAudio(); navigate('/'); }
  function openLibrary() { stopAudio(); setSceneOpen(false); setLibrary(true); }

  const completed = Boolean(practice.session && !practice.currentId);
  const answers = Object.values(practice.session?.answers || {});
  const recalled = answers.filter(answer => answer.correct === true).length;
  const progress = practice.session?.ids.length ? (answers.length / practice.session.ids.length) * 100 : 0;
  const source = practice.current?.annotation?.source;
  const rect = safeJsonParse(practice.current?.annotation?.selection_rect, null);
  const sceneStart = rect?.sceneStart ?? rect?.timestamp;
  const canPlayScene = rect?.type === 'youtube_word' && source?.youtube_data?.video_id && typeof sceneStart === 'number';
  const sourcePath = source?.id ? (source.type === 'youtube' ? `/youtube/${source.id}` : `/viewer/${source.id}`) : null;
  const maskedDefinition = mode === 'speak' && card.vocabulary && card.word
    ? card.definition.replace(new RegExp(card.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____') : card.definition;
  const result = practice.result;
  const lastPart = practice.partIndex >= practice.parts.length - 1;
  const cardLabel = card.kind === 'pattern' ? `EXPRESSION${practice.parts.length > 1 ? ` ${practice.partIndex + 1} / ${practice.parts.length}` : ''}`
    : mode === 'speak' && card.vocabulary ? 'SAY IT IN ENGLISH' : 'TAKE A MOMENT';
  const sentence = card.kind === 'pattern' && <span className="practice-card-sentence">
    {markSpans(card.sentence, card.spans).map((segment, index) => segment.strong ? <strong key={index}>{segment.text}</strong> : <span key={index}>{segment.text}</span>)}
    {practice.revealed && card.translation && <small>{card.translation}</small>}
  </span>;
  const face = practice.revealed ? <><span className="practice-card-label">ANSWER</span><strong className="practice-word">{card.word}</strong>
    {card.phonetic && <span className="practice-phonetic">{card.phonetic}</span>}
    <span className="practice-definition">{card.definition || '원문에서 이 표현의 뜻을 다시 확인해 주세요.'}</span>
    {card.kind === 'pattern' ? sentence : card.sentence && <span className="practice-sentence">{card.sentence}</span>}</>
    : choice ? <><span className="practice-card-label">WHICH ONE?</span><strong className="practice-word">{card.word}</strong>
      <div className="practice-choices" role="group" aria-label="뜻 고르기">{choice.options.map((option, index) =>
        <button key={index} onClick={() => pick(index)} disabled={practice.busy}>{option}</button>)}</div>
      {sentence}</>
    : mode === 'listen' ? <><span className="practice-card-label">LISTEN & RECALL</span><span className="practice-sound-mark" aria-hidden="true">♫</span><span>들리는 표현은 어떤 뜻일까요?</span></>
    : <><span className="practice-card-label">{cardLabel}</span><strong className={mode === 'speak' && card.vocabulary ? 'practice-definition' : 'practice-word'}>{mode === 'speak' && card.vocabulary ? maskedDefinition : card.word}</strong>
      {sentence}{!recall && <small>떠올린 뒤 눌러서 정답 확인</small>}</>;

  return <div className="practice-screen">
    <header className="practice-header">
      <button onClick={leave} disabled={practice.busy} aria-label="홈으로 돌아가기">← 홈</button>
      <span>오늘의 작은 복습</span>
      <button onClick={openLibrary} disabled={practice.busy}>내 단어</button>
    </header>

    {library ? <ReviewLibrary onClose={() => { setLibrary(false); practice.load(); }} onPractice={items => {
      setLibrary(false); setPaused(false); practice.startCheck(items);
    }} /> : practice.loading ? <main className="practice-center"><p role="status">저장한 단어를 가져오고 있어요.</p></main>
      : practice.error ? <main className="practice-center"><h1>잠깐, 연결을 확인해 주세요.</h1><p role="alert">{practice.error}</p>
        <button className="practice-primary" onClick={() => practice.load()}>다시 불러오기</button></main>
      : completed ? <main className="practice-center practice-finish">
        <span className="practice-eyebrow">A LITTLE MORE YOURS</span>
        <Buddy className="practice-buddy" />
        <h1>{practice.session.kind === 'retry' ? '다시 도전했어요.' : practice.session.kind === 'sample' ? '이렇게 복습하면 돼요.' : '이번 묶음을 마쳤어요.'}</h1>
        <p className="practice-finish-count"><strong>{answers.length}개</strong> 확인했어요.</p>
        <div className="practice-result"><span>맞혔다고 체크 <strong>{recalled}</strong></span><span>다시 볼 표현 <strong>{answers.length - recalled}</strong></span></div>
        <p>{practice.session.kind === 'daily' ? '오늘 헷갈린 표현은 내일 다시 만나요.' : '이번 연습은 예정된 복습 간격에 영향을 주지 않아요.'}</p>
        <button className="practice-primary" onClick={leave}>여기서 마치기</button>
        {practice.retryItems.length > 0 && <button className="practice-secondary" onClick={() => { setPaused(false); practice.startRetry(); }}>헷갈린 {practice.retryItems.length}개 다시 해보기</button>}
        {practice.overview.due > 0 && <button className="practice-text-button" onClick={() => practice.load(true, practice.options)}>다음 묶음 시작 · 예정 항목 {practice.overview.due}개 남음</button>}
        <button className="practice-text-button" onClick={openLibrary}>내가 고른 단어 따로 연습</button>
        {practice.session.kind !== 'daily' && <p className="practice-note">방금 다시 확인한 결과와 며칠 뒤의 기억은 달라요.</p>}
      </main>
      : !practice.current ? <main className="practice-center">
        <Buddy className="practice-buddy" />
        <h1>{practice.overview.total === 0 ? '단어 3개로 가볍게 시작해요.' : practice.overview.due ? '이번 조건에 맞는 항목이 없어요.' : '오늘 예정된 복습을 마쳤어요.'}</h1>
        <p>{practice.overview.total === 0 ? '샘플로 먼저 해보고, 내 자료에서 단어를 저장해 보세요.' : '필요한 단어를 직접 고르거나 읽던 자료를 이어가세요.'}</p>
        {practice.overview.total === 0 && <button className="practice-primary" onClick={practice.startSample}>샘플 3개 체험</button>}
        {practice.overview.due > 0 && <button className="practice-primary" onClick={() => practice.load(true)}>기본 조건으로 시작</button>}
        <button className="practice-secondary" onClick={leave}>{practice.overview.total === 0 ? '내 자료로 시작하기' : '자료 이어 읽기'}</button>
        <button className="practice-text-button" onClick={openLibrary}>전체 목록 보기</button>
      </main>
      : paused ? <main className="practice-center"><span className="practice-eyebrow">TAKE YOUR TIME</span><h1>여기서 이어가면 돼요.</h1>
        <p>이미 확인한 결과는 남아 있어요. 이번 묶음은 {practice.session.ids.length - answers.length}개 남았어요.</p>
        <button className="practice-primary" onClick={() => setPaused(false)}>이어서 하기</button><button className="practice-secondary" onClick={leave}>오늘은 여기까지</button></main>
      : <main className="practice-main">
        <div className="practice-topline"><span className="practice-eyebrow">{practice.session.kind === 'retry' ? 'ONE MORE TRY' : practice.session.kind === 'check' ? 'YOUR CHOICE' : practice.session.kind === 'sample' ? 'TRY THREE WORDS' : 'A LITTLE EVERY DAY'}</span>
          <span>{answers.length} / {practice.session.ids.length}</span></div>
        <div className="practice-progress" role="progressbar" aria-label="이번 묶음 진행" aria-valuenow={answers.length} aria-valuemin={0} aria-valuemax={practice.session.ids.length}><span style={{ width: `${progress}%` }} /></div>
        <div className="practice-mode-bar" aria-label="복습 방식">{MODES.map(([value, label]) =>
          <button key={value} aria-pressed={mode === value} disabled={practice.busy} onClick={() => changeMode(value)}>{label}</button>)}</div>
        <h1 className="practice-prompt" ref={heading} tabIndex={-1}>{result ? result.correct ? '맞았어요. 한 번 더 눈에 담고 넘어가요.' : result.type === 'forgot' ? '괜찮아요. 정답을 보고 넘어가요.' : '다른 뜻이었어요. 정답을 확인해 보세요.'
          : practice.revealed ? '떠올린 답과 비교해 보세요.' : choice ? '어느 뜻이었나요?' : mode === 'listen' ? '듣고, 뜻을 떠올려 보세요.' : mode === 'speak' && card.vocabulary ? '이 뜻의 영어 표현을 말해보세요.' : '뜻을 속으로 떠올려 보세요.'}</h1>

        {recall ? <section className={`practice-card ${practice.revealed ? 'is-revealed' : choice ? 'is-flipped' : ''}`}>{face}</section>
          : <button className={`practice-card ${practice.revealed ? 'is-revealed' : ''}`} onClick={reveal} disabled={practice.busy || practice.revealed} aria-label={practice.revealed ? '정답' : '카드를 눌러 정답 보기'}>{face}</button>}

        {mode === 'listen' && !practice.revealed && !choice && <button className="practice-secondary" onClick={() => {
          if (audio.speaking) { stopAudio(); return; }
          audio.play(card.word); setListened(true);
        }}>{audio.speaking ? '재생 멈추기' : listened ? '한 번 더 듣기' : '소리 듣기'}</button>}
        {mode === 'speak' && !practice.revealed && <div className="practice-speech">
          <button className="practice-secondary" onClick={audio.listening ? stopAudio : audio.listen} disabled={!audio.supported}>{audio.listening ? '듣고 있어요 · 멈추기' : '마이크로 답하기'}</button>
          {!audio.supported && <p className="practice-note">이 브라우저에서는 글자로 답하거나 조용히 복습할 수 있어요.</p>}
          {audio.transcript && <p role="status">들은 말: {audio.transcript}</p>}
          <form onSubmit={event => {
            event.preventDefault();
            if (!typedAnswer.trim()) return;
            stopAudio(); setSpoken({ text: typedAnswer.trim(), result: compareSpokenAnswer(typedAnswer, card.word) }); practice.reveal();
          }}><label className="sr-only" htmlFor="practice-answer">영어 표현 입력</label><input id="practice-answer" autoComplete="off" value={typedAnswer} onChange={event => setTypedAnswer(event.target.value)} placeholder="글자로 답해도 괜찮아요" /><button disabled={!typedAnswer.trim()}>확인</button></form>
        </div>}
        {result && !result.correct && typeof result.picked === 'string' && <p className="practice-spoken" role="status">내가 고른 뜻: <strong>{result.picked}</strong></p>}
        {spoken && practice.revealed && <p className="practice-spoken" role="status">내 답: <strong>{spoken.text}</strong><br />{spoken.result === 'match' ? '저장한 표현과 일치해요. 내가 말한 답이 맞는지 확인해 주세요.' : '표현이 다르게 들어왔어요. 인식한 말과 정답을 비교해서 직접 체크해 주세요.'}</p>}
        {audio.error && <p className="practice-message" role="status">{audio.error}</p>}

        <div className="practice-context">
          {card.source && <span className="practice-source">{card.source}</span>}
          {!practice.revealed && !choice && card.kind === 'word' && card.sentence && <button className="practice-text-button" onClick={() => { setHintOpen(true); practice.hint(); }}>저장한 문장 힌트</button>}
          {hintOpen && !practice.revealed && <p className="practice-sentence">{card.sentence}</p>}
          {mode !== 'quiet' && practice.revealed && <button className="practice-text-button" onClick={() => audio.speaking ? stopAudio() : audio.play(card.word)}>{audio.speaking ? '재생 멈추기' : '발음 듣기'}</button>}
          {mode !== 'quiet' && canPlayScene && <button className="practice-text-button" onClick={() => { stopAudio(); setSceneOpen(value => !value); if (!practice.revealed) practice.hint(); }}>{sceneOpen ? '장면 닫기' : '저장한 영상 장면 보기'}</button>}
          {sceneOpen && mode !== 'quiet' && <ScenePlayer key={practice.currentId} videoId={source.youtube_data.video_id} sourceId={source.id} segmentIndex={rect.segmentIndex} fallbackStart={sceneStart} sceneStart={rect.sceneStart} sceneEnd={rect.sceneEnd} />}
          {practice.revealed && sourcePath && <button className="practice-text-button" onClick={() => { stopAudio(); navigate(sourcePath); }}>원문에서 다시 살펴보기 ↗</button>}
        </div>

        {practice.saveError && <p role="alert" className="practice-message">{practice.saveError}</p>}
        {practice.storageWarning && <p role="status" className="practice-note">이 브라우저에 이어하기 위치를 보관하지 못했어요. 서버에 저장된 복습 결과는 유지돼요.</p>}
        <div className="practice-actions">{result ? <button className="practice-primary" onClick={next} disabled={practice.busy}>{practice.busy ? '저장 중…' : lastPart ? '다음' : '다음 표현'}</button>
          : practice.revealed ? <>
            <button className="practice-secondary" onClick={() => evaluate(false)} disabled={practice.busy}>다시 볼래요</button>
            <button className="practice-primary" onClick={() => evaluate(true)} disabled={practice.busy}>{practice.busy ? '저장 중…' : '맞혔어요'}</button>
          </> : choice ? <button className="practice-secondary" onClick={forget}>잘 모르겠어요</button>
          : recall ? <>
            <button className="practice-secondary" onClick={forget}>기억 안 나요</button>
            <button className="practice-primary" onClick={remember}>기억나요</button>
          </> : <button className="practice-primary" onClick={reveal}>정답 확인</button>}</div>
        <p className="practice-note">{practice.session.hintedIds.includes(practice.currentId) ? '힌트를 보고 확인한 답이에요. 다음에는 도움 없이 떠올려보세요.'
          : !practice.current.last_reviewed ? recall ? '처음 보는 표현이면 ‘기억 안 나요’로 답부터 봐도 괜찮아요.' : '처음 보는 표현은 답을 먼저 살펴봐도 괜찮아요.'
          : recall ? '떠올렸다면 두 뜻 중 하나를 골라 확인해요.' : '답을 보기 전에 떠올렸는지 스스로 체크해 주세요.'}</p>
        <div className="practice-footer"><button onClick={pause} disabled={practice.busy}>잠깐 쉬기</button><button onClick={() => setSettings(value => !value)} disabled={practice.busy}>분량·범위</button>{practice.session.kind !== 'sample' && <button onClick={() => { stopAudio(); practice.suspend(); }} disabled={practice.busy}>이 단어 잠시 빼기</button>}</div>
        {settings && <section className="practice-settings" aria-label="다음 묶음 설정"><h2>다음 묶음 정하기</h2>
          <label>한 번에<select value={practice.options.size} onChange={event => practice.setOptions({ ...practice.options, size: Number(event.target.value) })}>{[3, 5, 10, 20].map(size => <option key={size} value={size}>{size}개</option>)}</select></label>
          <label>새 표현은 최대<select value={practice.options.newLimit} onChange={event => practice.setOptions({ ...practice.options, newLimit: Number(event.target.value) })}>{[0, 2, 5, 10, 20].map(size => <option key={size} value={size}>{size === 0 ? '지금은 복습만' : `${size}개`}</option>)}</select></label>
          <label>자료 범위<select value={practice.options.sourceId} onChange={event => practice.setOptions({ ...practice.options, sourceId: event.target.value })}><option value="">모든 자료</option>{Array.from(new Map(practice.dueItems.filter(item => item.annotation?.source?.id).map(item => [String(item.annotation.source.id), item.annotation.source])).values()).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <p className="practice-note">이번 묶음을 바꿔도 이미 기록한 결과는 남아요. 아직 확인하지 않은 항목은 다음에 다시 만나요.</p>
          <button className="practice-secondary" onClick={() => { resetAudio(); setSettings(false); practice.load(true, practice.options); }}>이 조건으로 시작</button>
        </section>}
      </main>}
  </div>;
}
