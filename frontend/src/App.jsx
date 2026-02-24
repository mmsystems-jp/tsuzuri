import { useState, useEffect, useRef, useCallback } from 'react'
import './index.css'

const API = import.meta.env.VITE_API_URL ?? ''
const CLAUDE_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || ''

// ── API helpers ──────────────────────────────────────────────────
function getToken() { return localStorage.getItem('tsz_token') || '' }

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'エラーが発生しました')
  return data
}

// ── Date helpers ─────────────────────────────────────────────────
function todayJST() {
  const d = new Date(Date.now() + 9 * 3600000)
  return d.toISOString().slice(0, 10)
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-')
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const dow = new Date(dateStr).getDay()
  return { y, m, d, dow: days[dow], full: `${parseInt(m)}月${parseInt(d)}日（${days[dow]}）` }
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 5) return 'こんばんは'
  if (h < 12) return 'おはようございます'
  if (h < 17) return 'こんにちは'
  return 'おつかれさまです'
}

const MOODS = [
  { label: '普通', cls: 'mood-0' },
  { label: '辛い', cls: 'mood-1' },
  { label: '不安', cls: 'mood-2' },
  { label: '普通', cls: 'mood-3' },
  { label: '良い', cls: 'mood-4' },
  { label: '最高', cls: 'mood-5' },
]

const STARTERS = [
  '良い一日だった',
  '少し疲れた',
  'なんでもない一日',
  '嬉しいことがあった',
  '悩んでいることがある',
]

const SYSTEM_PROMPT = `あなたは「綴り」というAI日記アプリのアシスタントです。
ユーザーが今日あったことを話してくれます。
相槌を打ちながら、自然な会話で話を引き出してください。
質問は一度に一つだけ。短く、やさしく。50字以内を心がけて。
3〜5往復したら自然に会話を締めくくってください。`

// ── Toast ────────────────────────────────────────────────────────
function Toast({ msg }) {
  return msg ? <div className="toast">{msg}</div> : null
}

// ── Login Screen ─────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [step, setStep] = useState('email') // email | otp
  const [email, setEmail] = useState(localStorage.getItem('tsz_email') || '')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendOtp() {
    if (!email.trim()) return
    setLoading(true); setError('')
    try {
      await apiFetch('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
      setStep('otp')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function verify() {
    if (!otp.trim()) return
    setLoading(true); setError('')
    try {
      const data = await apiFetch('/auth/verify', { method: 'POST', body: JSON.stringify({ email, code: otp }) })
      localStorage.setItem('tsz_token', data.token)
      localStorage.setItem('tsz_email', email)
      onLogin(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-logo">綴り</div>
      <div className="login-tagline">AI と話すだけで、日記になる</div>

      <div className="login-card">
        {step === 'email' ? (
          <>
            <label className="login-label">メールアドレス</label>
            <input
              className="login-input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOtp()}
              autoFocus
            />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn-primary" onClick={sendOtp} disabled={loading || !email}>
              {loading ? '送信中...' : 'ログインコードを送る'}
            </button>
            <p className="login-hint">初めての方はこのままアカウント作成されます</p>
          </>
        ) : (
          <>
            <label className="login-label">{email} に送ったコードを入力</label>
            <input
              className="login-input"
              type="text"
              placeholder="123456"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && verify()}
              autoFocus
              inputMode="numeric"
            />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn-primary" onClick={verify} disabled={loading || otp.length < 6}>
              {loading ? '確認中...' : 'ログイン'}
            </button>
            <button className="back-link" onClick={() => { setStep('email'); setOtp(''); setError('') }}>
              メールアドレスを変更する
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Home Screen ──────────────────────────────────────────────────
function HomeScreen({ user, entries, todayEntry, onWrite, onSelectEntry }) {
  const today = todayJST()
  const { full } = formatDate(today)
  const recent = entries.filter(e => e.date !== today).slice(0, 10)

  return (
    <div className="screen">
      <div className="header">
        <div>
          <div className="header-title">綴り</div>
          <div className="header-sub">{full}</div>
        </div>
      </div>

      <div className="home-content">
        <p className="greeting">{getGreeting()}</p>

        <div className="today-card" onClick={() => !todayEntry && onWrite()}>
          <div className="today-card-label">今日</div>
          {todayEntry ? (
            <>
              <p className="today-card-text">{todayEntry.text}</p>
              <button
                className="btn-accent"
                style={{ marginTop: '0.75rem', fontSize: '0.78rem', padding: '0.4rem 1rem' }}
                onClick={e => { e.stopPropagation(); onSelectEntry(todayEntry); }}
              >
                編集する
              </button>
            </>
          ) : (
            <p className="today-card-status">まだ記録がありません</p>
          )}
        </div>

        {!todayEntry && (
          <button className="write-btn" onClick={onWrite}>
            今日のことを話す
          </button>
        )}

        {recent.length > 0 && (
          <>
            <div className="section-label">過去の記録</div>
            <div className="entry-list">
              {recent.map(e => {
                const { d, dow } = formatDate(e.date)
                return (
                  <div key={e.date} className="entry-item" onClick={() => onSelectEntry(e)}>
                    <div className="entry-date-col">
                      <div className="entry-day">{d}</div>
                      <div className="entry-weekday">{dow}</div>
                    </div>
                    <div className="mood-dot" style={{ marginTop: '0.4rem' }} />
                    <div className="entry-preview">{e.text}</div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {entries.length === 0 && (
          <div className="empty-state">
            まだ日記がありません<br />
            今日のことを話してみましょう
          </div>
        )}
      </div>
    </div>
  )
}

// ── Chat Screen ──────────────────────────────────────────────────
function ChatScreen({ onBack, onSaved }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '今日はどんな一日でしたか？' }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [diary, setDiary] = useState(null) // 生成された日記文
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text) {
    if (!text.trim() || loading) return
    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text || 'すみません、もう一度教えてください。'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '少し問題が発生しました。続けてください。' }])
    }
    setLoading(false)
  }

  async function generateDiary() {
    setLoading(true)
    try {
      const conversation = messages.map(m => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content}`).join('\n')
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `以下の会話から、一人称の日記を生成してください。
Markdownは使わず、地の文のみで書いてください。
自然な日本語で、感情が伝わる文章に。200〜400字程度。\n\n${conversation}`,
          }],
        }),
      })
      const data = await res.json()
      setDiary(data.content?.[0]?.text || '')
    } catch { setDiary('') }
    setLoading(false)
  }

  async function saveDiary() {
    if (!diary) return
    setSaving(true)
    try {
      await apiFetch('/diary', {
        method: 'POST',
        body: JSON.stringify({ text: diary, conversation: messages, moodIdx: 0 }),
      })
      onSaved(diary)
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  const canGenerate = messages.filter(m => m.role === 'user').length >= 2

  return (
    <div className="chat-screen">
      <div className="header">
        <button className="icon-btn" onClick={onBack}>← 戻る</button>
        <div className="header-sub">AI と話す</div>
        {canGenerate && !diary && (
          <button className="btn-accent" onClick={generateDiary} disabled={loading}>
            日記にする
          </button>
        )}
        {!canGenerate && <div style={{ width: '60px' }} />}
      </div>

      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`message message-${m.role === 'user' ? 'user' : 'ai'}`}>
            <div className="message-sender">{m.role === 'user' ? 'あなた' : '綴り'}</div>
            <div className="message-bubble">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="message message-ai">
            <div className="message-sender">綴り</div>
            <div className="message-bubble">
              <div className="loading-dot">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {diary && (
        <div className="save-diary-bar">
          <p>日記を生成しました</p>
          <button className="btn-accent" onClick={saveDiary} disabled={saving}>
            {saving ? '保存中...' : '保存する'}
          </button>
        </div>
      )}

      {messages.length <= 1 && (
        <div className="starter-btns">
          {STARTERS.map(s => (
            <button key={s} className="starter-btn" onClick={() => sendMessage(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="chat-input-bar">
        <textarea
          className="chat-input"
          placeholder="今日のことを話してください..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendMessage(input)
            }
          }}
          rows={1}
        />
        <button className="send-btn" onClick={() => sendMessage(input)} disabled={!input.trim() || loading}>
          ↑
        </button>
      </div>
    </div>
  )
}

// ── Diary Detail ─────────────────────────────────────────────────
function DiaryDetail({ entry, onBack, onSave }) {
  const [text, setText] = useState(entry.text || '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const { full } = formatDate(entry.date)

  async function save() {
    setSaving(true)
    try {
      await apiFetch(`/diary/${entry.date}`, {
        method: 'PUT',
        body: JSON.stringify({ text, moodIdx: entry.moodIdx || 0 }),
      })
      onSave({ ...entry, text })
      setEditing(false)
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  return (
    <div className="detail-screen">
      <div className="header">
        <button className="icon-btn" onClick={onBack}>← 戻る</button>
        <div className="header-sub">{full}</div>
        {editing ? (
          <button className="btn-accent" onClick={save} disabled={saving}>
            {saving ? '...' : '保存'}
          </button>
        ) : (
          <button className="icon-btn" onClick={() => setEditing(true)}>編集</button>
        )}
      </div>

      <div className="diary-body">
        <div className="diary-date-header">{full}</div>
        {editing ? (
          <textarea
            className="diary-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="diary-text-view">{text}</div>
        )}
      </div>
    </div>
  )
}

// ── Calendar Screen ───────────────────────────────────────────────
function CalendarScreen({ entries, onSelectEntry }) {
  const today = new Date(todayJST())
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const entryDates = new Set(entries.map(e => e.date))
  const entryMap = Object.fromEntries(entries.map(e => [e.date, e]))

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const todayStr = todayJST()

  function prevMonth() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  return (
    <div className="screen">
      <div className="header">
        <div className="header-title">カレンダー</div>
      </div>

      <div className="calendar-wrap">
        <div className="cal-header">
          <button className="icon-btn" onClick={prevMonth}>‹</button>
          <div className="cal-month">{year}年 {month + 1}月</div>
          <button className="icon-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="cal-grid">
          {['日', '月', '火', '水', '木', '金', '土'].map(d => (
            <div key={d} className="cal-day-label">{d}</div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} className="cal-day empty" />
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
            const hasEntry = entryDates.has(dateStr)
            const isToday = dateStr === todayStr
            return (
              <div
                key={dateStr}
                className={`cal-day ${hasEntry ? 'has-entry' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => hasEntry && onSelectEntry(entryMap[dateStr])}
              >
                {day}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Settings Screen ───────────────────────────────────────────────
function SettingsScreen({ user, onLogout }) {
  return (
    <div className="screen">
      <div className="header">
        <div className="header-title">設定</div>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="settings-section-title">アカウント</div>
          <div className="settings-row">
            <span>メールアドレス</span>
            <span className="settings-value">{user?.email || ''}</span>
          </div>
          <div className="settings-row">
            <span>プラン</span>
            <span className="settings-value">無料</span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">統計</div>
          <div className="settings-row">
            <span>記録した日数</span>
            <span className="settings-value">{user?.totalEntries || 0} 日</span>
          </div>
          <div className="settings-row">
            <span>合計文字数</span>
            <span className="settings-value">{(user?.totalChars || 0).toLocaleString()} 字</span>
          </div>
        </div>

        <button className="logout-btn" onClick={onLogout}>ログアウト</button>
      </div>
    </div>
  )
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true) // 起動時のトークン確認中
  const [user, setUser] = useState(null)
  const [entries, setEntries] = useState([])
  const [screen, setScreen] = useState('home')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [toast, setToast] = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  // トークン確認
  useEffect(() => {
    const token = localStorage.getItem('tsz_token')
    if (!token) { setChecking(false); return }
    apiFetch('/auth/me')
      .then(data => {
        setUser(data)
        setAuthed(true)
      })
      .catch(e => {
        // 401のみトークン削除。ネットワークエラーは無視
        if (e.message === 'Unauthorized') localStorage.removeItem('tsz_token')
      })
      .finally(() => setChecking(false))
  }, [])

  // 日記一覧取得
  useEffect(() => {
    if (!authed) return
    apiFetch('/diary').then(data => setEntries(data.entries || [])).catch(() => {})
  }, [authed])

  function handleLogin(data) {
    setUser(data)
    setAuthed(true)
  }

  function handleLogout() {
    localStorage.removeItem('tsz_token')
    setAuthed(false)
    setUser(null)
    setEntries([])
    setScreen('home')
  }

  function handleSaved(text) {
    const today = todayJST()
    const newEntry = { date: today, text, moodIdx: 0 }
    setEntries(prev => [newEntry, ...prev.filter(e => e.date !== today)])
    showToast('日記を保存しました')
    setScreen('home')
  }

  function handleSelectEntry(entry) {
    setSelectedEntry(entry)
    setScreen('detail')
  }

  function handleEntryUpdate(updated) {
    setEntries(prev => prev.map(e => e.date === updated.date ? updated : e))
    setSelectedEntry(updated)
    showToast('更新しました')
  }

  if (checking) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--paper)', fontFamily:'var(--font-serif)', color:'var(--ink-faint)', fontSize:'0.85rem', letterSpacing:'0.1em' }}>読み込み中...</div>
  if (!authed) return <LoginScreen onLogin={handleLogin} />

  const today = todayJST()
  const todayEntry = entries.find(e => e.date === today)

  if (screen === 'chat') return (
    <ChatScreen
      onBack={() => setScreen('home')}
      onSaved={handleSaved}
    />
  )

  if (screen === 'detail' && selectedEntry) return (
    <DiaryDetail
      entry={selectedEntry}
      onBack={() => setScreen('home')}
      onSave={handleEntryUpdate}
    />
  )

  return (
    <div className="screen">
      {screen === 'home' && (
        <HomeScreen
          user={user}
          entries={entries}
          todayEntry={todayEntry}
          onWrite={() => setScreen('chat')}
          onSelectEntry={handleSelectEntry}
        />
      )}
      {screen === 'calendar' && (
        <CalendarScreen entries={entries} onSelectEntry={handleSelectEntry} />
      )}
      {screen === 'settings' && (
        <SettingsScreen user={user} onLogout={handleLogout} />
      )}

      <nav className="bottom-nav">
        <button className={`nav-item ${screen === 'home' ? 'active' : ''}`} onClick={() => setScreen('home')}>
          <span className="nav-icon">⌂</span>
          <span className="nav-label">ホーム</span>
        </button>
        <button className={`nav-item ${screen === 'calendar' ? 'active' : ''}`} onClick={() => setScreen('calendar')}>
          <span className="nav-icon">◫</span>
          <span className="nav-label">カレンダー</span>
        </button>
        <button className={`nav-item ${screen === 'settings' ? 'active' : ''}`} onClick={() => setScreen('settings')}>
          <span className="nav-icon">◎</span>
          <span className="nav-label">設定</span>
        </button>
      </nav>

      <Toast msg={toast} />
    </div>
  )
}
