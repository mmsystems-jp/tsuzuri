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

WebBrowser.maybeCompleteAuthSession();

const LINE_CHANNEL_ID = '2009194648';
const LINE_CHANNEL_SECRET = 'e79ea0ffe3244d8344124c2aa5b3ba3a';
const LINE_REDIRECT_URI = AuthSession.makeRedirectUri({ useProxy: true });
const LINE_DISCOVERY = {
  authorizationEndpoint: 'https://access.line.me/oauth2/v2.1/authorize',
  tokenEndpoint: 'https://api.line.me/oauth2/v2.1/token',
};

const API_URL = 'https://o5k36gp6jd.execute-api.ap-northeast-1.amazonaws.com';
const ANTHROPIC_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

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
};

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
  if (h < 20) return 'おつかれさまでした。今日一日、何かひとつ印象に残ったことを聞かせてもらえますか？';
  return 'おつかれさまです。今日はどんな一日でしたか。ゆっくり話しましょう。';
}

function getStarterResponse(starter) {
  const map = {
    'よい一日だった':      'それはよかったです。どんなことが特に嬉しかったか、もう少し聞かせてもらえますか？',
    '少し疲れた':          'お疲れさまです。何がいちばん大変でしたか？',
    'なんでもない一日':    'そういう日もありますよね。それでも、小さなことでもいいので、何か覚えていることはありましたか？',
    '嬉しいことがあった':  'それはよかった！どんなことがあったんですか？',
    '悩んでいることがある':'話してくれてありがとうございます。どんなことが気になっていますか？',
  };
  return map[starter] || '聞かせてくれてありがとうございます。もう少し詳しく聞かせてもらえますか？';
}

const STARTERS = ['よい一日だった','少し疲れた','なんでもない一日','嬉しいことがあった','悩んでいることがある'];

const SYSTEM_PROMPT = `あなたは「綴り」というAI日記アプリの、やさしい友人です。
【役割】ユーザーが今日あったことや気持ちを話しやすいよう、自然な会話で引き出してください。カウンセラーのように共感しながら、日常のひとコマを一緒に振り返る存在です。
【会話の進め方】1. まず書き手の話をしっかり受け止め、共感を示す 2. 気持ちや状況をもう少し引き出す問いをひとつだけする 3. 具体的にどんな場面だったかを一言で掘り下げる 4. ユーザーの発言が十分な量になったら、会話を自然に締めくくり「今日のことを日記にまとめてみましょうか？」と聞く。それ以前でも話が一区切りついたと感じたら同様に進めていい

【守るルール】- 質問は必ず一度に一つだけ - 一つの返答は50〜80文字以内に収める - 「なるほど」「そうですね」だけで終わらず、必ず次の問いかけをする - 「大丈夫ですか？」「頑張ってください」などの形式的な励ましは避ける - ユーザーが話したくなるような、具体的で温かい問いかけをする - 敬体（丁寧語）は一切使わない
【日記生成の判断】「日記にまとめてみましょうか？」と聞いた後：
- ユーザーが「はい」「うん」「お願い」「いいよ」など承諾したら [GENERATE] とだけ返す
- ユーザーが「いいえ」「まだ」「もう少し話したい」など断ったら、会話を自然に続ける
- ユーザーが新しい話題を話し始めたら、その話題に乗って会話を続ける`;

function getDiaryPrompt(conversation) {
  return `以下の、ある人が今日一日について話した会話です。この会話をもとに、その人の一人称日記を書いてください。
【守るルール】- 一人称（「今日は」「私は」など）で書く - Markdownは一切使わない（見出しも箇条書きも使わない）- 素の文字のみで書く。会話の引用もしない - その人が辿った感情を、具体的な場面とともに表現する
- 誇張しすぎず、自己中心大の感情で書く - 200〜350文字程度に収める - 「。」で文字を区切り、読みやすいリズムにする

会話：${conversation}`;
}

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

function HomeScreen({ onBegin, onContinue, onSelectEntry, entries }) {
  const today = todayJST();
  const todayEntry = entries.find(e => e.date === today);
  const greeting = getInitialMessage();
  const { full } = formatDate(today);
  const [expanded, setExpanded] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ flex: 1, padding: 28, justifyContent: 'center' }}>
        <Text style={[s.homeGreeting, { marginBottom: 32 }]}>{full}</Text>

        <View style={s.homeCard}>
          <Text style={s.homeCardSub}>綴り</Text>

          {todayEntry ? (
            <>
              <Text
                style={s.homeCardMessage}
                numberOfLines={expanded ? 0 : 3}
              >{todayEntry.text}</Text>
              <TouchableOpacity onPress={() => setExpanded(v => !v)}>
                <Text style={s.homeCardReadMore}>{expanded ? '折りたたむ' : '続きを読む'}</Text>
              </TouchableOpacity>
              <View style={s.homeCardDivider} />
              <TouchableOpacity style={s.homeCardBtn} onPress={onContinue}>
                <Text style={s.homeCardBtnText}>続きを書く</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.homeCardBtnOutline, { marginTop: 10 }]} onPress={() => onSelectEntry(todayEntry)}>
                <Text style={s.homeCardBtnOutlineText}>見るだけ</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.homeCardMessage}>{greeting}</Text>
              <TouchableOpacity style={s.homeCardBtn} onPress={onBegin}>
                <Text style={s.homeCardBtnText}>話し始める</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

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
            <Text style={s.loginHint}>はじめての方はそのままアカウント作成されます</Text>
          </View>
        </View>
      </SafeAreaView>
    </RuledBackground>
  );
}

function ChatScreen({ onBack, onGenerateDone, targetDate, questionCount = 2 }) {
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
  const scrollRef = useRef(null);

  const userTurnCount = messages.filter(m => m.role === 'user').length;
  const canGenerate = userTurnCount >= questionCount;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (canGenerate) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [canGenerate]);

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
    return data.content?.[0]?.text || 'すみません、もう一度答えてください。';
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
        <Text style={s.headerSub}>{dateLabel || ''}</Text>
        {canGenerate ? (
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity style={[s.btnAccentSm, s.btnAccentSmActive]} onPress={() => generateDiary()} disabled={generating || loading}>
              <Text style={s.btnAccentSmActiveText}>{generating ? '生成中...' : '日記にする ✦'}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={{ width: 72 }} />
        )}
      </View>

      {userTurnCount > 0 && (
        <View style={[s.turnIndicator, canGenerate && s.turnIndicatorReady]}>
          <Text style={[s.turnIndicatorText, canGenerate && s.turnIndicatorTextReady]}>
            {canGenerate ? '右上のボタンから日記にまとめられます' : `あと${questionCount - userTurnCount}回話すと日記にできます`}
          </Text>
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
          <TextInput
            style={s.chatInput}
            value={input}
            onChangeText={setInput}
            placeholder="今日のことを話してください"
            placeholderTextColor={C.inkFaint}
            multiline
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || loading) && s.btnDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            <Text style={{ color: C.paper, fontSize: 18 }}>→</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function RecordListScreen({ entries, onSelectEntry, onWriteForDate }) {
  const today = todayJST();
  const entryDates = new Set(entries.map(e => e.date));
  const entryMap = Object.fromEntries(entries.map(e => [e.date, e]));

  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  const [selectedDate, setSelectedDate] = useState(today);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const months = [...new Set(weekDays.map(d => parseInt(d.slice(5, 7))))];
  const year = parseInt(weekStart.slice(0, 4));
  const monthLabel = months.map(m => `${m}月`).join('・');

  // アコーディオン用
  const allMonthKeys = [];
  const seen = new Set();
  entries.forEach(e => {
    const mk = e.date.slice(0, 7);
    if (!seen.has(mk)) { seen.add(mk); allMonthKeys.push(mk); }
  });
  const defaultOpen = allMonthKeys.includes(today.slice(0, 7)) ? today.slice(0, 7) : allMonthKeys[0];
  const [openMonth, setOpenMonth] = useState(defaultOpen);

  function handleDayPress(dateStr) {
    if (dateStr > today) return;
    setSelectedDate(dateStr);
  }

  const DAYS = ['日','月','火','水','木','金','土'];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}>
        <Text style={s.headerTitle}>記録</Text>
      </View>

      {/* 週カレンダー */}
      <View style={s.weekCalWrap}>
        <View style={s.weekNavRow}>
          <TouchableOpacity onPress={() => setWeekStart(addDays(weekStart, -7))}>
            <Text style={s.weekNavBtn}>‹</Text>
          </TouchableOpacity>
          <Text style={s.weekNavLabel}>{year}年 {monthLabel}</Text>
          <TouchableOpacity
            onPress={() => setWeekStart(addDays(weekStart, 7))}
            disabled={weekStart >= getWeekStart(today)}
          >
            <Text style={[s.weekNavBtn, weekStart >= getWeekStart(today) && { color: 'transparent' }]}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={s.weekDaysRow}>
          {weekDays.map(dateStr => {
            const day = parseInt(dateStr.slice(8));
            const dow = new Date(dateStr).getDay();
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasEntry = entryDates.has(dateStr);
            const isFuture = dateStr > today;
            return (
              <TouchableOpacity
                key={dateStr}
                style={s.weekDayCell}
                onPress={() => handleDayPress(dateStr)}
                disabled={isFuture}
              >
                <Text style={[s.weekDayLabel, dow === 0 && { color: '#c0392b' }, dow === 6 && { color: '#2980b9' }]}>
                  {DAYS[dow]}
                </Text>
                <View style={[
                  s.weekDayCircle,
                  isSelected && { backgroundColor: C.ink },
                  isToday && !isSelected && { borderWidth: 1.5, borderColor: C.ink },
                  isFuture && { opacity: 0.25 },
                ]}>
                  <Text style={[s.weekDayNum, isSelected && { color: C.paper }, hasEntry && { fontWeight: '600' }]}>
                    {day}
                  </Text>
                </View>
                <View style={[s.weekDot, { backgroundColor: hasEntry ? C.accent : 'transparent' }]} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>



      {/* アコーディオン */}
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {allMonthKeys.length === 0 ? (
          <View style={s.emptyState}>
            <Text style={s.emptyStateText}>まだ日記がありません</Text>
          </View>
        ) : allMonthKeys.map(mk => {
          const [y, m] = mk.split('-');
          const monthEntries = entries.filter(e => e.date.startsWith(mk));
          const isOpen = openMonth === mk;
          return (
            <View key={mk}>
              <TouchableOpacity style={s.accordionHeader} onPress={() => setOpenMonth(isOpen ? null : mk)}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                  <Text style={s.accordionTitle}>{y}年{parseInt(m)}月</Text>
                  <Text style={s.accordionCount}>{monthEntries.length}件</Text>
                </View>
                <Text style={[s.accordionChevron, isOpen && { transform: [{ rotate: '90deg' }] }]}>›</Text>
              </TouchableOpacity>
              {isOpen && (
                <View style={s.accordionBody}>
                  {monthEntries.map(e => {
                    const { d, dow } = formatDate(e.date);
                    const isToday = e.date === today;
                    return (
                      <TouchableOpacity key={e.date} style={s.entryItem} onPress={() => { setSelectedDate(e.date); onSelectEntry(e); }}>
                        <View style={s.entryDateCol}>
                          <Text style={[s.entryDay, isToday && { color: C.accent }]}>{d}</Text>
                          <Text style={s.entryWeekday}>{dow}</Text>
                        </View>
                        <View style={[s.moodDot, isToday && { backgroundColor: C.accent }]} />
                        <Text style={s.entryPreview} numberOfLines={2}>{e.text}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function DiaryPreviewScreen({ diary, conversation, onContinue, onRestart, onSaved, targetDate }) {
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
        <Text style={s.headerSub}>日記のプレビュー</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>
        <Text style={s.previewDateLabel}>{full}</Text>
        {editing ? (
          <TextInput style={s.diaryTextarea} value={text} onChangeText={setText} multiline autoFocus textAlignVertical="top"
            onBlur={() => setEditing(false)} />
        ) : (
          <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.8}>
            <Text style={s.diaryTextView}>{text}</Text>
            <Text style={{ fontSize: 11, color: C.inkFaint, marginTop: 8 }}>タップして編集</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 話し直すボタン2種 */}
      <View style={s.previewRetryRow}>
        <TouchableOpacity style={s.previewRetryBtn} onPress={onContinue}>
          <Text style={s.previewRetryText}>続きを話す</Text>
        </TouchableOpacity>
        <View style={{ width: 1, backgroundColor: C.line }} />
        <TouchableOpacity style={s.previewRetryBtn} onPress={onRestart}>
          <Text style={s.previewRetryText}>最初から話す</Text>
        </TouchableOpacity>
      </View>

      <View style={s.previewFooter}>
        <TouchableOpacity style={[s.btnPrimary, saving && s.btnDisabled]} onPress={save} disabled={saving}>
          <Text style={s.btnPrimaryText}>{saving ? '保存中...' : 'この内容で保存する'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

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

function SettingsScreen({ user, onLogout, onCreateTestData, onDeleteToday, questionCount, onChangeQuestionCount }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={s.header}><Text style={s.headerTitle}>設定</Text></View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={s.settingsSectionTitle}>会話設定</Text>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>AIの質問回数</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <TouchableOpacity onPress={() => onChangeQuestionCount(Math.max(1, questionCount - 1))} style={s.stepperBtn}>
              <Text style={s.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={s.stepperValue}>{questionCount}回</Text>
            <TouchableOpacity onPress={() => onChangeQuestionCount(Math.min(5, questionCount + 1))} style={s.stepperBtn}>
              <Text style={s.stepperBtnText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={s.settingsHint}>少ないと早めに日記生成できます。多いとより詳しく話すことができます、1〜5回。</Text>
        <Text style={[s.settingsSectionTitle, { marginTop: 28 }]}>アカウント</Text>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>プラン</Text>
          <Text style={s.settingsValue}>Standard（テスト中）</Text>
        </View>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>記録した日数</Text>
          <Text style={s.settingsValue}>{user?.totalEntries || 0} 日</Text>
        </View>
        <View style={s.settingsRow}>
          <Text style={s.settingsLabel}>累計文字数</Text>
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

const TABS = [
  { key: 'records',  label: '記録' },
  { key: 'settings', label: '設定' },
];

export default function App() {
  const [authed, setAuthed]   = useState(false);
  const [checking, setChecking] = useState(true);
  const [user, setUser]       = useState(null);
  const [entries, setEntries] = useState([]);
  const [tab, setTab]         = useState('home');
  const [screen, setScreen]   = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [pendingDiary, setPendingDiary]   = useState(null);
  const [targetDate, setTargetDate]       = useState(null);
  const [questionCount, setQuestionCount] = useState(2);
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
    SecureStore.getItemAsync('tsz_question_count').then(v => {
      if (v) setQuestionCount(parseInt(v));
    });
  }, []);

  async function handleChangeQuestionCount(n) {
    setQuestionCount(n);
    await SecureStore.setItemAsync('tsz_question_count', String(n));
  }

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
      '今日は朝から晴れだった。通勤電車の中でふと同僚のことを思い出して、連絡が途絶えたままになっていることに気がついた。仕事の合間に少し時間ができたので返信した。小さなことだけど、すっきりした。',
      'ミーティングが二つ続きの一日だった。最後の会議が終わったときにはもう首が痛くなっていた。現実的に疲れた感じがする。なのに帰りに寄ったコーヒー屋で騒ぐ小さな声で来週の楽しみにすることにした。',
      '今日は時間をとって開発に集中できた。難しい問題につきあたっていたけど、小さな突破口が見つかった感じがする。来日またも続きをやってみる。',
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
    } catch (e) { showToast('削除失敗: ' + e.message); }
  }

  if (checking) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.paper }}>
      <ActivityIndicator color={C.inkFaint} />
    </View>
  );

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  if (screen === 'chat') {
    return (
      <ChatScreen
        onBack={() => { setScreen(null); setTargetDate(null); }}
        onGenerateDone={handleGenerateDone}
        targetDate={targetDate}
        questionCount={questionCount}
      />
    );
  }
  if (screen === 'preview' && pendingDiary) {
    return (
      <DiaryPreviewScreen
        diary={pendingDiary.text}
        conversation={pendingDiary.conversation}
        targetDate={pendingDiary.targetDate}
        onContinue={() => setScreen('chat')}
        onRestart={() => { setPendingDiary(null); setScreen('chat'); }}
        onSaved={handleSaved}
      />
    );
  }
  if (screen === 'detail' && selectedEntry) {
    return <DiaryDetail entry={selectedEntry} onBack={() => setScreen(null)} onSave={handleEntryUpdate} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      {tab === 'home' && (
        <HomeScreen
          onBegin={() => { setTargetDate(null); setScreen('chat'); }}
          onContinue={() => { setTargetDate(todayJST()); setScreen('chat'); }}
          entries={entries}
          onSelectEntry={handleSelectEntry}
        />
      )}
      {tab === 'records' && (
        <RecordListScreen entries={entries} onSelectEntry={handleSelectEntry} onWriteForDate={handleWriteForDate} />
      )}
      {tab === 'settings' && (
        <SettingsScreen user={user} onLogout={handleLogout} onCreateTestData={handleCreateTestData} onDeleteToday={handleDeleteToday} questionCount={questionCount} onChangeQuestionCount={handleChangeQuestionCount} />
      )}

      <View style={s.bottomNav}>
        <TouchableOpacity style={s.navItem} onPress={() => setTab('records')}>
          {tab === 'records' && <View style={s.navActiveBar} />}
          <Text style={[s.navLabel, tab === 'records' && s.navLabelActive]}>記録</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.navCenterBtn} onPress={() => { setTab('home'); setScreen(null); }}>
          <View style={[s.navCenterInner, tab === 'home' && { backgroundColor: C.ink }]}>
            <Text style={[s.navCenterText, tab === 'home' && { color: C.paper }]}>綴</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={s.navItem} onPress={() => setTab('settings')}>
          {tab === 'settings' && <View style={s.navActiveBar} />}
          <Text style={[s.navLabel, tab === 'settings' && s.navLabelActive]}>設定</Text>
        </TouchableOpacity>
      </View>

      <Animated.View style={[s.toast, { opacity: toastOpacity }]}>
        <Text style={{ color: C.paper, fontSize: 13 }}>{toast}</Text>
      </Animated.View>
    </View>
  );
}

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
  turnIndicator:         { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#ede7d9', borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  turnIndicatorReady:     { backgroundColor: 'rgba(139,94,60,0.1)', borderBottomColor: 'rgba(139,94,60,0.2)' },
  turnIndicatorText:      { fontSize: 11, color: '#9a8f85', textAlign: 'center', letterSpacing: 0.5 },
  turnIndicatorTextReady: { color: '#8b5e3c', fontWeight: '500' },
  chatMessages:      { flex: 1, padding: 16, backgroundColor: '#f5f0e8' },
  message:           { marginBottom: 16 },
  messageAi:         { alignItems: 'flex-start' },
  messageUser:       { alignItems: 'flex-end' },
  messageSender:     { fontSize: 10, color: '#9a8f85', letterSpacing: 1, marginBottom: 4 },
  messageBubbleText: { fontSize: 15, lineHeight: 24 },
  bubbleAi:          { backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)', borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 16, padding: 14, maxWidth: '80%' },
  bubbleUser:        { backgroundColor: '#1a1510', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4, padding: 14, maxWidth: '80%' },
  starterScroll:  { borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#ede7d9', flexGrow: 0 },
  starterBtn:     { backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(26,21,16,0.2)', borderRadius: 99, paddingHorizontal: 16, paddingVertical: 9 },
  starterBtnText: { fontSize: 13, color: '#4a3f35' },
  chatInputBar:   { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#ffffff', paddingVertical: 6, paddingHorizontal: 8, gap: 8, alignItems: 'flex-end' },
  chatInput:      { flex: 1, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1a1510', maxHeight: 120, backgroundColor: '#f5f0e8', borderRadius: 20 },
  sendBtn:        { backgroundColor: '#1a1510', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  previewDateLabel:{ fontSize: 11, color: '#9a8f85', letterSpacing: 2, marginBottom: 20 },
  previewRetryRow:  { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  previewRetryBtn:   { flex: 1, paddingVertical: 13, alignItems: 'center' },
  previewRetryText:  { fontSize: 13, color: '#9a8f85' },
  previewFooter:   { padding: 16, borderTopWidth: 0, backgroundColor: '#f5f0e8' },
  diaryDateHeader: { fontSize: 12, color: '#9a8f85', letterSpacing: 2, marginBottom: 20 },
  diaryTextarea:   { fontSize: 16, color: '#1a1510', lineHeight: 32, minHeight: 400 },
  diaryTextView:   { fontSize: 16, color: '#1a1510', lineHeight: 32, minHeight: 200 },
  weekCalWrap:    { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  weekNavRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  weekNavBtn:     { fontSize: 22, color: '#9a8f85', paddingHorizontal: 4 },
  weekNavLabel:   { fontSize: 12, color: '#9a8f85', letterSpacing: 1 },
  weekDaysRow:    { flexDirection: 'row', justifyContent: 'space-between' },
  weekDayCell:    { flex: 1, alignItems: 'center', gap: 4 },
  weekDayLabel:   { fontSize: 10, color: '#9a8f85' },
  weekDayCircle:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  weekDayNum:     { fontSize: 15, fontWeight: '300', color: '#1a1510' },
  weekDot:        { width: 4, height: 4, borderRadius: 2 },
  selEntryWrap:   { padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)', backgroundColor: 'rgba(237,231,217,0.5)' },
  selEntryDate:   { fontSize: 11, color: '#9a8f85', letterSpacing: 0.5, marginBottom: 6 },
  selEntryText:   { fontSize: 13, color: '#4a3f35', lineHeight: 20, marginBottom: 10 },
  selEntryBtns:   { flexDirection: 'row', borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)' },
  selEntryBtn:    { flex: 1, paddingVertical: 10, alignItems: 'center' },
  selEntryBtnText:{ fontSize: 13, color: '#4a3f35' },
  selWriteBtn:    { borderWidth: 1, borderColor: '#8b5e3c', paddingVertical: 10, alignItems: 'center' },
  selWriteBtnText:{ fontSize: 13, color: '#8b5e3c' },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  accordionTitle:  { fontSize: 17, fontWeight: '300', color: '#1a1510' },
  accordionCount:  { fontSize: 11, color: '#9a8f85' },
  accordionChevron:{ fontSize: 18, color: '#9a8f85' },
  accordionBody:   { backgroundColor: 'rgba(237,231,217,0.4)', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  settingsSectionTitle: { fontSize: 10, color: '#9a8f85', letterSpacing: 2, marginBottom: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  settingsRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.12)' },
  settingsLabel:   { fontSize: 14, color: '#1a1510' },
  settingsValue:   { fontSize: 13, color: '#9a8f85' },
  logoutBtn:       { marginTop: 32, borderWidth: 1.5, borderColor: '#c0392b', padding: 14, alignItems: 'center' },
  logoutBtnText:   { color: '#c0392b', fontSize: 14 },
  bottomNav:       { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(26,21,16,0.12)', backgroundColor: '#f5f0e8', paddingBottom: Platform.OS === 'ios' ? 20 : 4, paddingTop: 4 },
  navItem:         { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  navActiveBar:    { position: 'absolute', top: 0, left: '25%', right: '25%', height: 1.5, backgroundColor: '#1a1510' },
  navLabel:        { fontSize: 12, color: '#9a8f85', letterSpacing: 1.5 },
  navLabelActive:  { color: '#1a1510', fontWeight: '500' },
  navCenterBtn:    { flex: 1, alignItems: 'center', paddingVertical: 6 },
  navCenterInner:  { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: '#1a1510', alignItems: 'center', justifyContent: 'center' },
  navCenterText:   { fontSize: 16, color: '#1a1510', fontWeight: '300', letterSpacing: 1 },
  btnAccentSm:           { borderWidth: 1, borderColor: '#8b5e3c', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99 },
  btnAccentSmText:       { color: '#8b5e3c', fontSize: 12 },
  btnAccentSmActive:     { backgroundColor: '#8b5e3c', borderColor: '#8b5e3c' },
  btnAccentSmActiveText: { color: '#ffffff', fontSize: 12, fontWeight: '500' },
  stepperBtn:  { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(26,21,16,0.2)', alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 18, color: '#4a3f35', lineHeight: 22 },
  stepperValue:   { fontSize: 15, color: '#1a1510', minWidth: 36, textAlign: 'center' },
  settingsHint:   { fontSize: 11, color: '#9a8f85', marginTop: 6, marginBottom: 8, lineHeight: 18 },
  toast:           { position: 'absolute', bottom: 80, alignSelf: 'center', backgroundColor: '#1a1510', paddingHorizontal: 20, paddingVertical: 10 },
  testBtn:         { borderWidth: 1, borderColor: '#9a8f85', padding: 12, alignItems: 'center' },
  testBtnText:     { fontSize: 13, color: '#9a8f85' },
  lineLoginBtn:     { backgroundColor: '#06C755', padding: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  lineLoginBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  homeGreeting:     { fontSize: 13, color: '#9a8f85', letterSpacing: 0.5 },
  homeCard:         { backgroundColor: '#ffffff', padding: 28, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(26,21,16,0.08)', shadowColor: '#1a1510', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  homeCardSub:      { fontSize: 10, color: '#9a8f85', letterSpacing: 2, marginBottom: 16 },
  homeCardMessage:  { fontSize: 17, color: '#1a1510', fontWeight: '300', lineHeight: 28, marginBottom: 28 },
  homeCardBtn:      { backgroundColor: '#8b5e3c', paddingVertical: 14, alignItems: 'center', borderRadius: 6 },
  homeCardBtnText:  { fontSize: 14, color: '#ffffff', letterSpacing: 1 },
  homeCardBtnOutline:     { borderWidth: 1, borderColor: 'rgba(26,21,16,0.12)', paddingVertical: 13, alignItems: 'center', borderRadius: 6 },
  homeCardBtnOutlineText: { fontSize: 14, color: '#9a8f85', letterSpacing: 1 },
  homeCardReadMore: { fontSize: 11, color: '#9a8f85', marginTop: 8, marginBottom: 20 },
  homeCardDivider:  { height: 1, backgroundColor: 'rgba(26,21,16,0.08)', marginBottom: 20 },
  homeRecentLabel:  { fontSize: 10, color: '#9a8f85', letterSpacing: 2, marginBottom: 10 },
  homeRecentItem:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(26,21,16,0.08)' },
  homeRecentDate:   { fontSize: 10, color: '#9a8f85', marginBottom: 3, letterSpacing: 0.5 },
  homeRecentPreview:{ fontSize: 13, color: '#4a3f35', lineHeight: 20 },
});
