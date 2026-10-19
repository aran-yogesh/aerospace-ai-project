import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '../components'
import styles from './AppShell.module.css'

interface Message {
  id: number
  author: 'user' | 'assistant'
  body: string
}

const INITIAL: Message[] = [
  {
    id: 1,
    author: 'assistant',
    body: 'Welcome to LemmaLab. Describe the system you want to analyse and I will help you lay out the components.'
  },
  {
    id: 2,
    author: 'user',
    body: 'Booster pump feeding a plate heat exchanger through a DN50 supply main.'
  },
  {
    id: 3,
    author: 'assistant',
    body: 'Added a pump, isolation valve, elbow and heat exchanger. Two loss coefficients are approximate and marked as such.'
  }
]

/** Local-only chat placeholder: sending appends to the list, no backend. */
export function ChatPane(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>(INITIAL)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function send(): void {
    const body = draft.trim()
    if (!body) return
    setMessages((prev) => [...prev, { id: Date.now(), author: 'user', body }])
    setDraft('')
  }

  function onSubmit(e: FormEvent): void {
    e.preventDefault()
    send()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className={styles.chat}>
      <ol ref={listRef} className={styles.messages} aria-live="polite" aria-label="Messages">
        {messages.map((m) => (
          <li key={m.id} className={[styles.message, m.author === 'user' ? styles.user : ''].join(' ')}>
            <span className={styles.author}>{m.author === 'user' ? 'You' : 'Lemma'}</span>
            <p className={styles.body}>{m.body}</p>
          </li>
        ))}
      </ol>
      <form className={styles.composer} onSubmit={onSubmit}>
        <label htmlFor="chat-input" className="visually-hidden">
          Message
        </label>
        <textarea
          id="chat-input"
          className={styles.input}
          rows={2}
          placeholder="Message LemmaLab…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  )
}
