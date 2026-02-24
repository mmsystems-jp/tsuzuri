import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
  Animated, ActivityIndicator, Alert
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as Speech from 'expo-speech';
import Voice from '@react-native-voice/voice'; // EAS Build必須

WebBrowser.maybeCompleteAuthSession();

// ── LINEログイン設定 ──────────────────────────────────────────────
const LINE_CHANNEL_ID = '2009194648';
const LINE_CHANNEL_SECRET = 'e79ea0ffe3244d8344124c2aa5b3ba3a';
const LINE_REDIRECT_URI = AuthSession.makeRedirectUri({ useProxy: true });
const LINE_DISCOVERY = {
  authorizationEndpoint: 'https://access.line.me/oauth2/v2.1/authorize',
  tokenEndpoint: 'https://api.line.me/oauth2/v2.1/token',
};

// ── 設定 ─────────────────────────────────────────────────────────
const API_URL = 'https://o5k36gp6jd.execute-api.ap-northeast-1.amazonaws.com';
const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

// ── カラーパレット ────────────────────────────────────────────────
const C = {
  paper:      '#f5f0e8',
  paperDark:  '#ede7d9',
  ink:        '#1a1510',
  inkLight:   '#4a3f35',
  inkFaint:   '#9a8f85',
  accent:     '#8b5e3c',
  accentLight:'#c4956a',
  red:        '#c0392b',
  line:       'rgba(26,21,16,0.12)',
  white:      '#ffffff',
  voiceActive:'#4a3f35',
};

// ── API helpers ───────────────────────────────────────────────────
async function getToken() {
  return (await SecureStore.getItemAsync('tsz_token')) || '';
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

// ── 日付helpers ───────────────────────────────────────────────────
function todayJST() {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const days = ['日','月','火','水','木','金','土'];
  const dow = new Date(dateStr).getDay();
  return { y, m, d, dow: days[dow], full: `${parseInt(m)}月${parseInt(d)}日（${days[dow]}）` };
}

function getInitialMessage() {
  const h = new Date().getHours();
  if (h < 5)  return '夜更かしですね。今日一日を振り返って、何かひとつ、心に残ったことはありましたか？';
  if (h < 10) return 'おはようございます。昨日のことを一緒に振り返ってみませんか。どんな一日でしたか？';
  if (h < 17) return 'こんにちは。今日ここまで、どんなことがありましたか？';
  if (h < 20) return 'おつかれさまでした。今日一日、何かひとつ印象に残ったことを教えてもらえますか？';
  return 'おつかれさまです。今日はどんな一日でしたか？ゆっくり話しましょう。';
}

function getStarterResponse(starter) {
  const map = {
    '良い一日だった':      'それは良かったです。どんなことが特に嬉しかったか、もう少し聞かせてもらえますか？',
    '少し疲れた':          'お疲れさまです。何がいちばん大変でしたか？',
    'なんでもない一日':    'そういう日もありますよね。それでも、小さなことでもいいので、何か覚えていることはありましたか？',
    '嬉しいことがあった':  'それは良かった！どんなことがあったんですか？',
    '悩んでいることがある':'話してくれてありがとうございます。どんなことが気になっていますか？',
  };
  return map[starter] || '教えてくれてありがとうございます。もう少し詳しく聞かせてもらえますか？';
}

const STARTERS = ['良い一日だった','少し疲れた','なんでもない一日','嬉しいことがあった','悩んでいることがある'];

const SYSTEM_PROMPT = `あなたは「綴り」というAI日記アプリの、やさしい聞き役です。

【役割】
ユーザーが今日あったことや気持ちを話しやすいよう、自然な会話で引き出してください。
カウンセラーのように共感しながら、日常のひとコマを一緒に振り返る存在です。

【会話の進め方】
1. まず相手の言葉をしっかり受け止め、共感を示す
2. 気持ちや状況をもう少し引き出す質問を一つだけする
3. 「なぜそう感じたか」「具体的にどんな場面だったか」を丁寧に掘り下げる
4. ユーザーの発言が5回を超えたら、会話を自然に締めくくり「今日のことを日記にまとめてみましょうか？」と必ず聞く
5. それ以前でも話が一区切りついたと感じたら同様に提案してよい

【守るルール】
- 質問は必ず一度に一つだけ
- 一つの返答は50〜80字以内に収める
- 「なるほど」「そうですね」だけで終わらず、必ず次の問いかけをする
- 「大丈夫ですか？」「頑張ってください」などの安易な励ましは避ける
- ユーザーが話したくなるような、具体的で温かい問いかけをする
- 絵文字・記号は一切使わない
- 「日記にまとめてみましょうか？」と聞いた後、ユーザーが承諾した場合は「[GENERATE]」とだけ返す`;

const SYSTEM_PROMPT_VOICE = `${SYSTEM_PROMPT}

【音声モード追加ルール】
- 返答は必ず40字以内に収める（読み上げるため簡潔に）
- 句読点を適切に使い、自然な読み上げリズムにする`;

function getDiaryPrompt(conversation) {
  return `以下は、ある人が今日一日について話した会話です。
この会話をもとに、その人の一人称日記を書いてください。

【守るルール】
- 一人称（「今日」「私は」など）で書く
- Markdownは一切使わない。見出しも箇条書きも使わない
- 地の文のみで書く。会話の引用もしない
- その人が感じた感情を、具体的な場面とともに描写する
- 美化しすぎず、等身大の言葉で書く
- 200〜350字程度に収める
- 「。」で文章を区切り、読みやすいリズムにする

会話：
${conversation}`;
}

// ── 罫線背景 ─────────────────────────────────────────────────────
function RuledBackground({ children }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {Array.from({ length: 60 }).map((_, i) => (
        <View key={i} style={[s.ruleLine, { top: 32 * (i + 1) }]} />
      ))}
      {children}
    </View>
  );
}

// ── ログイン画面 ──────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId: LINE_CHANNEL_ID, scopes: ['profile', 'openid'], redirectUri: LINE_REDIRECT_URI },
    LINE_DISCOVERY
  );

  useEffect(() => {
    if (response?.type === 'success') {
      exchangeCodeForToken(response.params.code);
    } else if (response?.type === 'error' || response?.type === 'cancel') {
      if (response.type === 'error') setError('LINEログインに失敗しました');
      setLoading(false);
    }
  }, [response]);

  async function exchangeCodeForToken(code) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: LINE_REDIRECT_URI,
        client_id: LINE_CHANNEL_ID, client_secret: LINE_CHANNEL_SECRET,
      });
      const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('トークン取得に失敗しました');
      const data = await apiFetch('/auth/line', {
        method: 'POST',
        body: JSON.stringify({ accessToken: tokenData.access_token }),
      });
      await SecureStore.setItemAsync('tsz_token', data.token);
      onLogin(data);
    } catch (e) {
      setError(e.message || 'ログインに失敗しました。もう一度お試しください');
      setLoading(false);
    }
  }

  return (
    <RuledBackground>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={s.loginWrap}>
          <Text style={s.loginLogo}>綴り</Text>
          <Text style={s.loginTagline}>話すだけで、日記になる</Text>
          <View style={s.loginCard}>
            {!!error && <Text style={[s.errorMsg, { marginBottom: 16 }]}>{error}</Text>}
            <TouchableOpacity
              style={[s.lineLoginBtn, (loading || !request) && s.btnDisabled]}
              onPress={() => { setError(''); setLoading(true); promptAsync(); }}
              disabled={loading || !request}
            >
              <Text style={s.lineLoginBtnText}>{loading ? 'ログイン中...' : 'LINEでログイン'}</Text>
            </TouchableOpacity>
            <Text style={s.loginHint}>初めての方はそのままアカウント作成されます</Text>
          </View>
        </View>
      </SafeAreaView>
    </RuledBackground>
  );
}

// ── 音声モード画面 ────────────────────────────────────────────────
// テキスト表示なし、マイクボタン中心、Claudeは音声で返答
function VoiceChatScreen({ onBack, onGenerateDone, targetDate }) {
  const firstMsg = getInitialMessage();
  const [messages, setMessages] = useState([{ role: 'assistant', content: firstMsg }]);
  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking
  const [transcript, setTranscript] = useState('');
  const [lastAiText, setLastAiText] = useState(firstMsg);
  const [generating, setGenerating] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const statusRef = useRef(status);
  statusRef.current = status;

  // パルスアニメーション
  useEffect(() => {
    if (status === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [status]);

  // Voice イベント設定
  useEffect(() => {
    Voice.onSpeechResults = (e) => {
      const text = e.value?.[0] || '';
      if (text) setTranscript(text);
    };
    Voice.onSpeechEnd = () => {
      // 少し待ってから確定（音声認識の遅延考慮）
      setTimeout(() => {
        const text = transcript;
        if (text.trim()) handleVoiceSend(text);
        else setStatus('idle');
      }, 500);
    };
    Voice.onSpeechError = () => setStatus('idle');

    // 最初のメッセージを読み上げてから待機
    speakAndThenListen(firstMsg);

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
      Speech.stop();
    };
  }, []);

  async function speakAndThenListen(text) {
    setStatus('speaking');
    await new Promise(resolve => {
      Speech.speak(text, {
        language: 'ja-JP',
        rate: 0.9,
        pitch: 1.0,
        onDone: resolve,
        onStopped: resolve,
        onError: resolve,
      });
    });
    // 読み上げ完了後、自動でリスニング開始
    startListening();
  }

  async function startListening() {
    try {
      setTranscript('');
      setStatus('listening');
      await Voice.start('ja-JP');
    } catch {
      setStatus('idle');
    }
  }

  async function stopListening() {
    try {
      await Voice.stop();
    } catch {}
  }

  async function handleVoiceSend(text) {
    setStatus('thinking');
    const newMessages = [...messagesRef.current, { role: 'user', content: text }];
    setMessages(newMessages);
    setTranscript('');

    try {
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          system: SYSTEM_PROMPT_VOICE,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || 'もう一度教えてください。';

      if (reply.trim() === '[GENERATE]') {
        // 日記生成
        Speech.speak('では日記にまとめます。少しお待ちください。', { language: 'ja-JP', rate: 0.9 });
        setGenerating(true);
        await generateDiary(newMessages);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        setLastAiText(reply);
        await speakAndThenListen(reply);
      }
    } catch {
      Speech.speak('少し問題が発生しました。もう一度話しかけてください。', { language: 'ja-JP' });
      setTimeout(() => startListening(), 2000);
    }
  }

  async function generateDiary(msgList) {
    const src = msgList || messagesRef.current;
    try {
      const conversation = src
        .map(m => `${m.role === 'user' ? 'あなた' : '綴り'}: ${m.content}`)
        .join('\n');
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{ role: 'user', content: getDiaryPrompt(conversation) }],
        }),
      });
      const data = await res.json();
      const diaryText = data.content?.[0]?.text || '';

      // 日記を読み上げてレビュー
      setStatus('speaking');
      setLastAiText('日記ができました。読み上げます。');
      await new Promise(resolve => {
        Speech.speak(`日記ができました。${diaryText}`, {
          language: 'ja-JP',
          rate: 0.85,
          onDone: resolve,
          onStopped: resolve,
          onError: resolve,
        });
      });

      // 保存確認
      setLastAiText('この内容で保存しますか？');
      await new Promise(resolve => {
        Speech.speak('この内容で保存しますか？', {
          language: 'ja-JP',
          onDone: resolve,
        });
      });

      onGenerateDone(diaryText, src);
    } catch {
      Speech.speak('日記の生成に失敗しました。', { language: 'ja-JP' });
      setGenerating(false);
      setStatus('idle');
    }
  }

  function handleMicPress() {
    if (status === 'listening') {
      stopListening();
    } else if (status === 'idle') {
      startListening();
    } else if (status === 'speaking') {
      Speech.stop();
      startListening();
    }
  }

  const userCount = messages.filter(m => m.role === 'user').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      {/* ヘッダー */}
      <View style={s.voiceHeader}>
        <TouchableOpacity onPress={() => { Speech.stop(); Voice.destroy(); onBack(); }}>
          <Text style={s.voiceHeaderBack}>← 戻る</Text>
        </TouchableOpacity>
        <Text style={s.voiceHeaderTitle}>音声モード</Text>
        {userCount >= 2 && (
          <TouchableOpacity onPress={() => generateDiary()} disabled={generating}>
            <Text style={s.voiceHeaderBtn}>{generating ? '生成中' : '日記にする'}</Text>
          </TouchableOpacity>
        )}
        {userCount < 2 && <View style={{ width: 64 }} />}
      </View>

      {/* メインエリア */}
      <View style={s.voiceMain}>
        {/* ステータスインジケーター */}
        <Text style={s.voiceStatus}>
          {status === 'idle'      && 'マイクをタップして話しかける'}
          {status === 'listening' && '聞いています...'}
          {status === 'thinking'  && '考えています...'}
          {status === 'speaking'  && ''}
        </Text>

        {/* 認識中のテキスト */}
        {transcript ? (
          <Text style={s.voiceTranscript}>「{transcript}」</Text>
        ) : null}

        {/* AIの最後の発言 */}
        {(status === 'speaking' || status === 'idle') && lastAiText ? (
          <View style={s.voiceAiBubble}>
            <Text style={s.voiceAiText}>{lastAiText}</Text>
          </View>
        ) : null}

        {/* マイクボタン */}
        <View style={s.voiceMicWrap}>
          {status === 'listening' && (
            <Animated.View style={[s.voicePulse, { transform: [{ scale: pulseAnim }] }]} />
          )}
          <TouchableOpacity
            style={[
              s.voiceMicBtn,
              status === 'listening' && s.voiceMicBtnActive,
              status === 'thinking'  && s.voiceMicBtnThinking,
              status === 'speaking'  && s.voiceMicBtnSpeaking,
            ]}
            onPress={handleMicPress}
            disabled={status === 'thinking' || generating}
          >
            {status === 'thinking' ? (
              <ActivityIndicator color={C.paper} />
            ) : (
              <Text style={s.voiceMicIcon}>
                {status === 'listening' ? '⏹' :
                 status === 'speaking'  ? '⏩' : '🎤'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ヒント */}
        <Text style={s.voiceHint}>
          {status === 'speaking' ? '⏩ タップでスキップ' :
           status === 'listening' ? '⏹ タップで送信' :
           `${userCount}回話しました${userCount >= 2 ? '　日記にできます' : ''}`}
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ── テキストチャット画面 ──────────────────────────────────────────
function ChatScreen({ onBack, onGenerateDone, targetDate, onSwitchToVoice }) {
  const dateLabel = targetDate && targetDate !== todayJST()
    ? formatDate(targetDate).full : null;
  const firstMsg = dateLabel
    ? `${dateLabel}のことを振り返ってみましょう。どんな一日でしたか？`
    : getInitialMessage();
  const [messages, setMessages] = useState([{ role: 'assistant', content: firstMsg }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [starterUsed, setStarterUsed] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    Voice.onSpeechResults = (e) => {
      const text = e.value?.[0] || '';
      if (text) setInput(prev => prev ? `${prev} ${text}` : text);
    };
    Voice.onSpeechEnd = () => setIsListening(false);
    Voice.onSpeechError = () => setIsListening(false);
    return () => { Voice.destroy().then(Voice.removeAllListeners); };
  }, []);

  async function startListening() {
    try { setIsListening(true); await Voice.start('ja-JP'); }
    catch { setIsListening(false); Alert.alert('エラー', '音声認識を開始できませんでした'); }
  }

  async function stopListening() {
    try { await Voice.stop(); } catch {}
    setIsListening(false);
  }

  const userTurnCount = messages.filter(m => m.role === 'user').length;
  const canGenerate = userTurnCount >= 2;

  async function callClaude(messageList) {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: SYSTEM_PROMPT,
        messages: messageList.map(m => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || 'すみません、もう一度教えてください。';
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    try {
      const reply = await callClaude(newMessages);
      if (reply.trim() === '[GENERATE]') {
        setLoading(false);
        setGenerating(true);
        await generateDiary(newMessages);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        setLoading(false);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '少し問題が発生しました。もう一度試してみてください。' }]);
      setLoading(false);
    }
  }

  function handleStarter(starter) {
    if (starterUsed || loading) return;
    setStarterUsed(true);
    setMessages([messages[0], { role: 'user', content: starter }, { role: 'assistant', content: getStarterResponse(starter) }]);
  }

  async function generateDiary(msgList) {
    setGenerating(true);
    const src = msgList || messages;
    try {
      const conversation = src
        .map(m => `${m.role === 'user' ? 'あなた' : '綴り'}: ${m.content}`)
        .join('\n');
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{ role: 'user', content: getDiaryPrompt(conversation) }],
        }),
      });
      const data = await res.json();
      onGenerateDone(data.content?.[0]?.text || '', src);
    } catch {
      Alert.alert('エラー', '日記の生成に失敗しました。もう一度試してください。');
    }
    setGenerating(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}>
        {onBack
          ? <TouchableOpacity onPress={onBack}><Text style={s.iconBtn}>← 戻る</Text></TouchableOpacity>
          : <Text style={s.headerTitle}>綴り</Text>
        }
        <Text style={s.headerSub}>{dateLabel || 'テキスト'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {/* 音声モード切り替えボタン */}
          {onSwitchToVoice && (
            <TouchableOpacity style={s.modeSwitchBtn} onPress={onSwitchToVoice}>
              <Text style={s.modeSwitchBtnText}>🎤 音声</Text>
            </TouchableOpacity>
          )}
          {canGenerate ? (
            <TouchableOpacity style={s.btnAccentSm} onPress={() => generateDiary()} disabled={generating || loading}>
              <Text style={s.btnAccentSmText}>{generating ? '生成中...' : '日記にする'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 72 }} />
          )}
        </View>
      </View>

      {!canGenerate && userTurnCount > 0 && (
        <View style={s.turnIndicator}>
          <Text style={s.turnIndicatorText}>あと{2 - userTurnCount}回話すと日記にできます</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={s.chatMessages}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        {messages.map((m, i) => (
          <View key={i} style={[s.message, m.role === 'user' ? s.messageUser : s.messageAi]}>
            <Text style={s.messageSender}>{m.role === 'user' ? 'あなた' : '綴り'}</Text>
            <View style={[m.role === 'user' ? s.bubbleUser : s.bubbleAi]}>
              <Text style={[s.messageBubbleText, m.role === 'user' && { color: C.paper }]}>{m.content}</Text>
            </View>
          </View>
        ))}
        {(loading || generating) && (
          <View style={[s.message, s.messageAi]}>
            <Text style={s.messageSender}>綴り</Text>
            <View style={s.bubbleAi}><ActivityIndicator size="small" color={C.inkFaint} /></View>
          </View>
        )}
      </ScrollView>

      {!starterUsed && messages.length <= 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.starterScroll} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {STARTERS.map(st => (
            <TouchableOpacity key={st} style={s.starterBtn} onPress={() => handleStarter(st)}>
              <Text style={s.starterBtnText}>{st}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.chatInputBar}>
          <TouchableOpacity
            style={[s.voiceBtn, isListening && s.voiceBtnActive]}
            onPress={isListening ? stopListening : startListening}
            disabled={loading}
          >
            <Text style={{ fontSize: 20 }}>{isListening ? '⏹' : '🎤'}</Text>
          </TouchableOpacity>
          <TextInput
            style={s.chatInput}
            value={input}
            onChangeText={setInput}
            placeholder={isListening ? '聞いています...' : '話しかけるか、入力してください'}
            placeholderTextColor={isListening ? C.accent : C.inkFaint}
            multiline
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.btnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <Text style={{ color: C.paper, fontSize: 18 }}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── 記録タブ ──────────────────────────────────────────────────────
function RecordListScreen({ entries, onSelectEntry, onWriteForDate }) {
  const [view, setView] = useState('list');
  const today = todayJST();
  const todayDate = new Date(today);
  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth());
  const entryDates = new Set(entries.map(e => e.date));
  const entryMap = Object.fromEntries(entries.map(e => [e.date, e]));
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const thisMonthCount = entries.filter(e => e.date.startsWith(monthStr)).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}>
        <Text style={s.headerTitle}>綴り</Text>
        <View style={s.viewToggle}>
          <TouchableOpacity style={[s.toggleBtn, view === 'list' && s.toggleBtnActive]} onPress={() => setView('list')}>
            <Text style={[s.toggleBtnText, view === 'list' && s.toggleBtnTextActive]}>一覧</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.toggleBtn, view === 'calendar' && s.toggleBtnActive]} onPress={() => setView('calendar')}>
            <Text style={[s.toggleBtnText, view === 'calendar' && s.toggleBtnTextActive]}>カレンダー</Text>
          </TouchableOpacity>
        </View>
      </View>

      {view === 'list' ? (
        <ScrollView style={s.homeContent} contentContainerStyle={{ paddingBottom: 32 }}>
          {entries.length === 0 ? (
            <View style={s.emptyState}>
              <Text style={s.emptyStateText}>まだ日記がありません</Text>
            </View>
          ) : entries.map(e => {
            const { d, dow } = formatDate(e.date);
            const isToday = e.date === today;
            return (
              <TouchableOpacity key={e.date} style={s.entryItem} onPress={() => onSelectEntry(e)}>
                <View style={s.entryDateCol}>
                  <Text style={[s.entryDay, isToday && { color: C.accent }]}>{d}</Text>
                  <Text style={s.entryWeekday}>{dow}</Text>
                </View>
                <View style={[s.moodDot, isToday && { backgroundColor: C.accent }]} />
                <Text style={s.entryPreview} numberOfLines={2}>{e.text}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={s.calHeader}>
            <TouchableOpacity onPress={() => month === 0 ? (setYear(y => y-1), setMonth(11)) : setMonth(m => m-1)}>
              <Text style={s.iconBtn}>‹</Text>
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={s.calMonth}>{year}年 {month + 1}月</Text>
              <Text style={s.calCount}>{thisMonthCount}日記録</Text>
            </View>
            <TouchableOpacity onPress={() => month === 11 ? (setYear(y => y+1), setMonth(0)) : setMonth(m => m+1)}>
              <Text style={s.iconBtn}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={s.calGrid}>
            {['日','月','火','水','木','金','土'].map(d => (
              <Text key={d} style={s.calDayLabel}>{d}</Text>
            ))}
            {cells.map((day, i) => {
              if (!day) return <View key={`e${i}`} style={s.calDay} />;
              const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
              const hasEntry = entryDates.has(dateStr);
              const isToday = dateStr === today;
              const isFuture = dateStr > today;
              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[s.calDay, isToday && s.calDayToday, isFuture && { opacity: 0.25 }]}
                  disabled={isFuture}
                  onPress={() => hasEntry ? onSelectEntry(entryMap[dateStr]) : onWriteForDate(dateStr)}
                >
                  <Text style={[s.calDayText, isToday && { color: C.paper }, hasEntry && { fontWeight: '600' }]}>{day}</Text>
                  {hasEntry && <View style={[s.calDot, isToday && { backgroundColor: C.accentLight }]} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 日記プレビュー ────────────────────────────────────────────────
function DiaryPreviewScreen({ diary, conversation, onBack, onSaved, targetDate }) {
  const [text, setText] = useState(diary);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const date = targetDate || todayJST();
  const { full } = formatDate(date);

  async function save() {
    setSaving(true);
    try {
      await apiFetch('/diary', { method: 'POST', body: JSON.stringify({ text, date, conversation, moodIdx: 0 }) });
      onSaved(text);
    } catch (e) { Alert.alert('エラー', e.message); }
    setSaving(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.iconBtn}>← 話し直す</Text></TouchableOpacity>
        <Text style={s.headerSub}>日記のプレビュー</Text>
        <TouchableOpacity onPress={() => setEditing(v => !v)}>
          <Text style={s.iconBtn}>{editing ? '完了' : '編集'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>
        <Text style={s.previewDateLabel}>{full}</Text>
        {editing ? (
          <TextInput style={s.diaryTextarea} value={text} onChangeText={setText} multiline autoFocus textAlignVertical="top" />
        ) : (
          <Text style={s.diaryTextView}>{text}</Text>
        )}
        <View style={s.previewHint}>
          <Text style={s.previewHintText}>編集ボタンで内容を変更できます。</Text>
        </View>
      </ScrollView>
      <View style={s.previewFooter}>
        <TouchableOpacity style={[s.btnPrimary, saving && s.btnDisabled]} onPress={save} disabled={saving}>
          <Text style={s.btnPrimaryText}>{saving ? '保存中...' : 'この内容で保存する'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── 日記詳細 ──────────────────────────────────────────────────────
function DiaryDetail({ entry, onBack, onSave }) {
  const [text, setText] = useState(entry.text || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { full } = formatDate(entry.date);

  async function save() {
    setSaving(true);
    try {
      await apiFetch(`/diary/${entry.date}`, { method: 'PUT', body: JSON.stringify({ text, moodIdx: entry.moodIdx || 0 }) });
      onSave({ ...entry, text });
      setEditing(false);
    } catch (e) { Alert.alert('エラー', e.message); }
    setSaving(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.iconBtn}>← 戻る</Text></TouchableOpacity>
        <Text style={s.headerSub}>{full}</Text>
        {editing
          ? <TouchableOpacity style={s.btnAccentSm} onPress={save} disabled={saving}>
              <Text style={s.btnAccentSmText}>{saving ? '...' : '保存'}</Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={s.iconBtn}>編集</Text>
            </TouchableOpacity>
        }
      </View>
      <ScrollView style={{ flex: 1, padding: 24 }}>
        <Text style={s.diaryDateHeader}>{full}</Text>
        {editing
          ? <TextInput style={s.diaryTextarea} value={text} onChangeText={setText} multiline autoFocus textAlignVertical="top" />
          : <Text style={s.diaryTextView}>{text}</Text>
        }
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 設定 ──────────────────────────────────────────────────────────
function SettingsScreen({ user, onLogout, onCreateTestData, onDeleteToday }) {
  const TEST_TEXTS = [
    '今日は朝から雨だった。通勤電車の中でふと友人のことを思い出して、先週連絡したままになっていることに気がついた。昼休みに少し時間ができたので返信した。小さなことだけど、すっきりした。',
    'ミーティングが三つ続きの一日だった。最後の会議が終わったときにはもう外が暗くなっていた。精神的に疲れた気がするけど、帰りに買った小さなお菓子で週末を楽しみにすることにした。',
    '今日は時間をとって開発に集中できた。難しい問題につきあたっていたけど、小さな突破口が見つかった気がする。明日また続きを試してみる。',
    '久しぶりに大学の友人と飲みに行った。お互いの最近の話をしていたらどんどん積もって、結局三時間近く居た。人と話すのはやっぱりいいものだと改めて思った。',
    '朝起きたら天気が良くて少し長めに散歩した。近所の公園にもう梅が咲いていた。写真を何枚か撮ったけど、やっぱり目で見た一瞬がいちばんいい。',
    '見積もり作業に終日かかった。数字を組み立てる作業は苦手だけど、最終的に整ったときに満足感がある。夜は少し早めに寝て体を休めたい。',
    '何もなかった一日。それでもコーヒーが特別うまく淹れられた。そのくらいか。',
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}><Text style={s.headerTitle}>設定</Text></View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={s.settingsSectionTitle}>アカウント</Text>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>プラン</Text>
          <Text style={s.settingsValue}>Standard（テスト中）</Text>
        </View>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>記録した日数</Text>
          <Text style={s.settingsValue}>{user?.totalEntries || 0} 日</Text>
        </View>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>合計文字数</Text>
          <Text style={s.settingsValue}>{(user?.totalChars || 0).toLocaleString()} 字</Text>
        </View>
        <TouchableOpacity style={s.logoutBtn} onPress={onLogout}>
          <Text style={s.logoutBtnText}>ロック（次回はFace IDで開く）</Text>
        </TouchableOpacity>
        <Text style={[s.settingsSectionTitle, { marginTop: 28 }]}>開発テスト</Text>
        <TouchableOpacity style={s.testBtn} onPress={onCreateTestData}>
          <Text style={s.testBtnText}>テスト日記を作成（過去7日分）</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.testBtn, { marginTop: 8 }]} onPress={onDeleteToday}>
          <Text style={s.testBtnText}>今日の日記を削除</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── ボトムタブ ────────────────────────────────────────────────────
const TABS = [
  { key: 'chat',     icon: '✎', label: '話す' },
  { key: 'records',  icon: '≡', label: '記録' },
  { key: 'settings', icon: '◎', label: '設定' },
];

// ── メインApp ─────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [user, setUser]       = useState(null);
  const [entries, setEntries] = useState([]);
  const [tab, setTab]         = useState('chat');
  // screen: null | 'chat' | 'voice' | 'preview' | 'detail'
  const [screen, setScreen]   = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [pendingDiary, setPendingDiary]   = useState(null);
  const [targetDate, setTargetDate]       = useState(null);
  const [toast, setToast]     = useState('');
  const toastOpacity          = useRef(new Animated.Value(0)).current;

  function showToast(msg) {
    setToast(msg);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  useEffect(() => {
    SecureStore.getItemAsync('tsz_token').then(async token => {
      if (!token) { setChecking(false); return; }
      const hasBio = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasBio && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: '綴りを開く',
          fallbackLabel: 'パスコードを使用',
        });
        if (!result.success) { setChecking(false); return; }
      }
      apiFetch('/auth/me')
        .then(data => { setUser(data); setAuthed(true); })
        .catch(e => { if (e.message === 'Unauthorized') SecureStore.deleteItemAsync('tsz_token'); })
        .finally(() => setChecking(false));
    });
  }, []);

  useEffect(() => {
    if (!authed) return;
    apiFetch('/diary').then(data => setEntries(data.entries || [])).catch(() => {});
  }, [authed]);

  function handleLogin(data) { setUser(data); setAuthed(true); }
  async function handleLogout() {
    setAuthed(false); setUser(null); setEntries([]);
    setTab('chat'); setScreen(null);
  }
  function handleWriteForDate(date) { setTargetDate(date); setScreen('chat'); }
  function handleGenerateDone(diaryText, conversation) {
    setPendingDiary({ text: diaryText, conversation, targetDate });
    setScreen('preview');
  }
  function handleSaved(text) {
    const date = pendingDiary?.targetDate || todayJST();
    setEntries(prev => [{ date, text, moodIdx: 0 }, ...prev.filter(e => e.date !== date)]);
    showToast('日記を保存しました');
    setTargetDate(null); setScreen(null); setPendingDiary(null);
    setTab('records');
  }
  function handleSelectEntry(entry) { setSelectedEntry(entry); setScreen('detail'); }
  function handleEntryUpdate(updated) {
    setEntries(prev => prev.map(e => e.date === updated.date ? updated : e));
    setSelectedEntry(updated);
    showToast('更新しました');
  }
  async function handleCreateTestData() {
    const TEST_TEXTS = [
      '今日は朝から雨だった。通勤電車の中でふと友人のことを思い出して、先週連絡したままになっていることに気がついた。昼休みに少し時間ができたので返信した。小さなことだけど、すっきりした。',
      'ミーティングが三つ続きの一日だった。最後の会議が終わったときにはもう外が暗くなっていた。精神的に疲れた気がするけど、帰りに買った小さなお菓子で週末を楽しみにすることにした。',
      '今日は時間をとって開発に集中できた。難しい問題につきあたっていたけど、小さな突破口が見つかった気がする。明日また続きを試してみる。',
      '久しぶりに大学の友人と飲みに行った。お互いの最近の話をしていたらどんどん積もって、結局三時間近く居た。人と話すのはやっぱりいいものだと改めて思った。',
      '朝起きたら天気が良くて少し長めに散歩した。近所の公園にもう梅が咲いていた。写真を何枚か撮ったけど、やっぱり目で見た一瞬がいちばんいい。',
      '見積もり作業に終日かかった。数字を組み立てる作業は苦手だけど、最終的に整ったときに満足感がある。夜は少し早めに寝て体を休めたい。',
      '何もなかった一日。それでもコーヒーが特別うまく淹れられた。そのくらいか。',
    ];
    let created = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.now() + 9 * 3600000 - i * 86400000);
      const date = d.toISOString().slice(0, 10);
      if (entries.find(e => e.date === date)) continue;
      try {
        await apiFetch('/diary', { method: 'POST', body: JSON.stringify({ text: TEST_TEXTS[(i-1) % TEST_TEXTS.length], date, moodIdx: 0 }) });
        created++;
      } catch {}
    }
    const data = await apiFetch('/diary');
    setEntries(data.entries || []);
    showToast(`${created}日分のテストデータを作成しました`);
  }
  async function handleDeleteToday() {
    const today = todayJST();
    try {
      await apiFetch(`/diary/${today}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.date !== today));
      showToast('今日の日記を削除しました');
    } catch (e) { showToast('削除失敗：' + e.message); }
  }

  if (checking) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}>
      <ActivityIndicator color={C.inkFaint} />
    </View>
  );

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  // オーバーレイ画面
  if (screen === 'voice') {
    return (
      <VoiceChatScreen
        onBack={() => setScreen(null)}
        onGenerateDone={handleGenerateDone}
        targetDate={targetDate}
      />
    );
  }
  if (screen === 'chat') {
    return (
      <ChatScreen
        onBack={() => { setScreen(null); setTargetDate(null); }}
        onGenerateDone={handleGenerateDone}
        targetDate={targetDate}
        onSwitchToVoice={() => setScreen('voice')}
      />
    );
  }
  if (screen === 'preview' && pendingDiary) {
    return (
      <DiaryPreviewScreen
        diary={pendingDiary.text}
        conversation={pendingDiary.conversation}
        targetDate={pendingDiary.targetDate}
        onBack={() => setScreen('chat')}
        onSaved={handleSaved}
      />
    );
  }
  if (screen === 'detail' && selectedEntry) {
    return <DiaryDetail entry={selectedEntry} onBack={() => setScreen(null)} onSave={handleEntryUpdate} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {tab === 'chat' && (
        <ChatScreen
          onBack={null}
          onGenerateDone={handleGenerateDone}
          targetDate={null}
          onSwitchToVoice={() => setScreen('voice')}
        />
      )}
      {tab === 'records' && (
        <RecordListScreen entries={entries} onSelectEntry={handleSelectEntry} onWriteForDate={handleWriteForDate} />
      )}
      {tab === 'settings' && (
        <SettingsScreen user={user} onLogout={handleLogout} onCreateTestData={handleCreateTestData} onDeleteToday={handleDeleteToday} />
      )}

      <View style={s.bottomNav}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={s.navItem} onPress={() => setTab(t.key)}>
            <Text style={[s.navIcon, tab === t.key && { color: C.ink }]}>{t.icon}</Text>
            <Text style={[s.navLabel, tab === t.key && { color: C.ink }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
        <Text style={{ color: C.paper, fontSize: 13 }}>{toast}</Text>
      </Animated.View>
    </View>
  );
}

// ── スタイル ──────────────────────────────────────────────────────
const s = StyleSheet.create({
  ruleLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(26,21,16,0.08)' },

  loginWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loginLogo:      { fontSize: 48, color: '#1a1510', fontWeight: '300', marginBottom: 4, letterSpacing: 4 },
  loginTagline:   { fontSize: 12, color: '#9a8f85', letterSpacing: 2, marginBottom: 40 },
  loginCard:      { width: '100%', maxWidth: 360, backgroundColor: '#ffffff', padding: 24, borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)', shadowColor: '#1a1510', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  btnPrimary:     { backgroundColor: '#1a1510', padding: 14, alignItems: 'center' },
  btnPrimaryText: { color: '#f5f0e8', fontSize: 14, letterSpacing: 1 },
  btnDisabled:    { opacity: 0.4 },
  loginHint:      { fontSize: 11, color: '#9a8f85', textAlign: 'center', marginTop: 12, lineHeight: 18 },
  errorMsg:       { fontSize: 12, color: '#c0392b', marginBottom: 8 },

  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)', backgroundColor: '#f5f0e8' },
  headerTitle:    { fontSize: 22, color: '#1a1510', fontWeight: '300', letterSpacing: 2 },
  headerSub:      { fontSize: 11, color: '#9a8f85', letterSpacing: 1 },
  iconBtn:        { fontSize: 14, color: '#4a3f35' },

  // テキストモード切り替えボタン
  modeSwitchBtn:     { borderWidth: 1, borderColor: 'rgba(26,21,16,0.2)', paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 },
  modeSwitchBtnText: { fontSize: 12, color: '#4a3f35' },

  homeContent:    { flex: 1, padding: 16 },
  entryItem:      { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)', gap: 12 },
  entryDateCol:   { width: 32, alignItems: 'center' },
  entryDay:       { fontSize: 20, fontWeight: '500', color: '#1a1510' },
  entryWeekday:   { fontSize: 10, color: '#9a8f85' },
  moodDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#9a8f85', marginTop: 6 },
  entryPreview:   { flex: 1, fontSize: 13, color: '#4a3f35', lineHeight: 20 },
  emptyState:     { alignItems: 'center', paddingVertical: 48 },
  emptyStateText: { fontSize: 14, color: '#9a8f85', textAlign: 'center', lineHeight: 24 },

  viewToggle:          { flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(26,21,16,0.2)', overflow: 'hidden' },
  toggleBtn:           { paddingHorizontal: 14, paddingVertical: 6 },
  toggleBtnActive:     { backgroundColor: '#1a1510' },
  toggleBtnText:       { fontSize: 12, color: '#9a8f85' },
  toggleBtnTextActive: { color: '#f5f0e8' },

  turnIndicator:     { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#ede7d9', borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  turnIndicatorText: { fontSize: 11, color: '#9a8f85', textAlign: 'center', letterSpacing: 0.5 },

  chatMessages:      { flex: 1, padding: 16, backgroundColor: '#f5f0e8' },
  message:           { marginBottom: 16 },
  messageAi:         { alignItems: 'flex-start' },
  messageUser:       { alignItems: 'flex-end' },
  messageSender:     { fontSize: 10, color: '#9a8f85', letterSpacing: 1, marginBottom: 4 },
  messageBubbleText: { fontSize: 15, lineHeight: 24 },
  bubbleAi:          { backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)', borderTopRightRadius: 8, borderBottomRightRadius: 8, borderBottomLeftRadius: 8, padding: 12, maxWidth: '80%' },
  bubbleUser:        { backgroundColor: '#1a1510', borderRadius: 8, borderBottomRightRadius: 0, padding: 12, maxWidth: '80%' },

  starterScroll:  { borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#ede7d9', flexGrow: 0 },
  starterBtn:     { backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)', paddingHorizontal: 14, paddingVertical: 8 },
  starterBtnText: { fontSize: 12, color: '#4a3f35' },

  chatInputBar:   { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#ffffff' },
  chatInput:      { flex: 1, padding: 14, fontSize: 15, color: '#1a1510', maxHeight: 120 },
  sendBtn:        { backgroundColor: '#1a1510', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  voiceBtn:       { paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: 'rgba(26,21,16,0.12)' },
  voiceBtnActive: { backgroundColor: '#fff0e8' },

  // 音声モード専用スタイル
  voiceHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  voiceHeaderBack: { fontSize: 14, color: 'rgba(245,240,232,0.6)' },
  voiceHeaderTitle:{ fontSize: 14, color: '#f5f0e8', letterSpacing: 2 },
  voiceHeaderBtn:  { fontSize: 13, color: '#c4956a' },

  voiceMain:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  voiceStatus:     { fontSize: 13, color: 'rgba(245,240,232,0.5)', letterSpacing: 1.5, marginBottom: 24, textAlign: 'center' },
  voiceTranscript: { fontSize: 16, color: '#f5f0e8', textAlign: 'center', marginBottom: 24, fontStyle: 'italic', lineHeight: 26 },
  voiceAiBubble:   { backgroundColor: 'rgba(245,240,232,0.1)', padding: 20, marginBottom: 48, maxWidth: '100%', borderLeftWidth: 2, borderLeftColor: '#c4956a' },
  voiceAiText:     { fontSize: 16, color: 'rgba(245,240,232,0.85)', lineHeight: 28, textAlign: 'center' },

  voiceMicWrap:    { alignItems: 'center', justifyContent: 'center', marginBottom: 24, width: 120, height: 120 },
  voicePulse:      { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(139,94,60,0.3)' },
  voiceMicBtn:     { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(245,240,232,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(245,240,232,0.2)' },
  voiceMicBtnActive:   { backgroundColor: '#8b5e3c', borderColor: '#c4956a' },
  voiceMicBtnThinking: { backgroundColor: 'rgba(245,240,232,0.08)', borderColor: 'rgba(245,240,232,0.1)' },
  voiceMicBtnSpeaking: { backgroundColor: 'rgba(196,149,106,0.2)', borderColor: '#c4956a' },
  voiceMicIcon:    { fontSize: 32 },
  voiceHint:       { fontSize: 11, color: 'rgba(245,240,232,0.3)', letterSpacing: 1, textAlign: 'center' },

  previewDateLabel:{ fontSize: 11, color: '#9a8f85', letterSpacing: 2, marginBottom: 20 },
  previewHint:     { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)' },
  previewHintText: { fontSize: 11, color: '#9a8f85', lineHeight: 18, textAlign: 'center' },
  previewFooter:   { padding: 16, borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#f5f0e8' },

  diaryDateHeader: { fontSize: 12, color: '#9a8f85', letterSpacing: 2, marginBottom: 20 },
  diaryTextarea:   { fontSize: 16, color: '#1a1510', lineHeight: 32, minHeight: 400 },
  diaryTextView:   { fontSize: 16, color: '#1a1510', lineHeight: 32, minHeight: 200 },

  calHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  calMonth:        { fontSize: 16, color: '#1a1510' },
  calCount:        { fontSize: 11, color: '#9a8f85', marginTop: 2 },
  calGrid:         { flexDirection: 'row', flexWrap: 'wrap' },
  calDayLabel:     { width: '14.28%', textAlign: 'center', fontSize: 10, color: '#9a8f85', paddingVertical: 6 },
  calDay:          { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDayToday:     { backgroundColor: '#1a1510', borderRadius: 99 },
  calDayText:      { fontSize: 13, color: '#4a3f35' },
  calDot:          { width: 4, height: 4, borderRadius: 2, backgroundColor: '#8b5e3c', marginTop: 2 },

  settingsSectionTitle: { fontSize: 10, color: '#9a8f85', letterSpacing: 2, marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  settingsRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  settingsLabel:   { fontSize: 14, color: '#1a1510' },
  settingsValue:   { fontSize: 13, color: '#9a8f85' },
  logoutBtn:       { marginTop: 32, borderWidth: 1.5, borderColor: '#c0392b', padding: 14, alignItems: 'center' },
  logoutBtnText:   { color: '#c0392b', fontSize: 14 },

  bottomNav:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#f5f0e8', paddingBottom: Platform.OS === 'ios' ? 20 : 4 },
  navItem:         { flex: 1, alignItems: 'center', paddingVertical: 10 },
  navIcon:         { fontSize: 20, color: '#9a8f85' },
  navLabel:        { fontSize: 10, color: '#9a8f85', letterSpacing: 1, marginTop: 2 },

  btnAccentSm:     { backgroundColor: '#8b5e3c', paddingHorizontal: 14, paddingVertical: 7 },
  btnAccentSmText: { color: '#ffffff', fontSize: 12 },

  toast:           { position: 'absolute', bottom: 80, alignSelf: 'center', backgroundColor: '#1a1510', paddingHorizontal: 20, paddingVertical: 10 },

  testBtn:         { borderWidth: 1, borderColor: '#9a8f85', padding: 12, alignItems: 'center' },
  testBtnText:     { fontSize: 13, color: '#9a8f85' },

  lineLoginBtn:     { backgroundColor: '#06C755', padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  lineLoginBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
});
